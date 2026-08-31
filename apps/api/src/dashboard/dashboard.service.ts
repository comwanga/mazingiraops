import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { CapabilityCode } from "@ward-ops/contracts";
import { AuthContext } from "../auth/auth-context";
import { ScopeService } from "../authorization/scope.service";
import { PrismaService } from "../prisma/prisma.service";
import { todayNairobi } from "../attendance/attendance.service";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/config";
import { CacheService } from "../redis/cache.service";

const DASHBOARD_CACHE_PREFIX = "dashboard:v1:";

export interface DashboardResult {
  asOf: string;
  workDate: string;
  metrics: Record<string, number>;
  queue: Array<{ type: string; id: string; label: string; detail: string; href: string }>;
}

function isDashboardResult(value: unknown): value is DashboardResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DashboardResult>;
  return (
    typeof candidate.asOf === "string" &&
    typeof candidate.workDate === "string" &&
    Boolean(candidate.metrics) &&
    typeof candidate.metrics === "object" &&
    Object.values(candidate.metrics).every((metric) => typeof metric === "number") &&
    Array.isArray(candidate.queue) &&
    candidate.queue.every(
      (item) =>
        Boolean(item) &&
        typeof item.type === "string" &&
        typeof item.id === "string" &&
        typeof item.label === "string" &&
        typeof item.detail === "string" &&
        typeof item.href === "string",
    )
  );
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly cache: CacheService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async get(auth: AuthContext) {
    const asOf = new Date();
    const workDate = new Date(`${todayNairobi()}T00:00:00.000Z`);
    const wardIds = async (capability: CapabilityCode) =>
      (await this.scope.accessibleWards(auth, [capability])).map((ward) => ward.id);
    const [staffWards, attendanceWards, absenceWards, workWards] = await Promise.all([
      wardIds("STAFF_READ"),
      wardIds("ATTENDANCE_READ"),
      wardIds("ABSENCE_READ"),
      wardIds("WORK_READ"),
    ]);
    const reviewAbsences = auth.capabilities.includes("ABSENCE_REVIEW");
    const reviewWork = auth.capabilities.includes("WORK_REVIEW");
    const reportScopes = await this.scope.accessibleScopeIds({
      ...auth,
      requiredCapabilities: ["REPORTS_READ"],
    });
    const cacheIdentity = JSON.stringify({
      staffWards: [...staffWards].sort(),
      attendanceWards: [...attendanceWards].sort(),
      absenceWards: [...absenceWards].sort(),
      workWards: [...workWards].sort(),
      reviewAbsences,
      reviewWork,
      reportWards: [...reportScopes.wardIds].sort(),
      reportSubcounties: [...reportScopes.subcountyIds].sort(),
      reportCounties: [...reportScopes.countyIds].sort(),
    });
    const cacheKey = `${DASHBOARD_CACHE_PREFIX}${createHash("sha256").update(cacheIdentity).digest("hex")}`;
    const cached = await this.cache.get(cacheKey, isDashboardResult);
    if (cached) return cached;

    const [activeStaff, attendance, openSessions, approvedAbsences, pendingAbsences, pendingWork, reports, absenceQueue, workQueue] =
      await this.prisma.client.$transaction([
        this.prisma.client.employee.count({
          where: {
            active: true,
            OR: [
              { wardId: { in: staffWards } },
              { assignments: { some: { wardId: { in: staffWards }, endedAt: null } } },
            ],
          },
        }),
        this.prisma.client.attendance.count({
          where: { wardId: { in: attendanceWards }, workDate, status: { in: ["PRESENT", "LATE"] } },
        }),
        this.prisma.client.attendanceSession.count({
          where: { wardId: { in: attendanceWards }, opensAt: { lte: asOf }, closesAt: { gt: asOf } },
        }),
        this.prisma.client.absenceRequest.count({
          where: {
            wardId: { in: absenceWards },
            status: "APPROVED",
            startDate: { lte: workDate },
            endDate: { gte: workDate },
          },
        }),
        this.prisma.client.absenceRequest.count({
          where: { wardId: { in: reviewAbsences ? absenceWards : [] }, status: "SUBMITTED" },
        }),
        this.prisma.client.workLog.count({
          where: { wardId: { in: reviewWork ? workWards : [] }, status: "SUBMITTED" },
        }),
        this.prisma.client.report.count({
          where: {
            status: "FINALIZED",
            OR: [
              { scopeType: "WARD", scopeId: { in: [...reportScopes.wardIds] } },
              { scopeType: "SUBCOUNTY", scopeId: { in: [...reportScopes.subcountyIds] } },
              { scopeType: "COUNTY", scopeId: { in: [...reportScopes.countyIds] } },
            ],
          },
        }),
        this.prisma.client.absenceRequest.findMany({
          where: { wardId: { in: reviewAbsences ? absenceWards : [] }, status: "SUBMITTED" },
          select: { id: true, kind: true, startDate: true, employee: { select: { fullName: true } } },
          orderBy: { createdAt: "asc" },
          take: 5,
        }),
        this.prisma.client.workLog.findMany({
          where: { wardId: { in: reviewWork ? workWards : [] }, status: "SUBMITTED" },
          select: { id: true, activity: true, location: true, workDate: true },
          orderBy: { createdAt: "asc" },
          take: 5,
        }),
      ]);

    const result: DashboardResult = {
      asOf: asOf.toISOString(),
      workDate: todayNairobi(),
      metrics: {
        activeStaff,
        presentOrLateToday: attendance,
        openSessions,
        approvedAbsencesToday: approvedAbsences,
        pendingAbsences,
        pendingWorkLogs: pendingWork,
        finalizedReports: reports,
      },
      queue: [
        ...absenceQueue.map((item) => ({
          type: "ABSENCE",
          id: item.id,
          label: item.employee.fullName,
          detail: `${item.kind.replace(/_/g, " ").toLowerCase()} - ${item.startDate.toISOString().slice(0, 10)}`,
          href: "/absences",
        })),
        ...workQueue.map((item) => ({
          type: "WORK_LOG",
          id: item.id,
          label: item.activity,
          detail: `${item.location} - ${item.workDate.toISOString().slice(0, 10)}`,
          href: "/worklogs",
        })),
      ],
    };
    await this.cache.set(cacheKey, result, this.config.redis.dashboardTtlSeconds);
    return result;
  }
}
