import { createHash } from "node:crypto";
import type {
  AttendanceStatus,
  CompletionStatus,
  EvidenceStage,
  ReportKind,
  RoleCode,
  ScopeType,
} from "@ward-ops/contracts";
import { ATTENDANCE_STATUSES } from "@ward-ops/contracts";

// ---------------------------------------------------------------------------
// Pure, deterministic report aggregation helpers (§25, ADR-0007). No I/O:
// everything here is unit-testable without a database.
// ---------------------------------------------------------------------------

export const MAX_REPORT_SPAN_DAYS = 366;
export const SNAPSHOT_VERSION = 2;
export const ANALYTICS_VERSION = "1.0";
export const RENDERER_VERSION = "1.0";

export interface ReportPhotoRef {
  evidenceId: string;
  objectKey: string;
  sha256: string;
  caption: string | null;
  stage: EvidenceStage;
  workLogId?: string;
  wardName?: string;
  activity?: string;
  date?: string;
  accessPath?: string;
}

export interface ReportRosterRow {
  employeeNumber: string;
  fullName: string;
  designation: string | null;
  role: string | null; // backward-compatible alias
  status: AttendanceStatus;
  detail: string;
  wardName?: string;
  workDate?: string;
  sessionActivity?: string;
  sessionLocation?: string;
}

export interface ReportDayWard {
  wardId: string;
  wardName: string;
  activity: string;
  location: string;
  roster: ReportRosterRow[];
}

export interface ReportDay {
  date: string;
  wards: ReportDayWard[];
}

export interface ReportWorkLog {
  id: string;
  wardId: string;
  wardName: string;
  date: string;
  activity: string;
  location: string;
  areasRoads: string;
  description: string;
  numberOfTrips: number;
  wasteTransferInvolved: boolean;
  truckId: string | null;
  backhoeId: string | null;
  cleanupDone: boolean;
  cleanupStakeholders: string | null;
  climateTeamCount: number;
  staffCount: number;
  challenges: string | null;
  suggestedSolutions: string | null;
  completionStatus: CompletionStatus;
  outstandingWork: string | null;
  photos: ReportPhotoRef[];
}

export interface AttendanceStatusBreakdown {
  count: number;
  percentage: number;
}

export interface DailyAttendanceTrend {
  date: string;
  present: number;
  late: number;
  absent: number;
  other: number;
  total: number;
  effectiveRate: number;
}

export interface ActivityOutputSummary {
  activity: string;
  count: number;
  staffAllocations: number;
  trips: number;
  complete: number;
  incomplete: number;
}

export interface OperationsMetrics {
  wasteTransferLogsCount: number;
  cleanupLogsCount: number;
  climateTeamTotal: number;
  trucksUsed: string[];
  backhoesUsed: string[];
}

export interface ConstituentComparison {
  id: string;
  name: string;
  attendanceRate: number;
  workLogsCount: number;
  tripsCount: number;
  completionRate: number;
  staffAllocations: number;
}

export interface ReportAnalytics {
  analyticsVersion: string;
  totalRostered: number;
  expectedOnDuty: number;
  excusedCount: number;
  attendedCount: number;
  effectiveAttendanceRate: number;
  operationalAvailabilityRate: number;
  uniquePersonnelAttended: number;
  totalStaffAllocations: number;
  statusDistribution: Record<AttendanceStatus, AttendanceStatusBreakdown>;
  dailyTrend: DailyAttendanceTrend[];
  totalWorkLogs: number;
  distinctActivitiesCount: number;
  totalTrips: number;
  completeCount: number;
  incompleteCount: number;
  completionRate: number;
  outstandingWorkCount: number;
  activityBreakdown: ActivityOutputSummary[];
  operations: OperationsMetrics;
  constituentComparisons: ConstituentComparison[];
}

export interface ComparableKpi {
  current: number;
  previous: number;
  absoluteChange: number;
  percentageChange: number | null;
}

