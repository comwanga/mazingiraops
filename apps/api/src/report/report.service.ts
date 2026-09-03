import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@ward-ops/database";
import type { AttendanceStatus, EvidenceStage } from "@ward-ops/contracts";
import type {
  ReportAiDraftInput,
  ReportFinalizeInput,
  ReportPreviewQueryInput,
  ReportQueryInput,
} from "@ward-ops/validation";
import { AuthContext } from "../auth/auth-context";
import { isScopeWithinAssignment, ScopeService } from "../authorization/scope.service";
import { AttendanceService } from "../attendance/attendance.service";
import { AuditService } from "../audit/audit.service";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/config";
import { PrismaService } from "../prisma/prisma.service";
import { ObjectStorage } from "../storage/object-storage.service";
import {
  ReportSnapshot,
  ReportDay,
  ReportDayWard,
  ReportRosterRow,
  ReportWorkLog,
  ReportPhotoRef,
  aiNarrative,
  calculatePreviousPeriod,
  canonicalSnapshotHash,
  computeReportAnalytics,
  computeReportComparison,
  deduplicateEvidence,
  deterministicNarrative,
  deterministicRecommendations,
  emptyTotals,
  enumerateDates,
  escapeCsvCell,
  fromDateString,
  reportTitle,
  samplePeriodPhotos,
  signerTitle,
  toDateOnly,
  RENDERER_VERSION,
  SNAPSHOT_VERSION,
} from "./report-aggregation";
import { renderReportPdf } from "./pdf/report-pdf.renderer";

export interface RequestMeta {
  sourceIp?: string;
  requestId?: string;
}

interface RosterRow {
  employee: { id: string; employeeNumber: string; fullName: string };
  status: AttendanceStatus;
  detail: string;
  manualEditable: boolean;
}

export interface ReportListResult {
  items: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  total: number;
}

type ReportWithRelations = Prisma.ReportGetPayload<{
  include: { evidence: true; artifacts: true };
}>;

interface ResolvedScope {
  wardIds: string[];
  scopeName: string;
}

const STORAGE_KEY_FIELDS = new Set(["objectKey", "object_key", "storageKey", "storage_key"]);

function redactStorageKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactStorageKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !STORAGE_KEY_FIELDS.has(key))
      .map(([key, item]) => [key, redactStorageKeys(item)]),
  );
}

function collectReportEvidence(
  snapshot: ReportSnapshot,
): Prisma.ReportEvidenceCreateWithoutReportInput[] {
  const rows: Prisma.ReportEvidenceCreateWithoutReportInput[] = [];
  const seenKeys = new Set<string>();

  const evidenceList =
    snapshot.evidence && snapshot.evidence.length > 0
      ? snapshot.evidence
      : snapshot.workLogs.flatMap((item) => item.photos);

  for (const photo of evidenceList) {
    if (!seenKeys.has(photo.objectKey)) {
      seenKeys.add(photo.objectKey);
      rows.push({
        sourceEvidence: photo.evidenceId
          ? { connect: { id: photo.evidenceId } }
          : undefined,
        objectKey: photo.objectKey,
        sha256: photo.sha256,
        caption: photo.caption,
        stage: photo.stage,
      });
    }
  }
  return rows;
}

