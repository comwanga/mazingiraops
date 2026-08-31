import { randomBytes } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { AttendanceStatus, Prisma } from "@ward-ops/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthContext } from "../auth/auth-context";
import { ScopeService } from "../authorization/scope.service";
import { CheckInThrottleService } from "./check-in-throttle.service";
import type {
  AttendanceQueryInput,
  CheckInInput,
  CorrectAttendanceInput,
  CreateAttendanceSessionInput,
  ExtendAttendanceSessionInput,
  ManualAttendanceInput,
  ReviewAttendanceAbsenceInput,
  RosterQueryInput,
} from "@ward-ops/validation";

export interface RequestMeta {
  sourceIp?: string;
  requestId?: string;
}

const NAIROBI_TZ = "Africa/Nairobi";

export function todayNairobi(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NAIROBI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function sessionToken(): string {
  return randomBytes(24).toString("base64url");
}

const LATE_THRESHOLD_MINUTES = 30;

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly throttle: CheckInThrottleService,
  ) {}

  private async wardAccessibleOrThrow(auth: AuthContext, wardId: string): Promise<void> {
    if (!(await this.scope.wardAccessible(auth, wardId))) {
      throw new ForbiddenException("Ward is outside your scope");
    }
  }

  private async accessibleWardIds(auth: AuthContext): Promise<string[]> {
    return (await this.scope.accessibleWards(auth)).map((ward) => ward.id);
  }

  private async sessionVisible(auth: AuthContext, session: {
    wardId: string;
  }): Promise<void> {
    if (!(await this.scope.wardAccessible(auth, session.wardId))) {
      throw new NotFoundException("Attendance session not found");
    }
  }

  /**
   * Resolves the employee for a QR check-in deterministically. Employee
   * numbers are only unique within a ward, so prefer the employee homed in the
   * session ward before falling back to one actively assigned to it.
   */
  private async findCheckInEmployee(
    employeeNumber: string,
    wardId: string,
  ): Promise<Prisma.EmployeeGetPayload<{ include: { assignments: true } }> | null> {
    const homed = await this.prisma.client.employee.findFirst({
      where: { employeeNumber, active: true, wardId },
      include: { assignments: true },
    });
    if (homed) {
      return homed;
    }
    return this.prisma.client.employee.findFirst({
      where: {
        employeeNumber,
        active: true,
        assignments: { some: { wardId, endedAt: null } },
      },
      include: { assignments: true },
    });
  }

  // -- Sessions --------------------------------------------------------------

  async createSession(
    auth: AuthContext,
    input: CreateAttendanceSessionInput,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    await this.wardAccessibleOrThrow(auth, input.wardId);
    const workDate = input.workDate ?? todayNairobi();
    const workDateDate = toDateOnly(workDate);

    // Serialize session creation per ward+date using a Postgres advisory lock
    // so concurrent requests cannot both pass the active-session check below.
    // (A partial unique index cannot use now(), which is not IMMUTABLE.)
    const session = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`session:${input.wardId}:${workDate}`}))`;

      const active = await tx.attendanceSession.findFirst({
        where: {
          wardId: input.wardId,
          workDate: workDateDate,
          closesAt: { gt: new Date() },
        },
      });
      if (active) {
        throw new ConflictException("An attendance session is already active for this ward on that date");
      }

      const opensAt = new Date();
      const closesAt = new Date(opensAt.getTime() + input.durationMinutes * 60 * 1000);
      return tx.attendanceSession.create({
        data: {
          token: sessionToken(),
          wardId: input.wardId,
          workDate: workDateDate,
          activity: input.activity,
          location: input.location,
          opensAt,
          closesAt,
          createdBy: auth.userId,
        },
      });
    });

    const closesAt = session.closesAt;
    await this.audit.record({
      action: "ATTENDANCE.SESSION_CREATED",
      targetType: "AttendanceSession",
      targetId: session.id,
      scopeType: "WARD",
      scopeId: session.wardId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      details: `Closes ${closesAt.toISOString()}`,
    });

    return {
      id: session.id,
      token: session.token,
      wardId: session.wardId,
      workDate,
      activity: session.activity,
      location: session.location,
      opensAt: session.opensAt,
      closesAt: session.closesAt,
    };
  }

  async listSessions(auth: AuthContext, query: AttendanceQueryInput): Promise<Array<Record<string, unknown>>> {
    const wardIds = await this.accessibleWardIds(auth);
    const where: Prisma.AttendanceSessionWhereInput = {
      wardId: { in: wardIds },
    };
    if (query.wardId) {
      if (!wardIds.includes(query.wardId)) {
        return [];
      }
      where.wardId = query.wardId;
    }
    if (query.workDate) {
      where.workDate = toDateOnly(query.workDate);
    }
    if (query.active !== undefined) {
      where.closesAt = query.active ? { gt: new Date() } : { lte: new Date() };
    }
    const sessions = await this.prisma.client.attendanceSession.findMany({
      where,
      include: { ward: true },
      orderBy: { createdAt: "desc" },
      skip: query.page ? (query.page - 1) * (query.pageSize ?? 25) : undefined,
      take: query.page || query.pageSize ? query.pageSize ?? 25 : undefined,
    });
    const canManage = auth.capabilities.includes("ATTENDANCE_MANAGE");
    return sessions.map((session) => ({
      id: session.id,
      token: canManage ? session.token : undefined,
      wardId: session.wardId,
      ward: { id: session.ward.id, code: session.ward.code, name: session.ward.name },
      workDate: session.workDate,
      activity: session.activity,
      location: session.location,
      opensAt: session.opensAt,
      closesAt: session.closesAt,
      active: session.closesAt > new Date(),
      createdAt: session.createdAt,
    }));
  }

  async getSession(auth: AuthContext, id: string): Promise<Record<string, unknown>> {
    const session = await this.prisma.client.attendanceSession.findUnique({
      where: { id },
      include: { ward: true },
    });
    if (!session) {
      throw new NotFoundException("Attendance session not found");
    }
    await this.sessionVisible(auth, session);
    const canManage = auth.capabilities.includes("ATTENDANCE_MANAGE");
    return {
      id: session.id,
      token: canManage ? session.token : undefined,
      wardId: session.wardId,
      ward: { id: session.ward.id, code: session.ward.code, name: session.ward.name },
      workDate: session.workDate,
      activity: session.activity,
      location: session.location,
      opensAt: session.opensAt,
      closesAt: session.closesAt,
      active: session.closesAt > new Date(),
      createdAt: session.createdAt,
    };
  }

  async closeSession(
    auth: AuthContext,
    id: string,
    revoke: boolean,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const session = await this.prisma.client.attendanceSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException("Attendance session not found");
    await this.sessionVisible(auth, session);
    if (session.closesAt <= new Date()) throw new ConflictException("Attendance session is already closed");
    const result = await this.prisma.client.attendanceSession.updateMany({
      where: { id, closesAt: { gt: new Date() } },
      data: { closesAt: new Date(), ...(revoke ? { token: sessionToken() } : {}) },
    });
    if (result.count === 0) throw new ConflictException("Attendance session is already closed");
    const updated = await this.prisma.client.attendanceSession.findUniqueOrThrow({ where: { id } });
    await this.audit.record({
      action: revoke ? "ATTENDANCE.SESSION_REVOKED" : "ATTENDANCE.SESSION_CLOSED",
      targetType: "AttendanceSession",
      targetId: id,
      scopeType: "WARD",
      scopeId: session.wardId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
    });
    return { id: updated.id, wardId: updated.wardId, closesAt: updated.closesAt, active: false };
  }

  async extendSession(
    auth: AuthContext,
    id: string,
    input: ExtendAttendanceSessionInput,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const updated = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`attendance-session:${id}`}))`;
      const session = await tx.attendanceSession.findUnique({ where: { id } });
      if (!session) throw new NotFoundException("Attendance session not found");
      await this.sessionVisible(auth, session);
      if (session.closesAt <= new Date()) {
        throw new ConflictException("Only an active attendance session can be extended");
      }
      const closesAt = new Date(session.closesAt.getTime() + input.extensionMinutes * 60 * 1000);
      const result = await tx.attendanceSession.updateMany({
        where: { id, closesAt: session.closesAt },
        data: { closesAt },
      });
      if (result.count === 0) throw new ConflictException("Attendance session changed; refresh and try again");
      return { session, closesAt };
    });

    await this.audit.record({
      action: "ATTENDANCE.SESSION_EXTENDED",
      targetType: "AttendanceSession",
      targetId: id,
      scopeType: "WARD",
      scopeId: updated.session.wardId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      details: `${input.extensionMinutes} minutes; closes ${updated.closesAt.toISOString()}`,
    });
    return { id, wardId: updated.session.wardId, closesAt: updated.closesAt, active: true };
  }

  // -- QR check-in ------------------------------------------------------------

  async checkIn(input: CheckInInput, meta: RequestMeta): Promise<Record<string, unknown>> {
    const key = `${meta.sourceIp ?? "unknown"}:${input.sessionToken}`;
    this.throttle.check(key);

    const session = await this.prisma.client.attendanceSession.findUnique({
      where: { token: input.sessionToken },
    });
    const now = new Date();
    if (!session || !(session.opensAt <= now && now <= session.closesAt)) {
      this.throttle.recordFailure(key);
      throw new BadRequestException("This attendance session is not open. Contact your supervisor.");
    }

    const employee = await this.findCheckInEmployee(input.employeeNumber, session.wardId);

    if (!employee) {
      this.throttle.recordFailure(key);
      await this.audit.record({
        action: "ATTENDANCE.CHECKIN_FAILED",
        targetType: "AttendanceSession",
        targetId: session.id,
        scopeType: "WARD",
        scopeId: session.wardId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
        details: "Payroll number was not found in the session ward",
      });
      throw new BadRequestException("Payroll number was not found for this attendance session.");
    }

    const isAbsenceDeclaration = input.attendanceIntent === "ABSENT";
    const status: AttendanceStatus = isAbsenceDeclaration
      ? "ABSENT"
      : now.getTime() > session.opensAt.getTime() + LATE_THRESHOLD_MINUTES * 60 * 1000
          ? "LATE"
          : "PRESENT";

    if (!isAbsenceDeclaration) {
      const pendingAbsence = await this.prisma.client.attendance.findUnique({
        where: { employeeId_workDate: { employeeId: employee.id, workDate: session.workDate } },
      });
      if (pendingAbsence?.absenceReviewStatus === "PENDING" && pendingAbsence.absenceReason) {
        const replaced = await this.prisma.client.attendance.updateMany({
          where: { id: pendingAbsence.id, status: "ABSENT", absenceReviewStatus: "PENDING" },
          data: {
            status,
            checkedAt: now,
            absenceReviewStatus: "REJECTED",
            reviewVersion: { increment: 1 },
            reviewNote: "Superseded by employee QR attendance",
            reviewedAt: now,
            latitude: input.latitude ?? null,
            longitude: input.longitude ?? null,
          },
        });
        if (replaced.count === 1) {
          this.throttle.recordSuccess(key);
          await this.audit.record({
            action: "ATTENDANCE.ABSENCE_SUPERSEDED",
            targetType: "Attendance",
            targetId: pendingAbsence.id,
            scopeType: "WARD",
            scopeId: session.wardId,
            sourceIp: meta.sourceIp,
            requestId: meta.requestId,
            details: `${pendingAbsence.absenceReason} -> ${status}`,
          });
          return {
            ok: true,
            status,
            message: "Attendance confirmed. The pending absence declaration was withdrawn.",
            checkedAt: now,
            employee: { id: employee.id, fullName: employee.fullName },
          };
        }
      }
    }

    try {
      const record = await this.prisma.client.attendance.create({
        data: {
          employeeId: employee.id,
          sessionId: session.id,
          wardId: session.wardId,
          workDate: session.workDate,
          checkedAt: now,
          status,
          verificationMethod: "QR",
          absenceReason: isAbsenceDeclaration ? input.absenceReason : null,
          absenceReviewStatus: isAbsenceDeclaration ? "PENDING" : null,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
        },
      });
      this.throttle.recordSuccess(key);
      await this.audit.record({
        action: isAbsenceDeclaration ? "ATTENDANCE.ABSENCE_DECLARED" : "ATTENDANCE.CHECKED_IN",
        targetType: "Employee",
        targetId: employee.id,
        scopeType: "WARD",
        scopeId: session.wardId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
        details: isAbsenceDeclaration ? `Pending ${input.absenceReason}` : `Status ${status}`,
      });
      return {
        ok: true,
        status,
        absenceReason: isAbsenceDeclaration ? input.absenceReason : undefined,
        approvalStatus: isAbsenceDeclaration ? "PENDING" : undefined,
        message: isAbsenceDeclaration ? "Absence declaration submitted for supervisor approval." : undefined,
        checkedAt: record.checkedAt,
        employee: { id: employee.id, fullName: employee.fullName },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Your attendance has already been recorded today.");
      }
      throw error;
    }
  }

  // -- Manual / supervised attendance ------------------------------------------

  async manual(
    auth: AuthContext,
    input: ManualAttendanceInput,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const session = await this.prisma.client.attendanceSession.findUnique({ where: { id: input.sessionId } });
    if (!session) throw new NotFoundException("Attendance session not found");
    await this.sessionVisible(auth, session);
    if (session.workDate.getTime() !== toDateOnly(input.workDate).getTime()) {
      throw new BadRequestException("Work date does not match the selected attendance session");
    }
    const employee = await this.prisma.client.employee.findFirst({
      where: {
        id: input.employeeId,
        active: true,
        OR: [
          { wardId: session.wardId },
          { assignments: { some: { wardId: session.wardId, endedAt: null } } },
        ],
      },
    });
    if (!employee || !employee.active) {
      throw new NotFoundException("Employee not found");
    }

    const workDateDate = toDateOnly(input.workDate);

    const existing = await this.prisma.client.attendance.findUnique({
      where: { employeeId_workDate: { employeeId: employee.id, workDate: workDateDate } },
    });
    if (existing) {
      throw new ConflictException("Manual status is only allowed for staff who did not check in");
    }

    try {
      const record = await this.prisma.client.attendance.create({
        data: {
          employeeId: employee.id,
          sessionId: session.id,
          wardId: session.wardId,
          workDate: workDateDate,
          checkedAt: new Date(),
          status: input.status,
          verificationMethod: "MANUAL",
        },
      });
      await this.audit.record({
        action: "ATTENDANCE.MANUAL",
        targetType: "Employee",
        targetId: employee.id,
        scopeType: "WARD",
        scopeId: session.wardId,
        actorUserId: auth.userId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
        details: `${input.status}: ${input.reason}; session=${session.id}`,
      });
      return {
        id: record.id,
        employeeId: employee.id,
        status: record.status,
        workDate: input.workDate,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Attendance already exists for this employee on that date");
      }
      throw error;
    }
  }

  async correct(
    auth: AuthContext,
    attendanceId: string,
    input: CorrectAttendanceInput,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const existing = await this.prisma.client.attendance.findUnique({
      where: { id: attendanceId },
      include: { session: true },
    });
    if (!existing || existing.sessionId !== input.sessionId) {
      throw new NotFoundException("Attendance record not found in the selected session");
    }
    await this.sessionVisible(auth, existing.session);
    if (existing.absenceReviewStatus === "PENDING") {
      throw new ConflictException("Review the pending absence declaration before correcting attendance");
    }
    if (existing.status === input.status) throw new ConflictException("Attendance already has that status");
    const updated = await this.prisma.client.attendance.update({
      where: { id: attendanceId },
      data: {
        status: input.status,
        verificationMethod: "MANUAL",
        absenceReason: null,
        absenceReviewStatus: null,
        reviewedBy: null,
        reviewNote: null,
        reviewedAt: null,
      },
    });
    await this.audit.record({
      action: "ATTENDANCE.CORRECTED",
      targetType: "Attendance",
      targetId: attendanceId,
      scopeType: "WARD",
      scopeId: existing.wardId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      details: `${existing.status} -> ${input.status}: ${input.reason}; session=${input.sessionId}`,
    });
    return { id: updated.id, sessionId: updated.sessionId, status: updated.status, checkedAt: updated.checkedAt };
  }

  async reviewAbsence(
    auth: AuthContext,
    attendanceId: string,
    input: ReviewAttendanceAbsenceInput,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const existing = await this.prisma.client.attendance.findUnique({
      where: { id: attendanceId },
      include: { session: true },
    });
    if (!existing) throw new NotFoundException("Attendance record not found");
    await this.sessionVisible(auth, existing.session);
    if (!existing.absenceReason || existing.absenceReviewStatus !== "PENDING") {
      throw new ConflictException("This attendance record has no pending absence declaration");
    }
    if (existing.reviewVersion !== input.expectedVersion) {
      throw new ConflictException("This absence declaration changed; refresh and try again");
    }

    const approvedStatus: AttendanceStatus = existing.absenceReason === "SICK_OFF" ? "SICK_OFF" : "OFF_DUTY";
    const nextStatus: AttendanceStatus = input.action === "APPROVE" ? approvedStatus : "ABSENT";
    const reviewStatus = input.action === "APPROVE" ? "APPROVED" : "REJECTED";
    const result = await this.prisma.client.attendance.updateMany({
      where: {
        id: attendanceId,
        status: "ABSENT",
        absenceReviewStatus: "PENDING",
        reviewVersion: input.expectedVersion,
      },
      data: {
        status: nextStatus,
        absenceReviewStatus: reviewStatus,
        reviewVersion: { increment: 1 },
        reviewedBy: auth.userId,
        reviewNote: input.reviewNote || null,
        reviewedAt: new Date(),
      },
    });
    if (result.count === 0) {
      throw new ConflictException("This absence declaration changed; refresh and try again");
    }

    await this.audit.record({
      action: `ATTENDANCE.ABSENCE_${reviewStatus}`,
      targetType: "Attendance",
      targetId: attendanceId,
      scopeType: "WARD",
      scopeId: existing.wardId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      details: `${existing.absenceReason} -> ${nextStatus}`,
    });
    return {
      id: attendanceId,
      sessionId: existing.sessionId,
      status: nextStatus,
      absenceReason: existing.absenceReason,
      absenceReviewStatus: reviewStatus,
      reviewVersion: input.expectedVersion + 1,
    };
  }

  // -- Reads ------------------------------------------------------------------

  async listAttendance(auth: AuthContext, query: AttendanceQueryInput): Promise<Array<Record<string, unknown>>> {
    const wardIds = await this.accessibleWardIds(auth);
    const where: Prisma.AttendanceWhereInput = { wardId: { in: wardIds } };
    if (query.wardId) {
      if (!wardIds.includes(query.wardId)) {
        return [];
      }
      where.wardId = query.wardId;
    }
    if (query.sessionId) where.sessionId = query.sessionId;
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.workDate) where.workDate = toDateOnly(query.workDate);
    if (query.status) where.status = query.status;

    const records = await this.prisma.client.attendance.findMany({
      where,
      include: {
        employee: { select: { id: true, employeeNumber: true, fullName: true } },
        session: { select: { id: true, activity: true, location: true } },
      },
      orderBy: [{ workDate: "desc" }, { checkedAt: "desc" }],
      skip: query.page ? (query.page - 1) * (query.pageSize ?? 25) : undefined,
      take: query.page || query.pageSize ? query.pageSize ?? 25 : undefined,
    });
    return records.map((record) => ({
      id: record.id,
      employeeId: record.employeeId,
      employeeNumber: record.employee.employeeNumber,
      fullName: record.employee.fullName,
      wardId: record.wardId,
      sessionId: record.sessionId,
      sessionActivity: record.session.activity,
      workDate: record.workDate,
      checkedAt: record.checkedAt,
      status: record.status,
      verificationMethod: record.verificationMethod,
      absenceReason: record.absenceReason,
      absenceReviewStatus: record.absenceReviewStatus,
      reviewVersion: record.reviewVersion,
      reviewNote: record.reviewNote,
    }));
  }

  async roster(auth: AuthContext, query: RosterQueryInput): Promise<Array<Record<string, unknown>>> {
    await this.wardAccessibleOrThrow(auth, query.wardId);
    const workDate = query.workDate ?? todayNairobi();
    const workDateDate = toDateOnly(workDate);
    const nextDate = new Date(workDateDate.getTime() + 24 * 60 * 60 * 1000);

    const employees = await this.prisma.client.employee.findMany({
      where: {
        OR: [{ active: true }, { deactivatedAt: { gte: workDateDate } }],
        AND: [{
          OR: [
            {
              assignments: {
                some: {
                  wardId: query.wardId,
                  assignedAt: { lt: nextDate },
                  OR: [{ endedAt: null }, { endedAt: { gte: workDateDate } }],
                },
              },
            },
            {
              wardId: query.wardId,
              assignments: { none: { kind: "PRIMARY" } },
            },
          ],
        }],
      },
      include: { profile: true },
      orderBy: { fullName: "asc" },
    });

    const deployment = await this.prisma.client.attendanceSession.findFirst({
      where: {
        id: query.sessionId,
        wardId: query.wardId,
        workDate: workDateDate,
      },
      orderBy: { createdAt: "desc" },
    });
    const records = deployment
      ? await this.prisma.client.attendance.findMany({ where: { sessionId: deployment.id } })
      : [];
    const recordByEmployee = new Map(records.map((record) => [record.employeeId, record]));

    // Approved absences reconcile the roster so an employee on approved leave
    // or sick-off is never reported absent (legacy precedence).
    const approvedAbsences = await this.prisma.client.absenceRequest.findMany({
      where: {
        wardId: query.wardId,
        status: "APPROVED",
        startDate: { lte: workDateDate },
        endDate: { gte: workDateDate },
      },
    });
    const absenceByEmployee = new Map(
      approvedAbsences.map((absence) => [absence.employeeId, absence]),
    );

    return employees.map((employee) => {
      const record = recordByEmployee.get(employee.id);
      const absence = absenceByEmployee.get(employee.id);
      let status: AttendanceStatus;
      let detail: string;
      let manualEditable = false;
      if (record && (record.status === "PRESENT" || record.status === "LATE")) {
        status = record.status;
        detail = record.checkedAt.toISOString().slice(11, 16);
      } else if (absence) {
        status =
          absence.kind === "SICK_OFF"
            ? "SICK_OFF"
            : absence.kind === "OFFICIAL_DUTY"
              ? "OFFICIAL_DUTY"
              : "LEAVE";
        detail = `Approved ${absence.kind.replace(/_/g, " ").toLowerCase()} · returns ${formatReturnDate(absence.returnDate)}`;
      } else if (record) {
        status = record.status;
        detail = record.absenceReason
          ? record.absenceReviewStatus === "PENDING"
            ? `Awaiting approval: ${formatAbsenceReason(record.absenceReason)}`
            : `${formatAbsenceReason(record.absenceReason)} ${record.absenceReviewStatus?.toLowerCase()}`
          : "Manual status";
      } else if (employee.profile?.rosterStatus === "ANNUAL_LEAVE") {
        status = "LEAVE";
        detail = "Annual leave (staff roster)";
      } else {
        status = "ABSENT";
        detail = "No check-in";
        manualEditable = true;
      }
      return {
        employee: {
          id: employee.id,
          employeeNumber: employee.employeeNumber,
          fullName: employee.fullName,
        },
        status,
        detail,
        manualEditable,
        attendanceId: record?.id ?? null,
        sessionId: record?.sessionId ?? deployment?.id ?? null,
        correctionAllowed: Boolean(record),
        absenceReason: record?.absenceReason ?? null,
        absenceReviewStatus: record?.absenceReviewStatus ?? null,
        reviewVersion: record?.reviewVersion ?? null,
        approvalAllowed: record?.absenceReviewStatus === "PENDING",
      };
    });
  }
}

function formatAbsenceReason(value: "SICK_OFF" | "WEEKEND_OFF_DUTY"): string {
  return value === "SICK_OFF" ? "Sick off" : "Weekend off duty";
}

function formatReturnDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
  }).format(value);
}
