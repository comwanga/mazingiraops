import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@ward-ops/database";
import type { WorkLogStatus } from "@ward-ops/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthContext } from "../auth/auth-context";
import { ScopeService } from "../authorization/scope.service";
import type { CreateWorkLogInput, WorkLogActionInput, WorkLogQueryInput } from "@ward-ops/validation";
import { nextWorkLogStatus } from "./work-log-transitions";

export interface RequestMeta {
  sourceIp?: string;
  requestId?: string;
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

const ACTION_AUDIT: Record<string, string> = {
  SUBMIT: "WORK_LOG.SUBMITTED",
  APPROVE: "WORK_LOG.APPROVED",
  REJECT: "WORK_LOG.REJECTED",
};

const ACTION_CAPABILITY: Record<string, "WORK_CREATE" | "WORK_REVIEW"> = {
  SUBMIT: "WORK_CREATE",
  APPROVE: "WORK_REVIEW",
  REJECT: "WORK_REVIEW",
};

type WorkLogWithRelations = Prisma.WorkLogGetPayload<{
  include: {
    detail: true;
    operations: true;
  };
}>;

@Injectable()
export class WorkLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  // -- Helpers ----------------------------------------------------------------

  private async wardAccessibleOrThrow(auth: AuthContext, wardId: string): Promise<void> {
    if (!(await this.scope.wardAccessible(auth, wardId))) {
      throw new ForbiddenException("Ward is outside your scope");
    }
  }

  private async accessibleWardIds(auth: AuthContext): Promise<string[]> {
    return (await this.scope.accessibleWards(auth)).map((ward) => ward.id);
  }

  private async findOrThrow(id: string): Promise<WorkLogWithRelations> {
    const workLog = await this.prisma.client.workLog.findUnique({
      where: { id },
      include: { detail: true, operations: true },
    });
    if (!workLog) {
      throw new NotFoundException("Work log not found");
    }
    return workLog;
  }

  private toSummary(workLog: WorkLogWithRelations): Record<string, unknown> {
    return {
      id: workLog.id,
      wardId: workLog.wardId,
      workDate: toDateOnly(workLog.workDate),
      activity: workLog.activity,
      location: workLog.location,
      description: workLog.description,
      staffCount: workLog.staffCount,
      challenges: workLog.challenges,
      suggestedSolutions: workLog.suggestedSolutions,
      truthConfirmed: workLog.truthConfirmed,
      status: workLog.status,
      version: workLog.version,
      submittedBy: workLog.submittedBy,
      reviewedBy: workLog.reviewedBy,
      reviewNote: workLog.reviewNote,
      createdAt: workLog.createdAt,
      reviewedAt: workLog.reviewedAt,
      detail: {
        completionStatus: workLog.detail?.completionStatus ?? "COMPLETE",
        outstandingWork: workLog.detail?.outstandingWork ?? null,
      },
      operations: {
        areasRoads: workLog.operations?.areasRoads ?? "",
        numberOfTrips: workLog.operations?.numberOfTrips ?? 0,
        wasteTransferInvolved: workLog.operations?.wasteTransferInvolved ?? false,
        truckId: workLog.operations?.truckId ?? null,
        backhoeId: workLog.operations?.backhoeId ?? null,
        cleanupDone: workLog.operations?.cleanupDone ?? false,
        cleanupStakeholders: workLog.operations?.cleanupStakeholders ?? null,
        climateTeamCount: workLog.operations?.climateTeamCount ?? 0,
      },
    };
  }

  // -- Create ----------------------------------------------------------------

  async create(
    auth: AuthContext,
    input: CreateWorkLogInput,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    await this.wardAccessibleOrThrow(auth, input.wardId);
    const workDate = new Date(`${input.workDate}T00:00:00.000Z`);

    const workLog = await this.prisma.client.$transaction(async (tx) => {
      if (input.clientSubmissionId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-log-submission:${input.clientSubmissionId}`}))`;
        const existing = await tx.workLog.findUnique({
          where: { clientSubmissionId: input.clientSubmissionId },
          include: { detail: true, operations: true },
        });
        if (existing) {
          if (existing.submittedBy !== auth.userId || existing.wardId !== input.wardId) {
            throw new NotFoundException("Work log not found");
          }
          return existing;
        }
      }

      const created = await tx.workLog.create({
        data: {
          wardId: input.wardId,
          workDate,
          activity: input.activity,
          location: input.location,
          description: input.description,
          staffCount: input.staffCount,
          challenges: input.challenges?.trim() || null,
          suggestedSolutions: input.suggestedSolutions?.trim() || null,
          truthConfirmed: input.truthConfirmed,
          clientSubmissionId: input.clientSubmissionId ?? null,
          status: "DRAFT",
          submittedBy: auth.userId,
          detail: {
            create: {
              completionStatus: input.completionStatus,
              outstandingWork: input.outstandingWork.trim() || null,
            },
          },
          operations: {
            create: {
              areasRoads: input.areasRoads,
              numberOfTrips: input.numberOfTrips,
              wasteTransferInvolved: input.wasteTransferInvolved,
              truckId: input.truckId.trim() || null,
              backhoeId: input.backhoeId.trim() || null,
              cleanupDone: input.cleanupDone,
              cleanupStakeholders: input.cleanupStakeholders.trim() || null,
              climateTeamCount: input.climateTeamCount,
            },
          },
        },
        include: { detail: true, operations: true },
      });

      await this.audit.record({
        action: "WORK_LOG.DRAFT_CREATED",
        targetType: "WorkLog",
        targetId: created.id,
        scopeType: "WARD",
        scopeId: created.wardId,
        actorUserId: auth.userId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
        details: `${input.activity} ${input.completionStatus} truth-confirmed`,
      }, tx);
      return created;
    });
    return this.toSummary(workLog);
  }