export interface ReportComparison {
  previousStartDate: string;
  previousEndDate: string;
  comparisonKind: string;
  kpis: {
    attendedCount: ComparableKpi;
    effectiveAttendanceRate: ComparableKpi;
    absentCount: ComparableKpi;
    totalWorkLogs: ComparableKpi;
    totalTrips: ComparableKpi;
    totalStaffAllocations: ComparableKpi;
    completionRate: ComparableKpi;
  };
}

export interface PreviousPeriodResult {
  startDate: string;
  endDate: string;
  label: string;
}

export interface ReportSnapshot {
  snapshotVersion: number;
  scopeType: ScopeType;
  scopeId: string;
  scopeName: string;
  startDate: string;
  endDate: string;
  kind: ReportKind;
  generatedAt: string;
  signedBy: string | null;
  signedTitle: string | null;
  totals: Record<AttendanceStatus, number>;
  analytics: ReportAnalytics;
  comparison: ReportComparison | null;
  days: ReportDay[];
  workLogs: ReportWorkLog[];
  evidence: ReportPhotoRef[];
  narrative?: string | null;
  recommendations?: string | null;
  snapshotSha256?: string;
}

export function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function fromDateString(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function roundTo(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Date-only, UTC-based iterator over [start, end] inclusive. */
export function enumerateDates(start: Date, end: Date): Date[] {
  const result: Date[] = [];
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  const final = new Date(end);
  final.setUTCHours(0, 0, 0, 0);
  while (cursor <= final) {
    result.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function reportTitle(kind: ReportKind, scopeName: string): string {
  const label =
    kind === "CUSTOM" ? "Custom" : `${kind.charAt(0)}${kind.slice(1).toLowerCase()}`;
  return `${label} Operations Report — ${scopeName}`;
}

const SIGNER_TITLES: Record<RoleCode, string> = {
  SYSTEM_ADMIN: "System Administrator",
  SUBCOUNTY_REVIEWER: "Subcounty Reviewer",
  CHIEF_SUBCOUNTY_OFFICER: "Chief Subcounty Environment Officer",
  ASSISTANT_DIRECTOR: "Assistant Director of Environment",
  DEPUTY_DIRECTOR: "Deputy Director of Environment",
  DIRECTOR: "Director of Environment",
  WARD_OFFICER: "Ward Environment Officer",
  HR_VIEWER: "Human Resources Viewer",
  READ_ONLY: "Read-only User",
};

const SIGNER_ROLE_PRIORITY: RoleCode[] = [
  "SYSTEM_ADMIN",
  "DIRECTOR",
  "DEPUTY_DIRECTOR",
  "ASSISTANT_DIRECTOR",
  "CHIEF_SUBCOUNTY_OFFICER",
  "SUBCOUNTY_REVIEWER",
  "WARD_OFFICER",
  "HR_VIEWER",
  "READ_ONLY",
];

/** Returns a fixed title rather than rendering an untrusted or mismatched role label. */
export function signerTitle(roles: readonly RoleCode[]): string {
  const role = SIGNER_ROLE_PRIORITY.find((candidate) => roles.includes(candidate));
  return role ? SIGNER_TITLES[role] : "Authorized Report Finalizer";
}

/**
 * §8 / §23: daily reports keep every photo; weekly/monthly reports keep at most
 * four evenly spaced photos per stage (legacy sampling algorithm).
 */
export function samplePeriodPhotos(
  photos: ReportPhotoRef[],
  kind: ReportKind,
): ReportPhotoRef[] {
  if (kind !== "WEEKLY" && kind !== "MONTHLY") {
    return photos;
  }
  const byStage = new Map<EvidenceStage, ReportPhotoRef[]>();
  for (const photo of photos) {
    const list = byStage.get(photo.stage) ?? [];
    list.push(photo);
    byStage.set(photo.stage, list);
  }
  const selectedIds = new Set<string>();
  for (const stagePhotos of byStage.values()) {
    if (stagePhotos.length <= 4) {
      for (const photo of stagePhotos) selectedIds.add(photo.evidenceId);
      continue;
    }
    for (let index = 0; index < 4; index += 1) {
      const photo = stagePhotos[Math.round((index * (stagePhotos.length - 1)) / 3)];
      if (photo) selectedIds.add(photo.evidenceId);
    }
  }
  return photos.filter((photo) => selectedIds.has(photo.evidenceId));
}

export function deduplicateEvidence(photos: ReportPhotoRef[]): ReportPhotoRef[] {
  const seen = new Set<string>();
  const result: ReportPhotoRef[] = [];
  for (const photo of photos) {
    const key = photo.objectKey || photo.evidenceId;
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(photo);
    }
  }
  return result;
}

export function emptyTotals(): Record<AttendanceStatus, number> {
  const totals = {} as Record<AttendanceStatus, number>;
  for (const status of ATTENDANCE_STATUSES) totals[status] = 0;
  return totals;
}

export function deterministicNarrative(
  totals: Record<AttendanceStatus, number>,
  workLogs: Pick<ReportWorkLog, "activity" | "numberOfTrips">[],
): string {
  const activities = [...new Set(workLogs.map((item) => item.activity))].sort();
  const outputParts = workLogs
    .filter((item) => (item.numberOfTrips ?? 0) > 0)
    .map((item) => `${item.numberOfTrips} trips (${item.activity})`);
  let text =
    `During the reporting period, ${workLogs.length} work activities were recorded. ` +
    `Attendance records contained ${totals.PRESENT ?? 0} present and ${totals.LATE ?? 0} late entries, ` +
    `with ${totals.ABSENT ?? 0} absence entries requiring or having received follow-up.`;
  if (activities.length) text += ` Activities covered ${activities.join(", ")}.`;
  if (outputParts.length) text += ` Recorded outputs included ${outputParts.join(", ")}.`;
  return text;
}

export function deterministicRecommendations(
  workLogs: Pick<ReportWorkLog, "activity" | "completionStatus">[],
): string {
  const incomplete = [
    ...new Set(
      workLogs
        .filter((item) => item.completionStatus === "INCOMPLETE")
        .map((item) => item.activity),
    ),
  ].sort();
  if (incomplete.length) {
    return `Prioritise follow-up and completion of: ${incomplete.join(
      ", ",
    )}. Continue monitoring attendance and documented field outputs.`;
  }
  return "Sustain the completed activities, continue routine monitoring, and address emerging operational challenges promptly.";
}

/**
 * §8 / §12: CSV formula-injection protection. Cells whose first non-whitespace
 * character is =, +, - or @ are prefixed with a single quote (so leading
 * whitespace cannot bypass the guard); cells containing commas, quotes or
 * newlines are double-quoted with doubled inner quotes.
 */
export function escapeCsvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

// ---------------------------------------------------------------------------
// Authoritative Deterministic Analytics (§6, §8, §9)
// ---------------------------------------------------------------------------

export function computeReportAnalytics(
  totals: Record<AttendanceStatus, number>,
  days: ReportDay[],
  workLogs: ReportWorkLog[],
  constituentWards: Array<{ id: string; name: string }> = [],
): ReportAnalytics {
  let totalRostered = 0;
  for (const status of ATTENDANCE_STATUSES) {
    totalRostered += totals[status] ?? 0;
  }

  const expectedOnDuty = (totals.PRESENT ?? 0) + (totals.LATE ?? 0) + (totals.ABSENT ?? 0);
  const excusedCount =
    (totals.OFF_DUTY ?? 0) +
    (totals.LEAVE ?? 0) +
    (totals.SICK_OFF ?? 0) +
    (totals.OFFICIAL_DUTY ?? 0);
  const attendedCount = (totals.PRESENT ?? 0) + (totals.LATE ?? 0);

  const effectiveAttendanceRate =
    expectedOnDuty > 0 ? roundTo((attendedCount / expectedOnDuty) * 100, 1) : 0;
  const operationalAvailabilityRate =
    totalRostered > 0
      ? roundTo(((attendedCount + (totals.OFFICIAL_DUTY ?? 0)) / totalRostered) * 100, 1)
      : 0;

  // Unique human workforce personnel who attended duty during this reporting period.
  const uniquePersonnelSet = new Set<string>();
  for (const day of days) {
    for (const ward of day.wards) {
      for (const row of ward.roster) {
        if (row.status === "PRESENT" || row.status === "LATE" || row.status === "OFFICIAL_DUTY") {
          uniquePersonnelSet.add(row.employeeNumber);
        }
      }
    }
  }
  const uniquePersonnelAttended = uniquePersonnelSet.size;

  // Sum of staff counts across all work logs (represents task allocations, not distinct humans).
  const totalStaffAllocations = workLogs.reduce((acc, log) => acc + (log.staffCount || 0), 0);

  // 7-status distribution breakdown
  const statusDistribution = {} as Record<AttendanceStatus, AttendanceStatusBreakdown>;
  for (const status of ATTENDANCE_STATUSES) {
    const count = totals[status] ?? 0;
    const percentage = totalRostered > 0 ? roundTo((count / totalRostered) * 100, 1) : 0;
    statusDistribution[status] = { count, percentage };
  }

  // Daily attendance trends
  const dailyTrend: DailyAttendanceTrend[] = days.map((day) => {
    let dayPresent = 0;
    let dayLate = 0;
    let dayAbsent = 0;
    let dayOther = 0;
    let dayTotal = 0;

    for (const ward of day.wards) {
      for (const row of ward.roster) {
        dayTotal += 1;
        if (row.status === "PRESENT") dayPresent += 1;
        else if (row.status === "LATE") dayLate += 1;
        else if (row.status === "ABSENT") dayAbsent += 1;
        else dayOther += 1;
      }
    }

    const dayExpected = dayPresent + dayLate + dayAbsent;
    const dayEffectiveRate =
      dayExpected > 0 ? roundTo(((dayPresent + dayLate) / dayExpected) * 100, 1) : 0;

    return {
      date: day.date,
      present: dayPresent,
      late: dayLate,
      absent: dayAbsent,
      other: dayOther,
      total: dayTotal,
      effectiveRate: dayEffectiveRate,
    };
  });

  // Work log operations metrics
  const totalWorkLogs = workLogs.length;
  const distinctActivities = new Set(workLogs.map((item) => item.activity.trim()));
  const totalTrips = workLogs.reduce((acc, item) => acc + (item.numberOfTrips || 0), 0);
  const completeCount = workLogs.filter((item) => item.completionStatus === "COMPLETE").length;
  const incompleteCount = workLogs.filter((item) => item.completionStatus === "INCOMPLETE").length;
  const completionRate =
    totalWorkLogs > 0 ? roundTo((completeCount / totalWorkLogs) * 100, 1) : 0;
  const outstandingWorkCount = workLogs.filter(
    (item) => item.outstandingWork != null && item.outstandingWork.trim().length > 0,
  ).length;

  // Activity breakdown
  const activityMap = new Map<
    string,
    { count: number; staffAllocations: number; trips: number; complete: number; incomplete: number }
  >();
  for (const log of workLogs) {
    const act = log.activity.trim();
    const curr = activityMap.get(act) ?? {
      count: 0,
      staffAllocations: 0,
      trips: 0,
      complete: 0,
      incomplete: 0,
    };
    curr.count += 1;
    curr.staffAllocations += log.staffCount || 0;
    curr.trips += log.numberOfTrips || 0;
    if (log.completionStatus === "COMPLETE") curr.complete += 1;
    else curr.incomplete += 1;
    activityMap.set(act, curr);
  }

  const activityBreakdown: ActivityOutputSummary[] = [...activityMap.entries()]
    .map(([activity, data]) => ({ activity, ...data }))
    .sort((a, b) => a.activity.localeCompare(b.activity));

  // Equipment and operations
  let wasteTransferLogsCount = 0;
  let cleanupLogsCount = 0;
  let climateTeamTotal = 0;
  const trucksSet = new Set<string>();
  const backhoesSet = new Set<string>();

  for (const log of workLogs) {
    if (log.wasteTransferInvolved) wasteTransferLogsCount += 1;
    if (log.cleanupDone) cleanupLogsCount += 1;
    climateTeamTotal += log.climateTeamCount || 0;
    if (log.truckId?.trim()) trucksSet.add(log.truckId.trim());
    if (log.backhoeId?.trim()) backhoesSet.add(log.backhoeId.trim());
  }

  const operations: OperationsMetrics = {
    wasteTransferLogsCount,
    cleanupLogsCount,
    climateTeamTotal,
    trucksUsed: [...trucksSet].sort(),
    backhoesUsed: [...backhoesSet].sort(),
  };

  // Constituent comparisons (wards in subcounty/county)
  const constituentComparisons: ConstituentComparison[] = constituentWards.map((w) => {
    let wardPresent = 0;
    let wardLate = 0;
    let wardAbsent = 0;
    for (const day of days) {
      const match = day.wards.find((item) => item.wardId === w.id);
      if (match) {
        for (const row of match.roster) {
          if (row.status === "PRESENT") wardPresent += 1;
          else if (row.status === "LATE") wardLate += 1;
          else if (row.status === "ABSENT") wardAbsent += 1;
        }
      }
    }
    const wardExpected = wardPresent + wardLate + wardAbsent;
    const wardAttendanceRate =
      wardExpected > 0 ? roundTo(((wardPresent + wardLate) / wardExpected) * 100, 1) : 0;

    const wardLogs = workLogs.filter((item) => item.wardId === w.id);
    const wardWorkLogsCount = wardLogs.length;
    const wardTripsCount = wardLogs.reduce((acc, item) => acc + (item.numberOfTrips || 0), 0);
    const wardStaffAllocations = wardLogs.reduce((acc, item) => acc + (item.staffCount || 0), 0);
    const wardCompleteCount = wardLogs.filter((item) => item.completionStatus === "COMPLETE").length;
    const wardCompletionRate =
      wardWorkLogsCount > 0 ? roundTo((wardCompleteCount / wardWorkLogsCount) * 100, 1) : 0;

    return {
      id: w.id,
      name: w.name,
      attendanceRate: wardAttendanceRate,
      workLogsCount: wardWorkLogsCount,
      tripsCount: wardTripsCount,
      completionRate: wardCompletionRate,
      staffAllocations: wardStaffAllocations,
    };
  });

  return {
    analyticsVersion: ANALYTICS_VERSION,
    totalRostered,
    expectedOnDuty,
    excusedCount,
    attendedCount,
    effectiveAttendanceRate,
    operationalAvailabilityRate,
    uniquePersonnelAttended,
    totalStaffAllocations,
    statusDistribution,
    dailyTrend,
    totalWorkLogs,
    distinctActivitiesCount: distinctActivities.size,
    totalTrips,
    completeCount,
    incompleteCount,
    completionRate,
    outstandingWorkCount,
    activityBreakdown,
    operations,
    constituentComparisons,
  };
}

export function compareKpis(current: number, previous: number, roundDecimals = 1): ComparableKpi {
  const absoluteChange = roundTo(current - previous, roundDecimals);
  let percentageChange: number | null = null;
  if (previous > 0) {
    percentageChange = roundTo(((current - previous) / previous) * 100, 1);
  } else if (current > 0) {
    percentageChange = 100.0;
  } else {
    percentageChange = 0.0;
  }
  return { current, previous, absoluteChange, percentageChange };
}

export function calculatePreviousPeriod(
  startDate: string,
  endDate: string,
  kind: ReportKind,
  availableSessionDates: string[] = [],
): PreviousPeriodResult {
  const start = fromDateString(startDate);
  const end = fromDateString(endDate);

  if (kind === "DAILY") {
    // Look back up to 7 days for the most recent day with an attendance session in scope.
    if (availableSessionDates.length > 0) {
      const candidateDates = availableSessionDates
        .filter((d) => d < startDate)
        .sort()
        .reverse();
      const minLookback = new Date(start);
      minLookback.setUTCDate(minLookback.getUTCDate() - 7);
      const minLookbackStr = toDateOnly(minLookback);

      const recentSessionDate = candidateDates.find((d) => d >= minLookbackStr);
      if (recentSessionDate) {
        return {
          startDate: recentSessionDate,
          endDate: recentSessionDate,
          label: `Previous operational reporting day (${recentSessionDate})`,
        };
      }
    }

    // Default fallback: immediately preceding calendar day
    const prevDay = new Date(start);
    prevDay.setUTCDate(prevDay.getUTCDate() - 1);
    const prevDayStr = toDateOnly(prevDay);
    return {
      startDate: prevDayStr,
      endDate: prevDayStr,
      label: "Previous calendar day",
    };
  }

  if (kind === "WEEKLY") {
    const prevStart = new Date(start);
    prevStart.setUTCDate(prevStart.getUTCDate() - 7);
    const prevEnd = new Date(end);
    prevEnd.setUTCDate(prevEnd.getUTCDate() - 7);
    return {
      startDate: toDateOnly(prevStart),
      endDate: toDateOnly(prevEnd),
      label: "Previous week",
    };
  }

  if (kind === "MONTHLY") {
    // Check if start is 1st of month and end is last day of that same month
    const isFirstOfMonth = start.getUTCDate() === 1;
    const testNextDay = new Date(end);
    testNextDay.setUTCDate(testNextDay.getUTCDate() + 1);
    const isEndOfMonth = testNextDay.getUTCDate() === 1;

    if (isFirstOfMonth && isEndOfMonth && start.getUTCMonth() === end.getUTCMonth()) {
      // Full calendar month -> preceding full calendar month
      const prevStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
      const prevEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 0));
      return {
        startDate: toDateOnly(prevStart),
        endDate: toDateOnly(prevEnd),
        label: "Previous month",
      };
    }

    // Non-standard span: shift by duration D
    const durationDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    const prevEnd = new Date(start);
    prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setUTCDate(prevStart.getUTCDate() - durationDays + 1);
    return {
      startDate: toDateOnly(prevStart),
      endDate: toDateOnly(prevEnd),
      label: "Previous month",
    };
  }

  // CUSTOM: equal preceding span
  const durationDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const prevEnd = new Date(start);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - durationDays + 1);
  return {
    startDate: toDateOnly(prevStart),
    endDate: toDateOnly(prevEnd),
    label: "Preceding equal period",
  };
}

