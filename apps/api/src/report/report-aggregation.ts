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

export interface ReportPhotoRef {
  evidenceId: string;
  objectKey: string;
  sha256: string;
  caption: string | null;
  stage: EvidenceStage;
}

export interface ReportRosterRow {
  employeeNumber: string;
  fullName: string;
  role: string | null;
  status: AttendanceStatus;
  detail: string;
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
  completionStatus: CompletionStatus;
  outstandingWork: string | null;
  photos: ReportPhotoRef[];
}

export interface ReportSnapshot {
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
  days: ReportDay[];
  workLogs: ReportWorkLog[];
}

export function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function fromDateString(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
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