  // -- Reads -----------------------------------------------------------------

  async list(auth: AuthContext, query: WorkLogQueryInput): Promise<Array<Record<string, unknown>>> {
    const wardIds = await this.accessibleWardIds(auth);
    const where: Prisma.WorkLogWhereInput = {
      wardId: { in: wardIds },
      OR: [{ status: { not: "DRAFT" } }, { submittedBy: auth.userId }],
    };
    if (query.wardId) {
      if (!wardIds.includes(query.wardId)) return [];
      where.wardId = query.wardId;
    }
    if (query.status) where.status = query.status;
    if (query.workDate) where.workDate = new Date(`${query.workDate}T00:00:00.000Z`);

    const workLogs = await this.prisma.client.workLog.findMany({
      where,
      include: { detail: true, operations: true },
      orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
      skip: query.page ? (query.page - 1) * (query.pageSize ?? 25) : undefined,
      take: query.page || query.pageSize ? query.pageSize ?? 25 : undefined,
    });
    return workLogs.map((workLog) => this.toSummary(workLog));
  }

  async get(auth: AuthContext, id: string): Promise<Record<string, unknown>> {
    const workLog = await this.findOrThrow(id);
    if (!(await this.scope.wardAccessible(auth, workLog.wardId))) {
      throw new NotFoundException("Work log not found");
    }
    if (workLog.status === "DRAFT" && workLog.submittedBy !== auth.userId) {
      throw new NotFoundException("Work log not found");
    }
    return this.toSummary(workLog);
  }

  // -- Transitions -----------------------------------------------------------

  async action(
    auth: AuthContext,
    id: string,
    input: WorkLogActionInput,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const workLog = await this.findOrThrow(id);
    if (!(await this.scope.wardAccessible(auth, workLog.wardId))) {
      throw new NotFoundException("Work log not found");
    }

    const required = ACTION_CAPABILITY[input.action];
    if (!required || !auth.capabilities.includes(required)) {
      throw new ForbiddenException("You do not have permission for this action");
    }
    if (input.action === "SUBMIT" && workLog.submittedBy !== auth.userId) {
      throw new ForbiddenException("Only the officer who created the draft can submit it");
    }
    if (workLog.version !== input.expectedVersion) {
      throw new ConflictException("Work log changed; reload it before taking action");
    }

    const next = nextWorkLogStatus(workLog.status, input.action);
    if (!next) {
      throw new ConflictException(
        `A work log in ${workLog.status} cannot be ${input.action.toLowerCase()}d`,
      );
    }

    if (input.action === "REJECT" && input.reviewNote.trim().length < 3) {
      throw new BadRequestException("A rejection note is required");
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-log:${id}`}))`;
      if (input.action === "SUBMIT") {
        const evidenceCount = await tx.evidence.count({ where: { workLogId: id } });
        if (evidenceCount === 0) {
          throw new BadRequestException("Upload at least one work photo before submitting");
        }
      }
      const result = await tx.workLog.updateMany({
        where: { id, version: input.expectedVersion, status: workLog.status },
        data: {
          status: next as WorkLogStatus,
          version: { increment: 1 },
          reviewedBy: input.action === "SUBMIT" ? undefined : auth.userId,
          reviewedAt: input.action === "SUBMIT" ? undefined : new Date(),
          reviewNote: input.action === "SUBMIT" ? undefined : input.reviewNote.trim() || null,
        },
      });
      if (result.count === 0) {
        throw new ConflictException("Work log changed; reload it before taking action");
      }
      const reviewed = await tx.workLog.findUniqueOrThrow({
        where: { id },
        include: { detail: true, operations: true },
      });
      await this.audit.record({
        action: ACTION_AUDIT[input.action],
        targetType: "WorkLog",
        targetId: id,
        scopeType: "WARD",
        scopeId: reviewed.wardId,
        actorUserId: auth.userId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
        details: `${workLog.status} -> ${next}`,
      }, tx);
      return reviewed;
    });
    return this.toSummary(updated);
  }
}