export function computeReportComparison(
  current: ReportAnalytics,
  previous: ReportAnalytics,
  previousStartDate: string,
  previousEndDate: string,
  comparisonKind: string,
): ReportComparison {
  return {
    previousStartDate,
    previousEndDate,
    comparisonKind,
    kpis: {
      attendedCount: compareKpis(current.attendedCount, previous.attendedCount, 0),
      effectiveAttendanceRate: compareKpis(
        current.effectiveAttendanceRate,
        previous.effectiveAttendanceRate,
        1,
      ),
      absentCount: compareKpis(
        current.statusDistribution.ABSENT?.count ?? 0,
        previous.statusDistribution.ABSENT?.count ?? 0,
        0,
      ),
      totalWorkLogs: compareKpis(current.totalWorkLogs, previous.totalWorkLogs, 0),
      totalTrips: compareKpis(current.totalTrips, previous.totalTrips, 0),
      totalStaffAllocations: compareKpis(
        current.totalStaffAllocations,
        previous.totalStaffAllocations,
        0,
      ),
      completionRate: compareKpis(current.completionRate, previous.completionRate, 1),
    },
  };
}

/**
 * Deterministic canonical SHA-256 hash of a ReportSnapshot.
 * Recursively key-sorted, excluding the snapshotSha256 property itself.
 */
