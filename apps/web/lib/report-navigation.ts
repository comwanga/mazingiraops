export function buildDailyReportHref(wardId: string, workDate: string): string {
  const params = new URLSearchParams({
    scopeType: "WARD",
    scopeId: wardId,
    startDate: workDate,
    endDate: workDate,
    kind: "DAILY",
    preview: "1",
    source: "work-log",
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
    params.get("source") !== "work-log" ||
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
