import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { SYSTEM_ADMIN_CAPABILITIES, type CapabilityCode, type RoleCode, type ScopeType } from "@ward-ops/contracts";
import type { UpdateRoleCapabilitiesInput, UpdateUserAssignmentsInput } from "@ward-ops/validation";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthContext } from "../auth/auth-context";
import { ScopeService } from "../authorization/scope.service";
import { IpThrottleService } from "../auth/ip-throttle.service";
import { hashPassword } from "../common/crypto";

const ACCESS_REQUEST_LIMIT = 20;
const ACCESS_REQUEST_WINDOW_MS = 60 * 60 * 1000;
const ACCESS_REQUEST_CONFLICT_MESSAGE = "An access request cannot be created for this email";

export interface RequestAccessInput {
  displayName: string;
  email: string;
  password: string;
  reason: string;
  requestedScope: ScopeType;
  requestedScopeId: string;
}

export interface AccessRequestDecision {
  action: "approve" | "reject";
  roleCode?: RoleCode;
  scopeType?: ScopeType;
  scopeId?: string;
  note?: string;
}

export interface RequestMeta {
  sourceIp?: string;
  requestId?: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly ipThrottle: IpThrottleService,
  ) {}

  async requestAccess(input: RequestAccessInput, meta: RequestMeta): Promise<{ id: string }> {
    this.ipThrottle.check(
      `access-request|${meta.sourceIp ?? "unknown"}`,
      ACCESS_REQUEST_LIMIT,
      ACCESS_REQUEST_WINDOW_MS,
    );
    const existingUser = await this.prisma.client.user.findUnique({
      where: { email: input.email },
    });
    if (existingUser) {
      throw new ConflictException(ACCESS_REQUEST_CONFLICT_MESSAGE);
    }
    const pending = await this.prisma.client.accessRequest.findFirst({
      where: { email: input.email, status: "PENDING" },
    });
    if (pending) {
      throw new ConflictException(ACCESS_REQUEST_CONFLICT_MESSAGE);
    }
    if (!(await this.scopeExists(input.requestedScope, input.requestedScopeId))) {
      throw new BadRequestException("Requested organisation scope does not exist");
    }

    const request = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.accessRequest.create({
        data: {
          displayName: input.displayName,
          email: input.email,
          passwordHash: hashPassword(input.password),
          reason: input.reason,
          requestedScope: input.requestedScope,
          requestedScopeId: input.requestedScopeId,
        },
      });
      await this.audit.record({
        action: "ACCESS_REQUEST.CREATED",
        targetType: "AccessRequest",
        targetId: created.id,
        scopeType: input.requestedScope,
        scopeId: input.requestedScopeId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
        details: input.email,
      }, tx);
      return created;
    });
    return { id: request.id };
  }

  async listAccessRequests(auth: AuthContext): Promise<unknown[]> {
    const accessible = await this.scope.accessibleScopeIds(auth);
    const canReviewLegacyUnscoped = auth.assignments.some(
      (assignment) => assignment.role === "SYSTEM_ADMIN" && assignment.capabilities.includes("USERS_MANAGE"),
    );
    const requests = await this.prisma.client.accessRequest.findMany({
      orderBy: { createdAt: "desc" },
    });

    return requests
      .filter((request) => {
        if (!request.requestedScope || !request.requestedScopeId) return canReviewLegacyUnscoped;
        return this.scopeIdAccessible(accessible, request.requestedScope, request.requestedScopeId);
      })
      .map((request) => ({
        id: request.id,
        displayName: request.displayName,
        email: request.email,
        reason: request.reason,
        status: request.status,
        requestedScope: request.requestedScope,
        requestedScopeId: request.requestedScopeId,
        createdAt: request.createdAt,
      }));
  }

  async reviewAccessRequest(
    auth: AuthContext,
    id: string,
    decision: AccessRequestDecision,
    meta: RequestMeta,
  ): Promise<{ id: string; status: string }> {
    const request = await this.prisma.client.accessRequest.findUnique({ where: { id } });
    if (!request) {
      throw new NotFoundException("Access request not found");
    }
    if (request.status !== "PENDING") {
      throw new ConflictException("Access request has already been reviewed");
    }
    const canReviewLegacyUnscoped = auth.assignments.some(
      (assignment) => assignment.role === "SYSTEM_ADMIN" && assignment.capabilities.includes("USERS_MANAGE"),
    );
    if (request.requestedScope && request.requestedScopeId) {
      if (!(await this.scope.scopeAccessible(auth, request.requestedScope, request.requestedScopeId))) {
        throw new ForbiddenException("Access request is outside your authority");
      }
    } else if (!canReviewLegacyUnscoped) {
      throw new ForbiddenException("Access request is outside your authority");
    }

    if (decision.action === "reject") {
      await this.prisma.client.$transaction(async (tx) => {
        const updated = await tx.accessRequest.updateMany({
          where: { id, status: "PENDING" },
          data: {
            status: "REJECTED",
            reviewedBy: auth.userId,
            reviewNote: decision.note ?? null,
            reviewedAt: new Date(),
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException("Access request has already been reviewed");
        }
        await this.audit.record({
          action: "ACCESS_REQUEST.REJECTED",
          targetType: "AccessRequest",
          targetId: id,
          scopeType: request.requestedScope,
          scopeId: request.requestedScopeId,
          actorUserId: auth.userId,
          sourceIp: meta.sourceIp,
          requestId: meta.requestId,
        }, tx);
      });
      return { id, status: "REJECTED" };
    }

    const scopeType = decision.scopeType ?? request.requestedScope;
    const scopeId = decision.scopeId ?? request.requestedScopeId;
    if (!scopeType || !scopeId) {
      throw new BadRequestException(
        "Approval requires a scope for the new account",
      );
    }
    const accessible = await this.scope.scopeAccessible(auth, scopeType, scopeId);
    if (!accessible) {
      throw new ForbiddenException("Scope is outside your authority");
    }
    const roleCode = decision.roleCode ?? "READ_ONLY";
    const role = await this.prisma.client.role.findUnique({ where: { code: roleCode } });
    if (!role) {
      throw new BadRequestException("Unknown role");
    }

    await this.prisma.client.$transaction(async (tx) => {
      const claimed = await tx.accessRequest.updateMany({
        where: { id, status: "PENDING" },
        data: {
          status: "APPROVED",
          reviewedBy: auth.userId,
          reviewNote: decision.note ?? null,
          reviewedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException("Access request has already been reviewed");
      }
      const existingUser = await tx.user.findUnique({ where: { email: request.email } });
      if (existingUser) {
        throw new ConflictException("A user already exists for this email");
      }
      const created = await tx.user.create({
        data: {
          email: request.email,
          displayName: request.displayName,
          passwordHash: request.passwordHash,
          active: true,
          mustChangePassword: true,
          assignments: {
            create: {
              roleId: role.id,
              scopeType,
              countyId: scopeType === "COUNTY" ? scopeId : null,
              subcountyId: scopeType === "SUBCOUNTY" ? scopeId : null,
              wardId: scopeType === "WARD" ? scopeId : null,
            },
          },
        },
      });
      await tx.accessRequest.update({
        where: { id },
        data: { targetUserId: created.id },
      });
      await this.audit.record({
        action: "ACCESS_REQUEST.APPROVED",
        targetType: "AccessRequest",
        targetId: id,
        scopeType,
        scopeId,
        actorUserId: auth.userId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
        details: `${request.email} -> ${roleCode}`,
      }, tx);
      return created;
    });
    return { id, status: "APPROVED" };
  }

  async listUsers(auth: AuthContext): Promise<unknown[]> {
    const accessible = await this.scope.accessibleScopeIds(auth);
    const users = await this.prisma.client.user.findMany({
      include: { assignments: { include: { role: true } } },
      orderBy: { displayName: "asc" },
    });
    return users.flatMap((user) => {
      const assignments = user.assignments.filter((assignment) => {
        const scopeId = this.assignmentScopeId(assignment);
        return scopeId !== null && this.scopeIdAccessible(accessible, assignment.scopeType, scopeId);
      });
      if (assignments.length === 0) return [];
      return [{
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        active: user.active,
        mustChangePassword: user.mustChangePassword,
        assignments: assignments.map((assignment) => ({
          id: assignment.id,
          roleCode: assignment.role.code,
          roleName: assignment.role.name,
          scopeType: assignment.scopeType,
          scopeId: this.assignmentScopeId(assignment),
        })),
      }];
    });
  }

  async setUserActive(
    auth: AuthContext,
    userId: string,
    active: boolean,
    meta: RequestMeta,
  ): Promise<void> {
    if (userId === auth.userId && !active) {
      throw new BadRequestException("You cannot disable your own account");
    }
    await this.assertCanManageUser(auth, userId);
    const now = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { active } });
      await tx.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.audit.record({
        action: active ? "USER.RESTORED" : "USER.DISABLED",
        targetType: "User",
        targetId: userId,
        actorUserId: auth.userId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
      }, tx);
    });
  }

  async updateAssignments(
    auth: AuthContext,
    userId: string,
    input: UpdateUserAssignmentsInput,
    meta: RequestMeta,
  ): Promise<void> {
    await this.assertCanManageUser(auth, userId);
    for (const assignment of input.assignments) {
      if (!(await this.scope.scopeAccessible(auth, assignment.scopeType, assignment.scopeId))) {
        throw new ForbiddenException("Assignment scope is outside your authority");
      }
    }
    const roles = await this.prisma.client.role.findMany({
      where: { code: { in: input.assignments.map((assignment) => assignment.roleCode) } },
    });
    const roleIds = new Map(roles.map((role) => [role.code, role.id]));
    if (roleIds.size !== new Set(input.assignments.map((assignment) => assignment.roleCode)).size) {
      throw new BadRequestException("Unknown role");
    }
    await this.prisma.client.$transaction(async (tx) => {
      await tx.assignment.deleteMany({ where: { userId } });
      await tx.assignment.createMany({
        data: input.assignments.map((assignment) => ({
          userId,
          roleId: roleIds.get(assignment.roleCode)!,
          scopeType: assignment.scopeType,
          countyId: assignment.scopeType === "COUNTY" ? assignment.scopeId : null,
          subcountyId: assignment.scopeType === "SUBCOUNTY" ? assignment.scopeId : null,
          wardId: assignment.scopeType === "WARD" ? assignment.scopeId : null,
        })),
      });
      await tx.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        action: "USER.ASSIGNMENTS_UPDATED",
        targetType: "User",
        targetId: userId,
        actorUserId: auth.userId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
        details: `${input.assignments.length} assignment(s)`,
      }, tx);
    });
  }

  async resetPassword(
    auth: AuthContext,
    userId: string,
    temporaryPassword: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.assertCanManageUser(auth, userId);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: hashPassword(temporaryPassword), mustChangePassword: true },
      });
      await tx.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        action: "USER.PASSWORD_RESET",
        targetType: "User",
        targetId: userId,
        actorUserId: auth.userId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
      }, tx);
    });
  }

  async permissionCatalog() {
    const [capabilities, roles] = await Promise.all([
      this.prisma.client.capability.findMany({ orderBy: { name: "asc" } }),
      this.prisma.client.role.findMany({
        include: { capabilities: { include: { capability: true } } },
        orderBy: { name: "asc" },
      }),
    ]);
    return {
      capabilities: capabilities.map((capability) => ({
        code: capability.code,
        name: capability.name,
      })),
      roles: roles.map((role) => ({
        code: role.code,
        name: role.name,
        capabilities: role.capabilities.map((link) => link.capability.code).sort(),
      })),
    };
  }

  async updateRoleCapabilities(
    auth: AuthContext,
    roleCode: RoleCode,
    input: UpdateRoleCapabilitiesInput,
    meta: RequestMeta,
  ): Promise<void> {
    const role = await this.prisma.client.role.findUnique({ where: { code: roleCode } });
    if (!role) throw new NotFoundException("Role not found");
    if (roleCode === "SYSTEM_ADMIN") {
      const allowed = new Set<CapabilityCode>(SYSTEM_ADMIN_CAPABILITIES);
      const missing = SYSTEM_ADMIN_CAPABILITIES.some(
        (capability) => !input.capabilities.includes(capability),
      );
      const prohibited = input.capabilities.some((capability) => !allowed.has(capability));
      if (missing || prohibited) {
        throw new BadRequestException(
          "System administrator permissions are fixed to account administration and report viewing",
        );
      }
    }
    const capabilities = await this.prisma.client.capability.findMany({
      where: { code: { in: input.capabilities } },
    });
    if (capabilities.length !== new Set(input.capabilities).size) {
      throw new BadRequestException("Unknown capability");
    }
    await this.prisma.client.$transaction(async (tx) => {
      await tx.roleCapability.deleteMany({ where: { roleId: role.id } });
      if (capabilities.length) {
        await tx.roleCapability.createMany({
          data: capabilities.map((capability) => ({ roleId: role.id, capabilityId: capability.id })),
        });
      }
      await tx.role.update({ where: { id: role.id }, data: { permissionsManagedAt: new Date() } });
      await tx.userSession.updateMany({
        where: { user: { assignments: { some: { roleId: role.id } } }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        action: "ROLE.PERMISSIONS_UPDATED",
        targetType: "Role",
        targetId: role.id,
        actorUserId: auth.userId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
        details: `${roleCode}: ${input.capabilities.join(",")}`,
      }, tx);
    });
  }

  private async assertCanManageUser(auth: AuthContext, userId: string): Promise<void> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      include: { assignments: true },
    });
    if (!user) throw new NotFoundException("User not found");
    if (user.assignments.length === 0) {
      throw new ForbiddenException("User is outside your authority");
    }
    for (const assignment of user.assignments) {
      const scopeId = this.assignmentScopeId(assignment);
      if (!scopeId || !(await this.scope.scopeAccessible(auth, assignment.scopeType, scopeId))) {
        throw new ForbiddenException("User is outside your authority");
      }
    }
  }

  private async scopeExists(scopeType: ScopeType, scopeId: string): Promise<boolean> {
    if (scopeType === "COUNTY") {
      return (await this.prisma.client.county.count({ where: { id: scopeId } })) === 1;
    }
    if (scopeType === "SUBCOUNTY") {
      return (await this.prisma.client.subcounty.count({ where: { id: scopeId } })) === 1;
    }
    return (await this.prisma.client.ward.count({ where: { id: scopeId } })) === 1;
  }

  private assignmentScopeId(assignment: {
    scopeType: ScopeType;
    countyId: string | null;
    subcountyId: string | null;
    wardId: string | null;
  }): string | null {
    if (assignment.scopeType === "COUNTY") return assignment.countyId;
    if (assignment.scopeType === "SUBCOUNTY") return assignment.subcountyId;
    return assignment.wardId;
  }

  private scopeIdAccessible(
    accessible: { wardIds: Set<string>; subcountyIds: Set<string>; countyIds: Set<string> },
    scopeType: ScopeType,
    scopeId: string,
  ): boolean {
    if (scopeType === "COUNTY") return accessible.countyIds.has(scopeId);
    if (scopeType === "SUBCOUNTY") return accessible.subcountyIds.has(scopeId);
    return accessible.wardIds.has(scopeId);
  }
}
