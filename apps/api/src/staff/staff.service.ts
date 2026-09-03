import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@ward-ops/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthContext } from "../auth/auth-context";
import { ScopeService } from "../authorization/scope.service";
import type {
  CreateEmployeeInput,
  CreateEmployeeAssignmentInput,
  CommitStaffImportInput,
  StaffImportHistoryQueryInput,
  StaffQueryInput,
  UpdateEmployeeInput,
} from "@ward-ops/validation";
import { staffImportRowSchema } from "@ward-ops/validation";
import type { ParsedStaffImportRow } from "./staff-import";

export interface RequestMeta {
  sourceIp?: string;
  requestId?: string;
}

export interface StaffSummary {
  id: string;
  employeeNumber: string;
  fullName: string;
  phone: string;
  email: string | null;
  designation: string;
  active: boolean;
  wardId: string;
  ward: { id: string; code: string; name: string };
  profile: { residence: string | null; rosterStatus: string } | null;
  assignments: Array<{
    id: string;
    wardId: string;
    assignedAt: Date;
    endedAt: Date | null;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface StaffImportRowResult {
  rowNumber: number;
  status: "CREATE" | "UPDATE" | "SKIPPED" | "CONFLICT" | "DUPLICATE_FILE" | "INVALID";
  value: Record<string, unknown>;
  employeeId?: string;
  errors?: string[];
}

/** Normalizes a phone number to the legacy 0-prefixed storage form. */
export function normalizePhone(value: string): string {
  if (value.startsWith("+254")) return `0${value.slice(4)}`;
  return value;
}

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  private async wardAccessibleOrThrow(auth: AuthContext, wardId: string): Promise<void> {
    if (!(await this.scope.wardAccessible(auth, wardId))) {
      throw new ForbiddenException("Ward is outside your scope");
    }
  }

  private async findEmployeeOrThrow(id: string): Promise<Prisma.EmployeeGetPayload<{
    include: { profile: true; assignments: true; ward: true };
  }>> {
    const employee = await this.prisma.client.employee.findUnique({
      where: { id },
      include: { profile: true, assignments: true, ward: true },
    });
    if (!employee) {
      throw new NotFoundException("Employee not found");
    }
    return employee;
  }

  private toSummary(employee: Prisma.EmployeeGetPayload<{
    include: { profile: true; assignments: true; ward: true };
  }>): StaffSummary {
    return {
      id: employee.id,
      employeeNumber: employee.employeeNumber,
      fullName: employee.fullName,
      phone: employee.phone,
      email: employee.email,
      designation: employee.designation,
      active: employee.active,
      wardId: employee.wardId,
      ward: {
        id: employee.ward.id,
        code: employee.ward.code,
        name: employee.ward.name,
      },
      profile: employee.profile
        ? {
            residence: employee.profile.residence,
            rosterStatus: employee.profile.rosterStatus,
          }
        : null,
      assignments: employee.assignments
        .filter((assignment) => assignment.kind === "TEMPORARY" && !assignment.endedAt)
        .map((assignment) => ({
          id: assignment.id,
          wardId: assignment.wardId,
          assignedAt: assignment.assignedAt,
          endedAt: assignment.endedAt,
        })),
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt,
    };
  }

  async list(auth: AuthContext, query: StaffQueryInput): Promise<StaffSummary[]> {
    const wardIds = (await this.scope.accessibleWards(auth)).map((ward) => ward.id);
    if (query.wardId && !wardIds.includes(query.wardId)) return [];
    const where: Prisma.EmployeeWhereInput = {
      wardId: query.wardId ?? { in: wardIds },
      active: query.active,
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: "insensitive" } },
              { employeeNumber: { contains: query.search } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };
    const employees = await this.prisma.client.employee.findMany({
      where,
      include: { profile: true, assignments: true, ward: true },
      orderBy: { fullName: "asc" },
      skip: query.page ? (query.page - 1) * (query.pageSize ?? 25) : undefined,
      take: query.page || query.pageSize ? query.pageSize ?? 25 : undefined,
    });
    return employees.map((employee) => this.toSummary(employee));
  }

  async get(auth: AuthContext, id: string): Promise<StaffSummary> {
    const employee = await this.findEmployeeOrThrow(id);
    await this.wardAccessibleOrThrow(auth, employee.wardId);
    return this.toSummary(employee);
  }

