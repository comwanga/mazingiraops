export function buildDailyReportHref(wardId: string, workDate: string): string {
  return buildReportHref(wardId, workDate, "work-log");
}

export function buildAttendanceReportHref(wardId: string, workDate: string): string {
  return buildReportHref(wardId, workDate, "attendance");
}

function buildReportHref(wardId: string, workDate: string, source: "work-log" | "attendance"): string {
  const params = new URLSearchParams({
    scopeType: "WARD",
    scopeId: wardId,
    startDate: workDate,
    endDate: workDate,
    kind: "DAILY",
    preview: "1",
    source,
  });
  return `/reports?${params.toString()}`;
}

export interface DailyReportPrefill {
  scopeType: "WARD";
  scopeId: string;
  startDate: string;
  endDate: string;
  kind: "DAILY";
  preview: boolean;
}

export function readDailyReportPrefill(search: string): DailyReportPrefill | null {
  const params = new URLSearchParams(search);
  const scopeId = params.get("scopeId")?.trim() ?? "";
  const startDate = params.get("startDate") ?? "";
  const endDate = params.get("endDate") ?? "";
  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

  if (
    !["work-log", "attendance"].includes(params.get("source") ?? "") ||
    params.get("scopeType") !== "WARD" ||
    params.get("kind") !== "DAILY" ||
    !scopeId ||
    !isDate(startDate) ||
    !isDate(endDate)
  ) {
    return null;
  }

  return {
    scopeType: "WARD",
    scopeId,
    startDate,
    endDate,
    kind: "DAILY",
    preview: params.get("preview") === "1",
  };
}
