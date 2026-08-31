import type { Ward } from "@/lib/api";

interface WardAssignment {
  wardId: string | null;
}

export function resolveAttendanceWardId(
  wards: Ward[],
  assignments: WardAssignment[],
  currentWardId = "",
): string {
  if (wards.some((ward) => ward.id === currentWardId)) return currentWardId;

  const accessibleIds = new Set(wards.map((ward) => ward.id));
  const assignedWard = assignments.find(
    (assignment) => assignment.wardId && accessibleIds.has(assignment.wardId),
  );

  return assignedWard?.wardId ?? wards[0]?.id ?? "";
}

export function buildAttendanceSessionInput(ward: Pick<Ward, "id" | "name">, durationMinutes: number) {
  return {
    wardId: ward.id,
    activity: "Ward attendance",
    location: `${ward.name} Ward`,
    durationMinutes,
  };
}