@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly attendance: AttendanceService,
    private readonly audit: AuditService,
    private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // -- Helpers ----------------------------------------------------------------

  private async resolveScope(
    auth: AuthContext,
    scopeType: "WARD" | "SUBCOUNTY" | "COUNTY",
    scopeId: string,
  ): Promise<ResolvedScope> {
    const accessible = await this.scope.accessibleWards(auth);
    if (scopeType === "WARD") {
      if (!(await this.scope.wardAccessible(auth, scopeId))) {
        throw new NotFoundException("Report scope not found");
      }
      const ward = await this.prisma.client.ward.findUnique({
        where: { id: scopeId },
        select: { name: true },
      });
      return { wardIds: [scopeId], scopeName: ward?.name ?? "Ward" };
    }
    if (scopeType === "SUBCOUNTY") {
      if (!(await this.scope.subcountyAccessible(auth, scopeId))) {
        throw new NotFoundException("Report scope not found");
      }
      const subcounty = await this.prisma.client.subcounty.findUnique({
        where: { id: scopeId },
        select: { name: true },
      });
      const wardIds = accessible
        .filter((ward) => ward.subcountyId === scopeId)
        .map((ward) => ward.id);
      return { wardIds, scopeName: subcounty?.name ?? "Subcounty" };
    }
    if (!(await this.scope.countyAccessible(auth, scopeId))) {
      throw new NotFoundException("Report scope not found");
    }
    const county = await this.prisma.client.county.findUnique({
      where: { id: scopeId },
      select: { name: true },
    });
    const subcounties = await this.prisma.client.subcounty.findMany({
      where: { countyId: scopeId },
      select: { id: true },
    });
    const subcountyIds = new Set(subcounties.map((subcounty) => subcounty.id));
    const wardIds = accessible
      .filter((ward) => subcountyIds.has(ward.subcountyId))
      .map((ward) => ward.id);
    return { wardIds, scopeName: county?.name ?? "County" };
  }

  private publicSnapshot(snapshot: unknown): Record<string, unknown> {
    return redactStorageKeys(snapshot) as Record<string, unknown>;
  }

  private async authorizingReportRoles(
    auth: AuthContext,
    scopeType: "WARD" | "SUBCOUNTY" | "COUNTY",
    scopeId: string,
  ) {
    let lineage: { subcountyId?: string; countyId?: string } = {};
    if (scopeType === "WARD") {
      const ward = await this.prisma.client.ward.findUnique({
        where: { id: scopeId },
        select: { subcountyId: true, subcounty: { select: { countyId: true } } },
      });
      if (ward) lineage = { subcountyId: ward.subcountyId, countyId: ward.subcounty.countyId };
    } else if (scopeType === "SUBCOUNTY") {
      const subcounty = await this.prisma.client.subcounty.findUnique({
        where: { id: scopeId },
        select: { countyId: true },
      });
      if (subcounty) lineage = { countyId: subcounty.countyId };
    }
    return auth.assignments
      .filter((assignment) =>
        assignment.capabilities.includes("REPORTS_FINALIZE") &&
        isScopeWithinAssignment(assignment, { scopeType, scopeId }, lineage),
      )
      .map((assignment) => assignment.role);
  }

  private toSummary(report: ReportWithRelations): Record<string, unknown> {
    const snapshot = report.snapshot as unknown as ReportSnapshot;
    return {
      id: report.id,
      kind: report.kind,
      scopeType: report.scopeType,
      scopeId: report.scopeId,
      periodStart: toDateOnly(report.periodStart),
      periodEnd: toDateOnly(report.periodEnd),
      status: report.status,
      title: report.title,
      narrative: report.narrative,
      recommendations: report.recommendations,
      snapshot: Array.isArray(snapshot.workLogs)
        ? {
            ...this.publicSnapshot(snapshot),
            workLogs: snapshot.workLogs.map((workLog) => ({
              ...workLog,
              photos: workLog.photos.map(({ objectKey, ...photo }) => {
                const reportEvidence = report.evidence.find(
                  (item) => item.objectKey === objectKey,
                );
                return {
                  ...photo,
                  ...(reportEvidence
                    ? { accessPath: `/api/v1/reports/${report.id}/evidence/${reportEvidence.id}` }
                    : {}),
                };
              }),
            })),
          }
        : this.publicSnapshot(snapshot),
      version: report.version,
      finalizedBy: report.finalizedBy,
      finalizedAt: report.finalizedAt,
      createdBy: report.createdBy,
      createdAt: report.createdAt,
      evidence: report.evidence.map((evidence) => ({
        id: evidence.id,
        evidenceId: evidence.evidenceId,
        sha256: evidence.sha256,
        caption: evidence.caption,
        stage: evidence.stage,
        accessPath: `/api/v1/reports/${report.id}/evidence/${evidence.id}`,
      })),
      artifacts: (report.artifacts || []).map((art) => ({
        id: art.id,
        kind: art.kind,
        status: art.status,
        size: art.size,
        generatedAt: art.generatedAt,
        rendererVersion: art.rendererVersion,
      })),
    };
  }

  private async findOrThrow(id: string): Promise<ReportWithRelations> {
    const report = await this.prisma.client.report.findUnique({
      where: { id },
      include: { evidence: true, artifacts: true },
    });
    if (!report) {
      throw new NotFoundException("Report not found");
    }
    return report;
  }

  // -- Aggregation ------------------------------------------------------------

  /**
   * Pure symmetrical facts extraction over a date span [startDate, endDate].
   * Reused identically for current reporting periods and previous comparison periods.
   */
  private async extractPeriodFacts(
    auth: AuthContext,
    wardIds: string[],
    wardNames: Map<string, string>,
    startDate: string,
    endDate: string,
  ): Promise<{
    totals: Record<AttendanceStatus, number>;
    days: ReportDay[];
    workLogs: ReportWorkLog[];
    allRawPhotos: ReportPhotoRef[];
  }> {
    const start = fromDateString(startDate);
    const end = fromDateString(endDate);

    const totals = emptyTotals();
    const days: ReportDay[] = [];
    const rosterEmployees: Array<{ row: ReportRosterRow; employeeId: string }> = [];

    const sessions = await this.prisma.client.attendanceSession.findMany({
      where: {
        wardId: { in: wardIds },
        workDate: { gte: start, lte: end },
      },
      orderBy: { createdAt: "desc" },
    });
    const sessionByWardDate = new Map<string, (typeof sessions)[number]>();
    for (const session of sessions) {
      const key = `${session.wardId}:${toDateOnly(session.workDate)}`;
      if (!sessionByWardDate.has(key)) sessionByWardDate.set(key, session);
    }

    for (const date of enumerateDates(start, end)) {
      const dayWards: ReportDayWard[] = [];
      const dateStr = toDateOnly(date);
      for (const wardId of wardIds) {
        const session = sessionByWardDate.get(`${wardId}:${dateStr}`);
        if (!session) continue;
        const roster = (await this.attendance.roster(auth, {
          wardId,
          workDate: dateStr,
          sessionId: session.id,
        })) as unknown as RosterRow[];
        const rows: ReportRosterRow[] = [];
        for (const row of roster) {
          totals[row.status] = (totals[row.status] ?? 0) + 1;
          const reportRow: ReportRosterRow = {
            employeeNumber: row.employee.employeeNumber,
            fullName: row.employee.fullName,
            designation: null,
            role: null,
            status: row.status,
            detail: row.detail,
            wardName: wardNames.get(wardId) ?? "Ward",
            workDate: dateStr,
            sessionActivity: session?.activity ?? "Field operations",
            sessionLocation: session?.location ?? wardNames.get(wardId) ?? "Ward",
          };
          rows.push(reportRow);
          rosterEmployees.push({ row: reportRow, employeeId: row.employee.id });
        }
        dayWards.push({
          wardId,
          wardName: wardNames.get(wardId) ?? "",
          activity: session?.activity ?? "No attendance session",
          location: session?.location ?? wardNames.get(wardId) ?? "Ward",
          roster: rows,
        });
      }
      if (dayWards.length) days.push({ date: dateStr, wards: dayWards });
    }

    if (rosterEmployees.length > 0) {
      const designations = await this.prisma.client.employee.findMany({
        where: { id: { in: rosterEmployees.map((item) => item.employeeId) } },
        select: { id: true, designation: true },
      });
      const designationById = new Map(
        designations.map((employee) => [employee.id, employee.designation]),
      );
      for (const item of rosterEmployees) {
        const desig = designationById.get(item.employeeId) ?? null;
        item.row.designation = desig;
        item.row.role = desig;
      }
    }

    const workLogs = await this.prisma.client.workLog.findMany({
      where: {
        wardId: { in: wardIds },
        status: { in: ["SUBMITTED", "APPROVED"] },
        workDate: { gte: start, lte: end },
      },
      include: {
        detail: true,
        operations: true,
        evidence: { orderBy: { createdAt: "asc" } },
      },
      orderBy: [{ workDate: "asc" }, { createdAt: "asc" }],
    });

    const allRawPhotos: ReportPhotoRef[] = [];
    const work: ReportWorkLog[] = workLogs.map((item) => {
      const logPhotos: ReportPhotoRef[] = item.evidence.map((evidence) => ({
        evidenceId: evidence.id,
        objectKey: evidence.objectKey,
        sha256: evidence.sha256,
        caption: evidence.caption,
        stage: evidence.stage as EvidenceStage,
        workLogId: item.id,
        wardName: wardNames.get(item.wardId) ?? "",
        activity: item.activity,
        date: toDateOnly(item.workDate),
      }));

      allRawPhotos.push(...logPhotos);

      return {
        id: item.id,
        wardId: item.wardId,
        wardName: wardNames.get(item.wardId) ?? "",
        date: toDateOnly(item.workDate),
        activity: item.activity,
        location: item.location,
        areasRoads: item.operations?.areasRoads ?? item.location,
        description: item.description,
        numberOfTrips: item.operations?.numberOfTrips ?? 0,
        wasteTransferInvolved: item.operations?.wasteTransferInvolved ?? false,
        truckId: item.operations?.truckId ?? null,
        backhoeId: item.operations?.backhoeId ?? null,
        cleanupDone: item.operations?.cleanupDone ?? false,
        cleanupStakeholders: item.operations?.cleanupStakeholders ?? null,
        climateTeamCount: item.operations?.climateTeamCount ?? 0,
        staffCount: item.staffCount,
        challenges: item.challenges,
        suggestedSolutions: item.suggestedSolutions ?? null,
        completionStatus: item.detail?.completionStatus ?? "COMPLETE",
        outstandingWork: item.detail?.outstandingWork ?? null,
        photos: logPhotos,
      };
    });

    return { totals, days, workLogs: work, allRawPhotos };
  }

  private async buildSnapshot(
    auth: AuthContext,
    input: ReportPreviewQueryInput,
  ): Promise<ReportSnapshot> {
    const { wardIds, scopeName } = await this.resolveScope(
      auth,
      input.scopeType,
      input.scopeId,
    );

    const wards = await this.prisma.client.ward.findMany({
      where: { id: { in: wardIds } },
      select: { id: true, name: true },
    });
    const wardNames = new Map(wards.map((ward) => [ward.id, ward.name]));
    const constituentWards = wards.map((w) => ({ id: w.id, name: w.name }));

    // 1. Current period facts
    const current = await this.extractPeriodFacts(
      auth,
      wardIds,
      wardNames,
      input.startDate,
      input.endDate,
    );

    // Canonical deduplicated evidence across the entire reporting scope
    const canonicalEvidence = deduplicateEvidence(current.allRawPhotos);

    // Legacy sample selection for weekly/monthly body presentation
    const sampledPhotoIds = new Set(
      samplePeriodPhotos(current.allRawPhotos, input.kind).map((photo) => photo.evidenceId),
    );
    for (const item of current.workLogs) {
      item.photos = item.photos.filter((photo) => sampledPhotoIds.has(photo.evidenceId));
    }

    // 2. Previous equivalent period facts (symmetrical lookback)
    const recentSessions = await this.prisma.client.attendanceSession.findMany({
      where: {
        wardId: { in: wardIds },
        workDate: { lt: fromDateString(input.startDate) },
      },
      orderBy: { workDate: "desc" },
      take: 15,
      select: { workDate: true },
    });
    const recentSessionDates = [
      ...new Set(recentSessions.map((s) => toDateOnly(s.workDate))),
    ];

    const prevPeriod = calculatePreviousPeriod(
      input.startDate,
      input.endDate,
      input.kind,
      recentSessionDates,
    );

    const previous = await this.extractPeriodFacts(
      auth,
      wardIds,
      wardNames,
      prevPeriod.startDate,
      prevPeriod.endDate,
    );

    // 3. Analytics & Comparison calculations
    const currentAnalytics = computeReportAnalytics(
      current.totals,
      current.days,
      current.workLogs,
      constituentWards,
    );
    const previousAnalytics = computeReportAnalytics(
      previous.totals,
      previous.days,
      previous.workLogs,
      constituentWards,
    );
    const comparison = computeReportComparison(
      currentAnalytics,
      previousAnalytics,
      prevPeriod.startDate,
      prevPeriod.endDate,
      prevPeriod.label,
    );

    const snapshot: ReportSnapshot = {
      snapshotVersion: SNAPSHOT_VERSION,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      scopeName,
      startDate: input.startDate,
      endDate: input.endDate,
      kind: input.kind,
      generatedAt: new Date().toISOString(),
      signedBy: null,
      signedTitle: null,
      totals: current.totals,
      analytics: currentAnalytics,
      comparison,
      days: current.days,
      workLogs: current.workLogs,
      evidence: canonicalEvidence,
    };

    snapshot.snapshotSha256 = canonicalSnapshotHash(snapshot);
    return snapshot;
  }

  // -- Reads ------------------------------------------------------------------

  async aiDraft(
    auth: AuthContext,
    input: ReportAiDraftInput,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const snapshot = await this.buildSnapshot(auth, input);
    const { narrative, source } = await aiNarrative(snapshot, this.config.ai);
    await this.audit.record({
      action: "REPORT.NARRATIVE_DRAFTED",
      targetType: "Report",
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      details: source === "ai" ? "AI enabled" : "Deterministic fallback",
    });
    return {
      snapshot: this.publicSnapshot(snapshot),
      narrative,
      narrativeSource: source,
      recommendations: deterministicRecommendations(snapshot.workLogs),
      title: reportTitle(input.kind, snapshot.scopeName),
    };
  }

  async preview(
    auth: AuthContext,
    input: ReportPreviewQueryInput,
  ): Promise<Record<string, unknown>> {
    const snapshot = await this.buildSnapshot(auth, input);
    return {
      snapshot: this.publicSnapshot(snapshot),
      narrative: deterministicNarrative(snapshot.totals, snapshot.workLogs),
      recommendations: deterministicRecommendations(snapshot.workLogs),
      title: reportTitle(input.kind, snapshot.scopeName),
    };
  }

  async list(auth: AuthContext, query: ReportQueryInput): Promise<ReportListResult> {
    const { wardIds, subcountyIds, countyIds } = await this.scope.accessibleScopeIds(auth);
    const visibleScopes: Prisma.ReportWhereInput[] = [];
    if (wardIds.size) visibleScopes.push({ scopeType: "WARD", scopeId: { in: [...wardIds] } });
    if (subcountyIds.size) {
      visibleScopes.push({ scopeType: "SUBCOUNTY", scopeId: { in: [...subcountyIds] } });
    }
    if (countyIds.size) {
      visibleScopes.push({ scopeType: "COUNTY", scopeId: { in: [...countyIds] } });
    }
    if (!visibleScopes.length) {
      return { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
    }
    const where: Prisma.ReportWhereInput = {
      AND: [
        { status: "FINALIZED" },
        { OR: visibleScopes },
        ...(query.scopeType ? [{ scopeType: query.scopeType }] : []),
        ...(query.scopeId ? [{ scopeId: query.scopeId }] : []),
        ...(query.kind ? [{ kind: query.kind }] : []),
        ...(query.date
          ? [{
              periodStart: { lte: fromDateString(query.date) },
              periodEnd: { gte: fromDateString(query.date) },
            }]
          : []),
      ],
    };
    const [total, reports] = await this.prisma.client.$transaction([
      this.prisma.client.report.count({ where }),
      this.prisma.client.report.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          kind: true,
          scopeType: true,
          scopeId: true,
          periodStart: true,
          periodEnd: true,
          status: true,
          title: true,
          snapshot: true,
          version: true,
          finalizedBy: true,
          finalizedAt: true,
          createdBy: true,
          createdAt: true,
          artifacts: {
            select: {
              id: true,
              kind: true,
              status: true,
              size: true,
              generatedAt: true,
            },
          },
        },
      }),
    ]);
    return {
      items: reports.map((report) => ({
        ...(() => {
          const snapshot = report.snapshot as unknown as ReportSnapshot;
          return {
            signedBy: snapshot.signedBy ?? null,
            signedTitle: snapshot.signedTitle ?? null,
            scopeName: snapshot.scopeName ?? null,
          };
        })(),
        id: report.id,
        kind: report.kind,
        scopeType: report.scopeType,
        scopeId: report.scopeId,
        periodStart: toDateOnly(report.periodStart),
        periodEnd: toDateOnly(report.periodEnd),
        status: report.status,
        title: report.title,
        version: report.version,
        finalizedBy: report.finalizedBy,
        finalizedAt: report.finalizedAt,
        createdBy: report.createdBy,
        createdAt: report.createdAt,
        artifacts: report.artifacts || [],
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async get(auth: AuthContext, id: string): Promise<Record<string, unknown>> {
    const report = await this.findOrThrow(id);
    if (!(await this.scope.scopeAccessible(auth, report.scopeType, report.scopeId))) {
      throw new NotFoundException("Report not found");
    }
    return this.toSummary(report);
  }

  // -- Finalize ---------------------------------------------------------------

  private async assertAttendanceReadyForFinalization(
    auth: AuthContext,
    input: ReportFinalizeInput,
  ): Promise<void> {
    const { wardIds } = await this.resolveScope(auth, input.scopeType, input.scopeId);
    const period = {
      gte: fromDateString(input.startDate),
      lte: fromDateString(input.endDate),
    };
    const [activeSessions, pendingReviews] = await this.prisma.client.$transaction([
      this.prisma.client.attendanceSession.count({
        where: { wardId: { in: wardIds }, workDate: period, closesAt: { gt: new Date() } },
      }),
      this.prisma.client.attendance.count({
        where: {
          wardId: { in: wardIds },
          workDate: period,
          absenceReviewStatus: "PENDING",
        },
      }),
    ]);

    if (activeSessions > 0) {
      throw new ConflictException(
        `Attendance is still open for ${activeSessions} ${activeSessions === 1 ? "session" : "sessions"}. Close or allow check-in to finish before finalizing this report.`,
      );
    }
    if (pendingReviews > 0) {
      throw new ConflictException(
        `${pendingReviews} attendance ${pendingReviews === 1 ? "entry requires" : "entries require"} Ward Environment Officer approval before this report can be finalized.`,
      );
    }
  }

  /**
   * Generates and archives the official PDF artifact immediately after finalization.
   * Creates the ReportArtifact in GENERATING status, writes to ObjectStorage,
   * then marks READY (or FAILED on error).
   */
  private async generateAndArchivePdfArtifact(
    report: ReportWithRelations,
    snapshot: ReportSnapshot,
  ): Promise<void> {
    // 1. Record GENERATING state
    let artifact = await this.prisma.client.reportArtifact.upsert({
      where: {
        reportId_kind: {
          reportId: report.id,
          kind: "PDF",
        },
      },
      create: {
        reportId: report.id,
        kind: "PDF",
        status: "GENERATING",
      },
      update: {
        status: "GENERATING",
        failureReason: null,
      },
    });

    try {
      const pdfBuffer = await renderReportPdf(snapshot, {
        imageLoader: (key) => this.storage.read(key).catch(() => null),
      });

      const stored = await this.storage.save({
        buffer: pdfBuffer,
        originalName: `${report.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`,
        contentType: "application/pdf",
      });

      await this.prisma.client.reportArtifact.update({
        where: { id: artifact.id },
        data: {
          status: "READY",
          objectKey: stored.objectKey,
          sha256: stored.sha256,
          size: stored.size,
          generatedAt: new Date(),
          rendererVersion: RENDERER_VERSION,
        },
      });
    } catch (err: unknown) {
      const failureReason = err instanceof Error ? err.message : String(err);
      await this.prisma.client.reportArtifact
        .update({
          where: { id: artifact.id },
          data: {
            status: "FAILED",
            failureReason,
          },
        })
        .catch(() => null);
    }
  }

  async finalize(
    auth: AuthContext,
    input: ReportFinalizeInput,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const start = fromDateString(input.startDate);
    const end = fromDateString(input.endDate);

    // 1. Application-level check: prevent duplicate finalized reports
    const existing = await this.prisma.client.report.findFirst({
      where: {
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        kind: input.kind,
        periodStart: start,
        periodEnd: end,
        status: "FINALIZED",
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        message:
          "Report already generated. The report for this scope and reporting period is already available in Report History.",
        existingReportId: existing.id,
      });
    }

    await this.assertAttendanceReadyForFinalization(auth, input);
    const snapshot = await this.buildSnapshot(auth, input);
    const narrative =
      input.narrative?.trim() || deterministicNarrative(snapshot.totals, snapshot.workLogs);
    const recommendations =
      input.recommendations?.trim() || deterministicRecommendations(snapshot.workLogs);

    snapshot.signedBy = auth.displayName;
    snapshot.signedTitle = signerTitle(
      await this.authorizingReportRoles(auth, input.scopeType, input.scopeId),
    );
    snapshot.narrative = narrative;
    snapshot.recommendations = recommendations;
    snapshot.snapshotSha256 = canonicalSnapshotHash(snapshot);

    const data: Prisma.ReportUncheckedCreateInput = {
      kind: input.kind,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      periodStart: start,
      periodEnd: end,
      status: "FINALIZED",
      title: reportTitle(input.kind, snapshot.scopeName),
      narrative,
      recommendations,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      version: 1,
      finalizedBy: auth.userId,
      finalizedAt: new Date(),
      createdBy: auth.userId,
      evidence: { create: collectReportEvidence(snapshot) },
    };

    let report: ReportWithRelations;
    try {
      report = await this.prisma.client.$transaction(async (tx) => {
        const created = await tx.report.create({
          data,
          include: { evidence: true, artifacts: true },
        });
        await this.audit.record(
          {
            action: "REPORT.FINALIZED",
            targetType: "Report",
            targetId: created.id,
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            actorUserId: auth.userId,
            sourceIp: meta.sourceIp,
            requestId: meta.requestId,
            details: `${input.kind} ${input.startDate}..${input.endDate}`,
          },
          tx,
        );
        return created;
      });
    } catch (err: unknown) {
      // 2. Transactional race-condition check via PostgreSQL partial unique index
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        const conflicting = await this.prisma.client.report.findFirst({
          where: {
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            kind: input.kind,
            periodStart: start,
            periodEnd: end,
            status: "FINALIZED",
          },
          select: { id: true },
        });
        throw new ConflictException({
          message:
            "Report already generated. The report for this scope and reporting period is already available in Report History.",
          existingReportId: conflicting?.id,
        });
      }
      throw err;
    }

    // 3. Immediately render and archive the official PDF artifact
    await this.generateAndArchivePdfArtifact(report, snapshot);

    // Refresh report with updated artifacts
    const fresh = await this.findOrThrow(report.id);
    return this.toSummary(fresh);
  }

  // -- PDF Delivery & Self-Repair ---------------------------------------------

  async getPdf(
    auth: AuthContext,
    id: string,
    disposition: "inline" | "attachment" = "inline",
    meta: RequestMeta = {},
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const report = await this.findOrThrow(id);
    if (!(await this.scope.scopeAccessible(auth, report.scopeType, report.scopeId))) {
      throw new NotFoundException("Report not found");
    }

    const snapshot = report.snapshot as unknown as ReportSnapshot;
    const filename = `mazingira-${report.kind.toLowerCase()}-${toDateOnly(report.periodStart)}.pdf`;

    let artifact = await this.prisma.client.reportArtifact.findUnique({
      where: { reportId_kind: { reportId: report.id, kind: "PDF" } },
    });

    // If existing artifact is READY, serve directly from object storage
    if (artifact && artifact.status === "READY" && artifact.objectKey) {
      try {
        const buffer = await this.storage.read(artifact.objectKey);
        const actualSha = createHash("sha256").update(buffer).digest("hex");
        if (actualSha === artifact.sha256) {
          await this.audit.record({
            action: disposition === "attachment" ? "REPORT.PDF_DOWNLOADED" : "REPORT.PDF_VIEWED",
            targetType: "Report",
            targetId: report.id,
            scopeType: report.scopeType,
            scopeId: report.scopeId,
            actorUserId: auth.userId,
            sourceIp: meta.sourceIp,
            requestId: meta.requestId,
            details: filename,
          });
          return { buffer, filename, contentType: "application/pdf" };
        }
      } catch {
        // Missing or corrupted from storage; proceed to repair
      }
    }

    // Atomic claim for self-repair
    if (!artifact) {
      try {
        await this.prisma.client.reportArtifact.create({
          data: { reportId: report.id, kind: "PDF", status: "GENERATING" },
        });
      } catch {
        // another worker initiated creation
      }
    } else {
      await this.prisma.client.reportArtifact.updateMany({
        where: { id: artifact.id, status: { in: ["FAILED", "GENERATING"] } },
        data: { status: "GENERATING", failureReason: null },
      });
    }

    await this.generateAndArchivePdfArtifact(report, snapshot);

    const repaired = await this.prisma.client.reportArtifact.findUnique({
      where: { reportId_kind: { reportId: report.id, kind: "PDF" } },
    });

    if (repaired && repaired.status === "READY" && repaired.objectKey) {
      const buffer = await this.storage.read(repaired.objectKey);
      await this.audit.record({
        action: disposition === "attachment" ? "REPORT.PDF_DOWNLOADED" : "REPORT.PDF_VIEWED",
        targetType: "Report",
        targetId: report.id,
        scopeType: report.scopeType,
        scopeId: report.scopeId,
        actorUserId: auth.userId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
        details: `${filename} (repaired)`,
      });
      return { buffer, filename, contentType: "application/pdf" };
    }

    // Direct render fallback
    const fallbackBuffer = await renderReportPdf(snapshot, {
      imageLoader: (key) => this.storage.read(key).catch(() => null),
    });
    return { buffer: fallbackBuffer, filename, contentType: "application/pdf" };
  }

  async downloadEvidence(
    auth: AuthContext,
    reportId: string,
    reportEvidenceId: string,
    meta: RequestMeta,
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const evidence = await this.prisma.client.reportEvidence.findFirst({
      where: { id: reportEvidenceId, reportId },
      include: { report: true },
    });
    if (!evidence || evidence.report.status !== "FINALIZED") {
      throw new NotFoundException("Report evidence not found");
    }
    if (
      !(await this.scope.scopeAccessible(
        auth,
        evidence.report.scopeType,
        evidence.report.scopeId,
      ))
    ) {
      throw new NotFoundException("Report evidence not found");
    }

    const buffer = await this.storage.read(evidence.objectKey);
    const actual = createHash("sha256").update(buffer).digest("hex");
    if (actual !== evidence.sha256) {
      throw new NotFoundException("Report evidence is missing or corrupted");
    }
    const source = evidence.evidenceId
      ? await this.prisma.client.evidence.findUnique({
          where: { id: evidence.evidenceId },
          select: { contentType: true },
        })
      : null;
    await this.audit.record({
      action: "REPORT.EVIDENCE_ACCESSED",
      targetType: "ReportEvidence",
      targetId: evidence.id,
      scopeType: evidence.report.scopeType,
      scopeId: evidence.report.scopeId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      details: evidence.reportId,
    });
    return {
      buffer,
      contentType: source?.contentType ?? "application/octet-stream",
      filename: `report-evidence-${evidence.id}`,
    };
  }

  // -- CSV export -------------------------------------------------------------

  async exportCsv(
    auth: AuthContext,
    id: string,
    meta: RequestMeta,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const report = await this.findOrThrow(id);
    if (!(await this.scope.scopeAccessible(auth, report.scopeType, report.scopeId))) {
      throw new NotFoundException("Report not found");
    }
    const snapshot = report.snapshot as unknown as ReportSnapshot;

    const lines: string[] = [];
    lines.push(
      [
        "Work date",
        "Ward",
        "Employee ID",
        "Employee name",
        "Role",
        "Status",
        "Details",
        "Activity",
        "Location",
      ]
        .map(escapeCsvCell)
        .join(","),
    );
    for (const day of snapshot.days) {
      for (const ward of day.wards) {
        for (const row of ward.roster) {
          lines.push(
            [
              day.date,
              ward.wardName,
              row.employeeNumber,
              row.fullName,
              row.designation || row.role,
              row.status,
              row.detail,
              ward.activity,
              ward.location,
            ]
              .map(escapeCsvCell)
              .join(","),
          );
        }
      }
    }

    await this.audit.record({
      action: "REPORT.CSV_EXPORTED",
      targetType: "Report",
      targetId: report.id,
      scopeType: report.scopeType,
      scopeId: report.scopeId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      details: `mazingira-${report.kind.toLowerCase()}-${toDateOnly(report.periodStart)}.csv`,
    });

    const filename = `mazingira-${report.kind.toLowerCase()}-${toDateOnly(report.periodStart)}.csv`;
    return { buffer: Buffer.from(`\ufeff${lines.join("\r\n")}\r\n`, "utf8"), filename };
  }
}