export function canonicalSnapshotHash(snapshot: unknown): string {
  function sortObjectKeys(val: unknown): unknown {
    if (Array.isArray(val)) {
      return val.map(sortObjectKeys);
    }
    if (val !== null && typeof val === "object" && !(val instanceof Date)) {
      const obj = val as Record<string, unknown>;
      const sortedKeys = Object.keys(obj)
        .filter((k) => k !== "snapshotSha256")
        .sort();
      const res: Record<string, unknown> = {};
      for (const key of sortedKeys) {
        res[key] = sortObjectKeys(obj[key]);
      }
      return res;
    }
    return val;
  }
  const canonicalJson = JSON.stringify(sortObjectKeys(snapshot));
  return createHash("sha256").update(canonicalJson, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Optional AI narrative (§25, §39): AI must never calculate authoritative
// statistics; it only drafts the narrative text from a minimized payload that
// excludes names, IDs, phones, free-text, medical details and challenges.
// ---------------------------------------------------------------------------

export interface AiApprovedWork {
  date: string;
  activity: string;
  location: string;
  areasRoads: string;
  numberOfTrips: number;
  staffCount: number;
  completionStatus: string;
}

export interface AiPayload {
  period: [string, string];
  attendanceTotals: Record<AttendanceStatus, number>;
  approvedWork: AiApprovedWork[];
}

export interface AiNarrativeConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export type AiHttpClient = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface AiNarrativeResult {
  narrative: string;
  source: "ai" | "deterministic";
}

const AI_SYSTEM_PROMPT =
  "Draft a concise formal Nairobi ward environment operations report using only supplied facts. " +
  "Never invent names, quantities, places, activities, causes or recommendations. " +
  "Clearly identify missing information instead of guessing.";

/**
 * Minimized payload sent to the LLM (§8): period, attendance totals and
 * approved-work facts only. Employee names/numbers, phones, descriptions,
 * challenges and evidence references are never included.
 */
export function structuredAiPayload(snapshot: ReportSnapshot): AiPayload {
  return {
    period: [snapshot.startDate, snapshot.endDate],
    attendanceTotals: snapshot.totals,
    approvedWork: snapshot.workLogs.map((item) => ({
      date: item.date,
      activity: item.activity,
      location: item.location,
      areasRoads: item.areasRoads,
      numberOfTrips: item.numberOfTrips,
      staffCount: item.staffCount,
      completionStatus: item.completionStatus,
    })),
  };
}

/**
 * Drafts a narrative with the configured LLM, falling back to the
 * deterministic narrative whenever AI is disabled, unconfigured or fails
 * (§8 "no-AI fallback"). Never throws.
 */
export async function aiNarrative(
  snapshot: ReportSnapshot,
  config: AiNarrativeConfig,
  http: AiHttpClient = globalThis.fetch as unknown as AiHttpClient,
): Promise<AiNarrativeResult> {
  const fallback = deterministicNarrative(snapshot.totals, snapshot.workLogs);
  if (!config.enabled || !config.apiKey) {
    return { narrative: fallback, source: "deterministic" };
  }
  const payload = structuredAiPayload(snapshot);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await http(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        max_tokens: 600,
        messages: [
          { role: "system", content: AI_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { narrative: fallback, source: "deterministic" };
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return { narrative: fallback, source: "deterministic" };
    return { narrative: content, source: "ai" };
  } catch {
    return { narrative: fallback, source: "deterministic" };
  } finally {
    clearTimeout(timer);
  }
}