  async create(
    auth: AuthContext,
    input: CreateEmployeeInput,
    meta: RequestMeta,
  ): Promise<StaffSummary> {
    await this.wardAccessibleOrThrow(auth, input.wardId);
    const phone = normalizePhone(input.phone);
    try {
      const employee = await this.prisma.client.$transaction(async (tx) => {
        const created = await tx.employee.create({ data: {
          employeeNumber: input.employeeNumber,
          fullName: input.fullName,
          phone,
          email: input.email ?? null,
          designation: input.designation,
          wardId: input.wardId,
          profile: {
            create: {
              residence: input.residence ?? null,
              rosterStatus: input.rosterStatus,
            },
          },
          assignments: { create: { wardId: input.wardId, kind: "PRIMARY" } },
        }, include: { profile: true, assignments: true, ward: true } });
        await this.audit.record({
        action: "EMPLOYEE.CREATED",
        targetType: "Employee",
        targetId: created.id,
        scopeType: "WARD",
        scopeId: created.wardId,
        actorUserId: auth.userId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
        details: input.employeeNumber,
        }, tx);
        return created;
      });
      return this.toSummary(employee);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("Employee number or phone already exists");
      }
      throw error;
    }
  }

  async update(
    auth: AuthContext,
    id: string,
    input: UpdateEmployeeInput,
    meta: RequestMeta,
  ): Promise<StaffSummary> {
    const existing = await this.findEmployeeOrThrow(id);
    await this.wardAccessibleOrThrow(auth, existing.wardId);

    const data: Prisma.EmployeeUpdateInput = {};
    if (input.employeeNumber !== undefined) data.employeeNumber = input.employeeNumber;
    if (input.fullName !== undefined) data.fullName = input.fullName;
    if (input.phone !== undefined) data.phone = normalizePhone(input.phone);
    if (input.email !== undefined) data.email = input.email;
    if (input.designation !== undefined) data.designation = input.designation;

    const profileData: Prisma.EmployeeProfileUpdateInput = {};
    if (input.residence !== undefined) profileData.residence = input.residence;
    if (input.rosterStatus !== undefined) profileData.rosterStatus = input.rosterStatus;

    try {
      const employee = await this.prisma.client.$transaction(async (tx) => {
        const updated = await tx.employee.update({
          where: { id },
          data: {
            ...data,
            profile: {
              upsert: {
                create: {
                  residence: input.residence ?? null,
                  rosterStatus: input.rosterStatus ?? existing.profile?.rosterStatus ?? "ON_DUTY",
                },
                update: profileData,
              },
            },
          },
          include: { profile: true, assignments: true, ward: true },
        });
        await this.audit.record({
          action: "EMPLOYEE.UPDATED",
          targetType: "Employee",
          targetId: id,
          scopeType: "WARD",
          scopeId: updated.wardId,
          actorUserId: auth.userId,
          sourceIp: meta.sourceIp,
          requestId: meta.requestId,
          details: input.employeeNumber ?? existing.employeeNumber,
        }, tx);
        return updated;
      });
      return this.toSummary(employee);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("Employee number or phone already exists");
      }
      throw error;
    }
  }

  async assign(
    auth: AuthContext,
    id: string,
    input: CreateEmployeeAssignmentInput,
    meta: RequestMeta,
  ): Promise<StaffSummary> {
    const employee = await this.findEmployeeOrThrow(id);
    await this.wardAccessibleOrThrow(auth, employee.wardId);
    await this.wardAccessibleOrThrow(auth, input.wardId);

    if (input.wardId === employee.wardId) {
      throw new ConflictException("Employee already belongs to that ward");
    }
    try {
      await this.prisma.client.$transaction(async (tx) => {
        if (input.type === "TRANSFER") {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`employee:${id}`}))`;
          const transferredAt = new Date();
          const primary = await tx.employeeAssignment.findFirst({
            where: { employeeId: id, kind: "PRIMARY", endedAt: null },
          });
          await tx.employeeAssignment.updateMany({
            where: { employeeId: id, endedAt: null },
            data: { endedAt: transferredAt },
          });
          if (!primary) {
            await tx.employeeAssignment.create({
              data: {
                employeeId: id,
                wardId: employee.wardId,
                kind: "PRIMARY",
                assignedAt: employee.createdAt,
                endedAt: transferredAt,
              },
            });
          }
          await tx.employee.update({ where: { id }, data: { wardId: input.wardId } });
          await tx.employeeAssignment.create({
            data: { employeeId: id, wardId: input.wardId, kind: "PRIMARY" },
          });
        } else {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`employee:${id}`}))`;
          const active = await tx.employeeAssignment.findFirst({
            where: { employeeId: id, wardId: input.wardId, endedAt: null },
          });
          if (active) throw new ConflictException("Employee is already assigned to that ward");
          await tx.employeeAssignment.create({
            data: { employeeId: id, wardId: input.wardId, kind: "TEMPORARY" },
          });
        }
        await this.audit.record({
          action: input.type === "TRANSFER" ? "EMPLOYEE.TRANSFERRED" : "EMPLOYEE.ASSIGNED_TEMPORARILY",
          targetType: "Employee",
          targetId: id,
          scopeType: "WARD",
          scopeId: input.wardId,
          actorUserId: auth.userId,
          sourceIp: meta.sourceIp,
          requestId: meta.requestId,
          details: `${employee.wardId} -> ${input.wardId}`,
        }, tx);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("Employee ID already exists in the destination ward");
      }
      throw error;
    }
    return this.get(auth, id);
  }

  async endAssignment(
    auth: AuthContext,
    employeeId: string,
    assignmentId: string,
    meta: RequestMeta,
  ): Promise<StaffSummary> {
    const employee = await this.findEmployeeOrThrow(employeeId);
    await this.wardAccessibleOrThrow(auth, employee.wardId);
    const assignment = employee.assignments.find((item) => item.id === assignmentId);
    if (!assignment || assignment.kind !== "TEMPORARY" || assignment.endedAt) {
      throw new ConflictException("Active temporary assignment not found");
    }
    await this.wardAccessibleOrThrow(auth, assignment.wardId);
    await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.employeeAssignment.updateMany({
        where: { id: assignmentId, employeeId, kind: "TEMPORARY", endedAt: null },
        data: { endedAt: new Date() },
      });
      if (result.count === 0) throw new ConflictException("Assignment was already ended");
      await this.audit.record({
      action: "EMPLOYEE.TEMPORARY_ASSIGNMENT_ENDED",
      targetType: "Employee",
      targetId: employeeId,
      scopeType: "WARD",
      scopeId: assignment.wardId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      details: assignmentId,
      }, tx);
    });
    return this.get(auth, employeeId);
  }

  async previewImport(
    auth: AuthContext,
    wardId: string,
    rows: ParsedStaffImportRow[],
    sourceName: string,
    meta: RequestMeta,
  ): Promise<{ rows: StaffImportRowResult[]; summary: Record<string, number> }> {
    await this.wardAccessibleOrThrow(auth, wardId);
    if (rows.length > 2000) throw new ConflictException("A roster import can contain at most 2000 rows");
    const parsed = rows.map((row) => ({ row, result: staffImportRowSchema.safeParse(row.value) }));
    const valid = parsed.flatMap(({ result }) => (result.success ? [result.data] : []));
    const existing = await this.prisma.client.employee.findMany({
      where: {
        OR: [
          { wardId, employeeNumber: { in: valid.map((row) => row.employeeNumber) } },
          { phone: { in: valid.map((row) => normalizePhone(row.phone)) } },
        ],
      },
    });
    const seenNumbers = new Set<string>();
    const seenPhones = new Set<string>();
    const results: StaffImportRowResult[] = parsed.map(({ row, result }) => {
      if (!result.success) {
        return {
          rowNumber: row.rowNumber,
          status: "INVALID",
          value: row.value,
          errors: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
        };
      }
      const value = result.data;
      const phone = normalizePhone(value.phone);
      if (seenNumbers.has(value.employeeNumber) || seenPhones.has(phone)) {
        return { rowNumber: row.rowNumber, status: "DUPLICATE_FILE", value };
      }
      seenNumbers.add(value.employeeNumber);
      seenPhones.add(phone);
      const byNumber = existing.find(
        (employee) => employee.wardId === wardId && employee.employeeNumber === value.employeeNumber,
      );
      const byPhone = existing.find((employee) => employee.phone === phone);
      if (byPhone && byPhone.id !== byNumber?.id) {
        return {
          rowNumber: row.rowNumber,
          status: "CONFLICT",
          value,
          employeeId: byPhone.id,
          errors: ["Phone belongs to another employee"],
        };
      }
      return {
        rowNumber: row.rowNumber,
        status: byNumber ? "UPDATE" : "CREATE",
        value,
        employeeId: byNumber?.id,
      };
    });
    const summary = summarizeImport(results);
    await this.audit.record({
      action: "EMPLOYEE.IMPORT_PREVIEWED",
      targetType: "StaffImport",
      scopeType: "WARD",
      scopeId: wardId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      details: JSON.stringify({
        sourceName,
        summary,
        rows: results.map(({ rowNumber, status, employeeId, errors }) => ({
          rowNumber,
          status,
          employeeId,
          errors,
        })),
      }),
    });
    return { rows: results, summary };
  }

  async commitImport(
    auth: AuthContext,
    input: CommitStaffImportInput,
    meta: RequestMeta,
  ): Promise<{ importId: string; rows: StaffImportRowResult[]; summary: Record<string, number> }> {
    await this.wardAccessibleOrThrow(auth, input.wardId);
    const importId = randomUUID();
    const results = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`staff-import:${input.wardId}`}))`;
      const rowResults: StaffImportRowResult[] = [];
      const seenNumbers = new Set<string>();
      const seenPhones = new Set<string>();
      for (const [index, value] of input.rows.entries()) {
        const rowNumber = index + 2;
        const phone = normalizePhone(value.phone);
        if (seenNumbers.has(value.employeeNumber) || seenPhones.has(phone)) {
          rowResults.push({ rowNumber, status: "DUPLICATE_FILE", value });
          continue;
        }
        seenNumbers.add(value.employeeNumber);
        seenPhones.add(phone);
        const byNumber = await tx.employee.findFirst({
          where: { wardId: input.wardId, employeeNumber: value.employeeNumber },
        });
        const byPhone = await tx.employee.findUnique({ where: { phone } });
        if (byPhone && byPhone.id !== byNumber?.id) {
          rowResults.push({
            rowNumber,
            status: "CONFLICT",
            value,
            employeeId: byPhone.id,
            errors: ["Phone belongs to another employee"],
          });
          continue;
        }
        if (byNumber && input.duplicateStrategy === "SKIP") {
          rowResults.push({ rowNumber, status: "SKIPPED", value, employeeId: byNumber.id });
          continue;
        }
        if (byNumber) {
          const updated = await tx.employee.update({
            where: { id: byNumber.id },
            data: {
              fullName: value.fullName,
              phone,
              email: value.email ?? null,
              designation: value.designation,
              profile: {
                upsert: {
                  create: { residence: value.residence ?? null, rosterStatus: value.rosterStatus },
                  update: { residence: value.residence ?? null, rosterStatus: value.rosterStatus },
                },
              },
            },
          });
          rowResults.push({ rowNumber, status: "UPDATE", value, employeeId: updated.id });
        } else {
          const created = await tx.employee.create({
            data: {
              employeeNumber: value.employeeNumber,
              fullName: value.fullName,
              phone,
              email: value.email ?? null,
              designation: value.designation,
              wardId: input.wardId,
              profile: { create: { residence: value.residence ?? null, rosterStatus: value.rosterStatus } },
              assignments: { create: { wardId: input.wardId, kind: "PRIMARY" } },
            },
          });
          rowResults.push({ rowNumber, status: "CREATE", value, employeeId: created.id });
        }
      }
      const summary = summarizeImport(rowResults);
      await this.audit.record({
        action: "EMPLOYEE.IMPORT_COMMITTED",
        targetType: "StaffImport",
        targetId: importId,
        scopeType: "WARD",
        scopeId: input.wardId,
        actorUserId: auth.userId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
        details: JSON.stringify({
          sourceName: input.sourceName ?? null,
          duplicateStrategy: input.duplicateStrategy,
          summary,
          rows: rowResults,
        }),
      }, tx);
      return rowResults;
    });
    const summary = summarizeImport(results);
    return { importId, rows: results, summary };
  }

  async importHistory(auth: AuthContext, query: StaffImportHistoryQueryInput) {
    const wardIds = (await this.scope.accessibleWards(auth)).map((ward) => ward.id);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const where = {
      action: { in: ["EMPLOYEE.IMPORT_PREVIEWED", "EMPLOYEE.IMPORT_COMMITTED"] },
      scopeType: "WARD" as const,
      scopeId: { in: wardIds },
    };
    const [items, total] = await Promise.all([
      this.prisma.client.auditEvent.findMany({ where, orderBy: { occurredAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.client.auditEvent.count({ where }),
    ]);
    return { items, page, pageSize, total };
  }

  async setActive(
    auth: AuthContext,
    id: string,
    active: boolean,
    meta: RequestMeta,
  ): Promise<StaffSummary> {
    const employee = await this.findEmployeeOrThrow(id);
    await this.wardAccessibleOrThrow(auth, employee.wardId);
    if (employee.active === active) {
      throw new ConflictException(`Employee is already ${active ? "active" : "deactivated"}`);
    }
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const changed = await tx.employee.update({
        where: { id },
        data: { active, deactivatedAt: active ? null : new Date() },
        include: { profile: true, assignments: true, ward: true },
      });
      await this.audit.record({
      action: active ? "EMPLOYEE.REACTIVATED" : "EMPLOYEE.DEACTIVATED",
      targetType: "Employee",
      targetId: id,
      scopeType: "WARD",
      scopeId: changed.wardId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      }, tx);
      return changed;
    });
    return this.toSummary(updated);
  }
}

function summarizeImport(rows: StaffImportRowResult[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((summary, row) => {
    summary[row.status] = (summary[row.status] ?? 0) + 1;
    return summary;
  }, {});
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}
