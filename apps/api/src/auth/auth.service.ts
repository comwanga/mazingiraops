import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, OnApplicationBootstrap, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/config";
import { AuditService } from "../audit/audit.service";
import { hashPassword, hashToken, randomCsrfToken, randomSessionToken, tokensEqual, verifyPassword } from "../common/crypto";
import { sessionExpiry, AuthContext, AuthAssignment } from "./auth-context";
import { LoginThrottleService } from "./login-throttle.service";
import { IpThrottleService } from "./ip-throttle.service";

const BOOTSTRAP_LIMIT = 20;
const BOOTSTRAP_WINDOW_MS = 15 * 60 * 1000;

export interface AuthUserSummary {
  id: string;
  email: string;
  displayName: string;
  active: boolean;
  mustChangePassword: boolean;
  assignments: Array<Omit<AuthAssignment, "capabilities"> & {
    countyName: string | null;
    subcountyName: string | null;
    wardName: string | null;
  }>;
}

export interface LoginResult {
  token: string;
  csrfToken: string;
  expiresAt: Date;
  user: AuthUserSummary;
}

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly throttle: LoginThrottleService,
    private readonly ipThrottle: IpThrottleService,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureBootstrapAdmin();
  }

  async ensureBootstrapAdmin(): Promise<void> {
    const bootstrap = this.config.bootstrapAdmin;
    if (!bootstrap) return;

    const existingAdmin = await this.prisma.client.user.findFirst({
      where: { assignments: { some: { role: { code: "SYSTEM_ADMIN" } } } },
      select: {
        id: true,
        email: true,
        assignments: {
          where: { role: { code: "SYSTEM_ADMIN" } },
          select: { countyId: true },
          take: 1,
        },
      },
    });
    if (existingAdmin) {
      if (existingAdmin.email !== bootstrap.email) {
        this.logger.warn(
          "A system administrator already exists; bootstrap credentials were not applied",
        );
        return;
      }

      const alreadyApplied = await this.prisma.client.auditEvent.findFirst({
        where: {
          action: "AUTH.BOOTSTRAP_ENV",
          targetType: "User",
          targetId: existingAdmin.id,
        },
        select: { id: true },
      });
      if (alreadyApplied) return;

      await this.prisma.client.$transaction(async (transaction) => {
        await transaction.user.update({
          where: { id: existingAdmin.id },
          data: {
            displayName: bootstrap.displayName,
            passwordHash: hashPassword(bootstrap.password),
            active: true,
            mustChangePassword: true,
          },
        });
        await transaction.userSession.updateMany({
          where: { userId: existingAdmin.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        const countyId = existingAdmin.assignments[0]?.countyId ?? null;
        await this.audit.record(
          {
            action: "AUTH.BOOTSTRAP_ENV",
            targetType: "User",
            targetId: existingAdmin.id,
            scopeType: countyId ? "COUNTY" : null,
            scopeId: countyId,
            details: "Existing system administrator reconciled with deployment bootstrap credentials",
          },
          transaction,
        );
      });
      this.logger.log(
        "Existing system administrator reconciled once; password change is required",
      );
      return;
    }

    const [county, role] = await Promise.all([
      this.prisma.client.county.findFirst({ where: { code: "NCC" } }),
      this.prisma.client.role.findUnique({ where: { code: "SYSTEM_ADMIN" } }),
    ]);
    if (!county || !role) {
      throw new Error("Bootstrap administrator requires seeded NCC and SYSTEM_ADMIN records");
    }

    const user = await this.prisma.client.user.findUnique({
      where: { email: bootstrap.email },
    });
    await this.prisma.client.$transaction(async (transaction) => {
      const created = user
        ? await transaction.user.update({
            where: { id: user.id },
            data: {
              displayName: bootstrap.displayName,
              passwordHash: hashPassword(bootstrap.password),
              active: true,
              mustChangePassword: true,
              assignments: {
                create: {
                  roleId: role.id,
                  scopeType: "COUNTY",
                  countyId: county.id,
                },
              },
            },
          })
        : await transaction.user.create({
            data: {
              email: bootstrap.email,
              displayName: bootstrap.displayName,
              passwordHash: hashPassword(bootstrap.password),
              active: true,
              mustChangePassword: true,
              assignments: {
                create: {
                  roleId: role.id,
                  scopeType: "COUNTY",
                  countyId: county.id,
                },
              },
            },
          });

      await this.audit.record(
        {
          action: "AUTH.BOOTSTRAP_ENV",
          targetType: "User",
          targetId: created.id,
          scopeType: "COUNTY",
          scopeId: county.id,
          details: "System administrator created from deployment bootstrap credentials",
        },
        transaction,
      );
    });
    this.logger.log("System administrator bootstrap completed; password change is required");
  }

  async bootstrapAdmin(
    input: {
      setupToken: string;
      email: string;
      password: string;
      displayName?: string;
    },
    meta: { sourceIp?: string; requestId?: string } = {},
  ): Promise<AuthUserSummary> {
    this.ipThrottle.check(`bootstrap|${meta.sourceIp ?? "unknown"}`, BOOTSTRAP_LIMIT, BOOTSTRAP_WINDOW_MS);
    if (!this.config.ownerSetupToken) {
      throw new ForbiddenException("Owner setup is not enabled");
    }
    if (!tokensEqual(input.setupToken, this.config.ownerSetupToken)) {
      throw new ForbiddenException("Invalid setup token");
    }

    const existingAdmin = await this.prisma.client.user.findFirst({
      where: { assignments: { some: { role: { code: "SYSTEM_ADMIN" } } } },
    });
    if (existingAdmin) {
      throw new ConflictException("A system owner already exists");
    }

    const county = await this.prisma.client.county.findFirst({ where: { code: "NCC" } });
    if (!county) {
      throw new ConflictException("Reference organisation data is missing");
    }
    const role = await this.prisma.client.role.findUnique({ where: { code: "SYSTEM_ADMIN" } });
    if (!role) {
      throw new ConflictException("SYSTEM_ADMIN role is missing from seed data");
    }

    const user = await this.prisma.client.user.create({
      data: {
        email: input.email,
        displayName: input.displayName ?? "System Owner",
        passwordHash: hashPassword(input.password),
        active: true,
        mustChangePassword: false,
        assignments: {
          create: {
            roleId: role.id,
            scopeType: "COUNTY",
            countyId: county.id,
          },
        },
      },
      include: {
        assignments: {
          include: {
            role: true,
            county: true,
            subcounty: true,
            ward: { include: { subcounty: true } },
          },
        },
      },
    });

    await this.audit.record({
      action: "AUTH.BOOTSTRAP",
      targetType: "User",
      targetId: user.id,
      scopeType: "COUNTY",
      scopeId: county.id,
      details: "System owner created via setup token",
    });

    return toSummary(user);
  }

  async login(input: { email: string; password: string }, meta: { sourceIp?: string; requestId?: string }): Promise<LoginResult> {
    const key = `${input.email}|${meta.sourceIp ?? "unknown"}`;
    await this.throttle.consume(key);

    const user = await this.prisma.client.user.findUnique({ where: { email: input.email } });
    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      await this.audit.record({
        action: "AUTH.LOGIN_FAILED",
        targetType: "User",
        targetId: user?.id,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
        details: "Invalid email or password",
      });
      throw new UnauthorizedException("Invalid email or password");
    }
    if (!user.active) {
      await this.audit.record({
        action: "AUTH.LOGIN_DISABLED",
        targetType: "User",
        targetId: user.id,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
      });
      throw new UnauthorizedException("Invalid email or password");
    }

    await this.throttle.recordSuccess(key);
    const token = randomSessionToken();
    const expiresAt = sessionExpiry(this.config);
    const session = await this.prisma.client.userSession.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        csrfToken: randomCsrfToken(),
        expiresAt,
        lastSeenAt: new Date(),
      },
    });

    await this.audit.record({
      action: "AUTH.LOGIN",
      targetType: "User",
      targetId: user.id,
      actorUserId: user.id,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
    });

    const withAssignments = await this.loadUserWithAssignments(user.id);
    return {
      token,
      csrfToken: session.csrfToken,
      expiresAt,
      user: withAssignments,
    };
  }

  async logout(sessionId: string, meta: { sourceIp?: string; requestId?: string }): Promise<void> {
    const session = await this.prisma.client.userSession.findUnique({ where: { id: sessionId } });
    if (session && !session.revokedAt) {
      await this.prisma.client.userSession.update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        action: "AUTH.LOGOUT",
        targetType: "User",
        targetId: session.userId,
        actorUserId: session.userId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
      });
    }
  }

  async me(auth: AuthContext): Promise<AuthUserSummary & { capabilities: AuthContext["capabilities"]; csrfToken: string }> {
    const user = await this.loadUserWithAssignments(auth.userId);
    return { ...user, capabilities: auth.capabilities, csrfToken: auth.csrfToken };
  }

  async changePassword(
    auth: AuthContext,
    input: { currentPassword: string; newPassword: string },
    meta: { sourceIp?: string; requestId?: string },
  ): Promise<void> {
    const user = await this.prisma.client.user.findUnique({ where: { id: auth.userId } });
    if (!user) {
      throw new UnauthorizedException("User not found");
    }
    if (!verifyPassword(input.currentPassword, user.passwordHash)) {
      throw new BadRequestException("Current password is incorrect");
    }
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(input.newPassword), mustChangePassword: false },
    });
    await this.prisma.client.userSession.updateMany({
      where: { userId: user.id, id: { not: auth.sessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      action: "AUTH.PASSWORD_CHANGED",
      targetType: "User",
      targetId: user.id,
      actorUserId: user.id,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
    });
  }

  private async loadUserWithAssignments(userId: string): Promise<AuthUserSummary> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      include: {
        assignments: {
          include: {
            role: true,
            county: true,
            subcounty: true,
            ward: { include: { subcounty: true } },
          },
        },
      },
    });
    if (!user) {
      throw new UnauthorizedException("User not found");
    }
    return toSummary(user);
  }
}

function toSummary(user: {
  id: string;
  email: string;
  displayName: string;
  active: boolean;
  mustChangePassword: boolean;
  assignments: Array<{
    id: string;
    scopeType: "COUNTY" | "SUBCOUNTY" | "WARD";
    countyId: string | null;
    subcountyId: string | null;
    wardId: string | null;
    role: { code: string; name: string };
    county: { name: string } | null;
    subcounty: { name: string } | null;
    ward: { name: string; subcounty: { name: string } } | null;
  }>;
}): AuthUserSummary {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    active: user.active,
    mustChangePassword: user.mustChangePassword,
    assignments: user.assignments.map((assignment) => ({
      id: assignment.id,
      role: assignment.role.code as AuthAssignment["role"],
      roleName: assignment.role.name,
      scopeType: assignment.scopeType,
      countyId: assignment.countyId,
      subcountyId: assignment.subcountyId,
      wardId: assignment.wardId,
      countyName: assignment.county?.name ?? null,
      subcountyName: assignment.subcounty?.name ?? assignment.ward?.subcounty.name ?? null,
      wardName: assignment.ward?.name ?? null,
    })),
  };
}
