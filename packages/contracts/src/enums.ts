/**
 * Shared domain enums. These are the single source of truth for statuses and
 * codes used across the API and the web client. Keep them in sync with the
 * Prisma schema enums (packages/database/prisma/schema.prisma).
 */

export const ROLE_CODES = [
  "SYSTEM_ADMIN",
  "WARD_OFFICER",
  "SUBCOUNTY_REVIEWER",
  "CHIEF_SUBCOUNTY_OFFICER",
  "ASSISTANT_DIRECTOR",
  "DEPUTY_DIRECTOR",
  "DIRECTOR",
  "HR_VIEWER",
  "READ_ONLY",
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const SCOPE_TYPES = ["COUNTY", "SUBCOUNTY", "WARD"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export const CAPABILITY_CODES = [
  "STAFF_READ",
  "STAFF_MANAGE",
  "STAFF_IMPORT",
  "ATTENDANCE_READ",
  "ATTENDANCE_MANAGE",
  "WORK_READ",
  "WORK_CREATE",
  "WORK_REVIEW",
  "ABSENCE_READ",
  "ABSENCE_MANAGE",
  "ABSENCE_REVIEW",
  "MEDICAL_READ",
  "REPORTS_READ",
  "REPORTS_GENERATE",
  "REPORTS_EXPORT",
  "REPORTS_FINALIZE",
  "AUDIT_READ",
  "USERS_MANAGE",
  "USERS_READ",
  "USERS_DISABLE",
  "PERMISSIONS_MANAGE",
  "SCOPE_MANAGE",
  "RECORD_ARCHIVE",
  "EVIDENCE_REMOVE",
] as const;
export type CapabilityCode = (typeof CAPABILITY_CODES)[number];

/**
 * System administrators govern accounts, permissions and organisational
 * assignments. They may read finalized operational reports, but they are not
 * ward operators and must never receive create, edit, review or archive
 * capabilities for ward records.
 */
export const SYSTEM_ADMIN_CAPABILITIES = [
  "REPORTS_READ",
  "USERS_MANAGE",
  "USERS_READ",
  "USERS_DISABLE",
  "PERMISSIONS_MANAGE",
  "SCOPE_MANAGE",
] as const satisfies readonly CapabilityCode[];

export const ATTENDANCE_STATUSES = [
  "PRESENT",
  "LATE",
  "ABSENT",
  "OFF_DUTY",
  "LEAVE",
  "SICK_OFF",
  "OFFICIAL_DUTY",
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_ABSENCE_REASONS = ["SICK_OFF", "WEEKEND_OFF_DUTY"] as const;
export type AttendanceAbsenceReason = (typeof ATTENDANCE_ABSENCE_REASONS)[number];

export const ATTENDANCE_REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type AttendanceReviewStatus = (typeof ATTENDANCE_REVIEW_STATUSES)[number];

export const ABSENCE_KINDS = [
  "ANNUAL_LEAVE",
  "MATERNITY_LEAVE",
  "PATERNITY_LEAVE",
  "COMPASSIONATE_LEAVE",
  "SICK_OFF",
  "OFFICIAL_DUTY",
  "UNPAID_LEAVE",
] as const;
export type AbsenceKind = (typeof ABSENCE_KINDS)[number];

export const ABSENCE_STATUSES = [
  "PLANNED",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const;
export type AbsenceStatus = (typeof ABSENCE_STATUSES)[number];

export const ABSENCE_ACTIONS = ["SUBMIT", "APPROVE", "REJECT", "CANCEL"] as const;
export type AbsenceAction = (typeof ABSENCE_ACTIONS)[number];

export const WORK_LOG_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"] as const;
export type WorkLogStatus = (typeof WORK_LOG_STATUSES)[number];

export const WORK_LOG_ACTIONS = ["SUBMIT", "APPROVE", "REJECT"] as const;
export type WorkLogAction = (typeof WORK_LOG_ACTIONS)[number];

export const COMPLETION_STATUSES = ["COMPLETE", "INCOMPLETE"] as const;
export type CompletionStatus = (typeof COMPLETION_STATUSES)[number];

export const EVIDENCE_STAGES = ["BEFORE", "DURING", "AFTER"] as const;
export type EvidenceStage = (typeof EVIDENCE_STAGES)[number];
export const EVIDENCE_MAX_PER_STAGE = 4;

export const DOCUMENT_SENSITIVITIES = ["MEDICAL", "GENERAL"] as const;
export type DocumentSensitivity = (typeof DOCUMENT_SENSITIVITIES)[number];

export const DOCUMENT_CATEGORIES = [
  "SICK_SHEET",
  "MEDICAL_CERTIFICATE",
  "LEAVE_FORM",
  "LEAVE_APPROVAL",
  "RETURN_TO_WORK",
  "OTHER",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const REPORT_KINDS = ["DAILY", "WEEKLY", "MONTHLY", "CUSTOM"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_STATUSES = ["DRAFT", "FINALIZED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const DELIVERY_STATUSES = ["PENDING", "SENT", "FAILED"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const ROSTER_STATUSES = ["ON_DUTY", "ANNUAL_LEAVE"] as const;
export type RosterStatus = (typeof ROSTER_STATUSES)[number];

export const ACCESS_REQUEST_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
] as const;
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];
