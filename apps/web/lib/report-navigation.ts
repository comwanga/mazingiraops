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

export interface ReportScopeOption {
  scopeType: "COUNTY" | "SUBCOUNTY" | "WARD";
  scopeId: string;
  label: string;
}

interface ReportScopeAssignment {
  scopeType: string;
  countyId: string | null;
  subcountyId: string | null;
  wardId: string | null;
}

interface ReportScopeCounty {
  id: string;
  name: string;
  subcounties: Array<{
    id: string;
    name: string;
    wards: Array<{ id: string; name: string }>;
  }>;
}

/**
 * Turns the accessible organisation tree into report choices without leaking
 * parent scopes. A ward assignment gets its ward, a sub-county assignment gets
 * its sub-county and wards, and a county assignment gets the full hierarchy.
 */
export function reportScopeOptionsForAssignments(
  counties: ReportScopeCounty[],
  assignments: ReportScopeAssignment[],
): ReportScopeOption[] {
  const options: ReportScopeOption[] = [];
  const seen = new Set<string>();
  const add = (option: ReportScopeOption) => {
    const key = `${option.scopeType}:${option.scopeId}`;
    if (!seen.has(key)) {
      seen.add(key);
      options.push(option);
    }
  };

  for (const county of counties) {
    const countyAssigned = assignments.some(
      (assignment) => assignment.scopeType === "COUNTY" && assignment.countyId === county.id,
    );
    if (countyAssigned) {
      add({ scopeType: "COUNTY", scopeId: county.id, label: `${county.name} (County)` });
    }
    for (const subcounty of county.subcounties) {
      const subcountyAssigned = countyAssigned || assignments.some(
        (assignment) =>
          assignment.scopeType === "SUBCOUNTY" && assignment.subcountyId === subcounty.id,
      );
      if (subcountyAssigned) {
        add({
          scopeType: "SUBCOUNTY",
          scopeId: subcounty.id,
          label: `${subcounty.name} (Subcounty)`,
        });
      }
      for (const ward of subcounty.wards) {
        const wardAssigned = subcountyAssigned || assignments.some(
          (assignment) => assignment.scopeType === "WARD" && assignment.wardId === ward.id,
        );
        if (wardAssigned) {
          add({ scopeType: "WARD", scopeId: ward.id, label: `${ward.name} (Ward)` });
        }
      }
    }
  }
  return options;
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
