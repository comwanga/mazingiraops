import type { AuthUser } from "@/lib/api";

const ROLE_LABELS: Record<string, string> = {
  SYSTEM_ADMIN: "System Administrator",
  WARD_OFFICER: "Ward Environment Officer",
  SUBCOUNTY_REVIEWER: "Sub-County Environment Officer",
  CHIEF_SUBCOUNTY_OFFICER: "Chief Sub-County Environment Officer",
  ASSISTANT_DIRECTOR: "Assistant Director of Environment",
  DEPUTY_DIRECTOR: "Deputy Director of Environment",
  DIRECTOR: "Director of Environment",
  HR_VIEWER: "HR / Personnel Viewer",
  READ_ONLY: "Read-Only Observer",
};

export function formatAssignmentIdentity(assignment: AuthUser["assignments"][number]): string {
  const role = ROLE_LABELS[assignment.role] ?? assignment.roleName;
  if (assignment.scopeType === "WARD") {
    return [
      role,
      assignment.wardName ? `${assignment.wardName} Ward` : null,
      assignment.subcountyName ? `${assignment.subcountyName} Sub-County` : null,
    ].filter(Boolean).join(" · ");
  }
  if (assignment.scopeType === "SUBCOUNTY") {
    return [role, assignment.subcountyName ? `${assignment.subcountyName} Sub-County` : null]
      .filter(Boolean)
      .join(" · ");
  }
  return [role, assignment.countyName].filter(Boolean).join(" · ");
}

export function formatUserIdentity(user: Pick<AuthUser, "assignments">): string {
  if (user.assignments.length === 0) return "No organisation assignment";
  return user.assignments.map(formatAssignmentIdentity).join(" | ");
}
