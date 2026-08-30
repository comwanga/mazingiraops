import type {
  AbsenceAction,
  AbsenceKind,
  AbsenceStatus,
  CompletionStatus,
  EvidenceStage,
  ReportKind,
  ReportStatus,
  RoleCode,
  ScopeType,
  WorkLogAction,
  WorkLogStatus,
} from "@ward-ops/contracts";

export type {
  AbsenceAction,
  AbsenceKind,
  AbsenceStatus,
  CompletionStatus,
  EvidenceStage,
  ReportKind,
  ReportStatus,
  RoleCode,
  WorkLogAction,
  WorkLogStatus,
};
export type ReportScopeType = ScopeType;

export const API_URL = "/api/v1";

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  if (error.status === 401) return "Your session has expired. Sign in again.";
  if (error.status === 403) return "Your account does not have permission to perform this action.";
  if (error.status === 0) return "The service is unreachable. Check your connection and try again.";
  return error.message;
}

interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (method !== "GET" && csrfToken) {
    headers["x-csrf-token"] = csrfToken;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? "REQUEST_FAILED",
      body?.error?.message ?? "Request failed",
    );
  }
  return body as T;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  mustChangePassword: boolean;
  assignments: Array<{
    id: string;
    role: string;
    roleName: string;
    scopeType: string;
    countyId: string | null;
    subcountyId: string | null;
    wardId: string | null;
    countyName: string | null;
    subcountyName: string | null;
    wardName: string | null;
  }>;
}

export interface MeResponse {
  user: (AuthUser & { capabilities: string[]; csrfToken: string }) | null;
}

export interface LoginResponse {
  csrfToken: string;
  expiresAt: string;
  user: AuthUser;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const result = await apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  setCsrfToken(result.csrfToken);
  return result.user;
}

export async function fetchMe(): Promise<MeResponse["user"]> {
  const result = await apiFetch<MeResponse>("/auth/me");
  if (result.user) {
    setCsrfToken(result.user.csrfToken);
  }
  return result.user;
}

export async function logout(): Promise<void> {
  await apiFetch("/auth/logout", { method: "POST" });
  setCsrfToken(null);
  if (typeof navigator !== "undefined") {
    navigator.serviceWorker?.controller?.postMessage({ type: "PURGE_SESSION_CACHE" });
  }
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await apiFetch("/auth/change-password", {
    method: "POST",
    body: { currentPassword, newPassword },
  });
}

export interface DashboardSnapshot {
  asOf: string;
  workDate: string;
  metrics: {
    activeStaff: number;
    presentOrLateToday: number;
    openSessions: number;
    approvedAbsencesToday: number;
    pendingAbsences: number;
    pendingWorkLogs: number;
    finalizedReports: number;
  };
  queue: Array<{
    type: "ABSENCE" | "WORK_LOG";
    id: string;
    label: string;
    detail: string;
    href: string;
  }>;
}

export async function fetchDashboard(): Promise<DashboardSnapshot> {
  return apiFetch<DashboardSnapshot>("/dashboard");
}

export async function requestAccess(input: {
  displayName: string;
  email: string;
  password: string;
  reason: string;
  requestedScope: ReportScopeType;
  requestedScopeId: string;
}): Promise<void> {
  await apiFetch("/users/access-requests", {
    method: "POST",
    body: input,
  });
}

export interface PublicOrganisationTree {
  counties: Array<{
    id: string;
    code: string;
    name: string;
    subcounties: Array<{
      id: string;
      code: string;
      name: string;
      wards: Array<{ id: string; code: string; name: string }>;
    }>;
  }>;
}

export async function listPublicOrganisations(): Promise<PublicOrganisationTree> {
  return apiFetch<PublicOrganisationTree>("/organisations/public");
}

export interface AccessRequest {
  id: string;
  displayName: string;
  email: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedScope: string | null;
  requestedScopeId: string | null;
  createdAt: string;
}

export interface AccessRequestDecision {
  action: "approve" | "reject";
  roleCode?: RoleCode;
  scopeType?: ReportScopeType;
  scopeId?: string;
  note?: string;
}

export async function listAccessRequests(): Promise<AccessRequest[]> {
  const result = await apiFetch<{ requests: AccessRequest[] }>("/users/access-requests");
  return result.requests;
}

export async function reviewAccessRequest(
  id: string,
  decision: AccessRequestDecision,
): Promise<void> {
  await apiFetch(`/users/access-requests/${encodeURIComponent(id)}/review`, {
    method: "POST",
    body: decision,
  });
}

export interface ManagedUserAssignment {
  id: string;
  roleCode: RoleCode;
  roleName: string;
  scopeType: ReportScopeType;
  scopeId: string;
}

export interface ManagedUser {
  id: string;
  email: string;
  displayName: string;
  active: boolean;
  mustChangePassword: boolean;
  assignments: ManagedUserAssignment[];
}

export interface UserAssignmentInput {
  roleCode: RoleCode;
  scopeType: ReportScopeType;
  scopeId: string;
}

export async function listUsers(): Promise<ManagedUser[]> {
  const result = await apiFetch<{ users: ManagedUser[] }>("/users");
  return result.users;
}

export async function updateUserAssignments(
  id: string,
  assignments: UserAssignmentInput[],
): Promise<void> {
  await apiFetch(`/users/${encodeURIComponent(id)}/assignments`, {
    method: "PUT",
    body: { assignments },
  });
}

export async function setUserActive(id: string, active: boolean): Promise<void> {
  await apiFetch(`/users/${encodeURIComponent(id)}/${active ? "restore" : "disable"}`, {
    method: "POST",
  });
}

export async function resetUserPassword(id: string, temporaryPassword: string): Promise<void> {
  await apiFetch(`/users/${encodeURIComponent(id)}/reset-password`, {
    method: "POST",
    body: { temporaryPassword },
  });
}

export interface PermissionCatalog {
  capabilities: Array<{ code: string; name: string }>;
  roles: Array<{ code: RoleCode; name: string; capabilities: string[] }>;
}

export async function fetchPermissionCatalog(): Promise<PermissionCatalog> {
  return apiFetch<PermissionCatalog>("/users/permissions");
}

export async function updateRoleCapabilities(roleCode: RoleCode, capabilities: string[]): Promise<void> {
  await apiFetch(`/users/roles/${encodeURIComponent(roleCode)}/capabilities`, {
    method: "PUT",
    body: { capabilities },
  });
}

export async function bootstrapOwner(input: {
  setupToken: string;
  email: string;
  password: string;
  displayName?: string;
}): Promise<AuthUser> {
  const result = await apiFetch<{ user: AuthUser }>("/auth/bootstrap", {
    method: "POST",
    body: input,
  });
  return result.user;
}

// -- Audit --------------------------------------------------------------------

export interface AuditEvent {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  actorDisplayName: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  scopeType: string | null;
  scopeId: string | null;
  details: string | Record<string, unknown> | null;
  sourceIp?: string | null;
}

export interface AuditListResult {
  items: AuditEvent[];
  page: number;
  pageSize: number;
  total: number;
}

export async function listAudit(query?: {
  page?: number;
  pageSize?: number;
  action?: string;
}): Promise<AuditListResult> {
  const params = new URLSearchParams();
  if (query?.page !== undefined) params.set("page", String(query.page));
  if (query?.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query?.action) params.set("action", query.action);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<AuditListResult>(`/audit${suffix}`);
}

// -- Phase 3: staff -----------------------------------------------------------

export interface WardRef {
  id: string;
  code: string;
  name: string;
}

export interface Ward extends WardRef {
  subcountyId: string | null;
}

export async function listWards(): Promise<Ward[]> {
  const result = await apiFetch<{ wards: Ward[] }>("/organisations/wards");
  return result.wards;
}

export interface EmployeeProfile {
  residence: string | null;
  rosterStatus: string;
}

export interface Employee {
  id: string;
  employeeNumber: string;
  fullName: string;
  phone: string;
  email: string | null;
  designation: string;
  active: boolean;
  wardId: string;
  ward: WardRef;
  profile: EmployeeProfile | null;
  assignments: Array<{
    id: string;
    wardId: string;
    assignedAt?: string;
    endedAt?: string | null;
  }>;
}

export interface CreateEmployeeInput {
  employeeNumber: string;
  fullName: string;
  phone: string;
  email?: string;
  designation?: string;
  wardId: string;
}

export async function listStaff(): Promise<Employee[]> {
  return apiFetch<Employee[]>("/staff");
}

export async function createStaff(input: CreateEmployeeInput): Promise<Employee> {
  return apiFetch<Employee>("/staff", { method: "POST", body: input });
}

export type UpdateEmployeeInput = Partial<
  Pick<CreateEmployeeInput, "fullName" | "phone" | "designation">
> & {
  email?: string | null;
  residence?: string | null;
  rosterStatus?: "ON_DUTY" | "ANNUAL_LEAVE";
};

export async function updateStaff(id: string, input: UpdateEmployeeInput): Promise<Employee> {
  return apiFetch<Employee>(`/staff/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
  });
}

export async function assignStaff(
  id: string,
  wardId: string,
  type: "TEMPORARY" | "TRANSFER" = "TEMPORARY",
): Promise<Employee> {
  return apiFetch<Employee>(`/staff/${encodeURIComponent(id)}/assignments`, {
    method: "POST",
    body: { wardId, type },
  });
}

export async function endStaffAssignment(id: string, assignmentId: string): Promise<Employee> {
  return apiFetch<Employee>(
    `/staff/${encodeURIComponent(id)}/assignments/${encodeURIComponent(assignmentId)}/end`,
    { method: "POST" },
  );
}

export interface StaffImportRowValue {
  employeeNumber?: string;
  fullName?: string;
  phone?: string;
  email?: string | null;
  designation?: string;
  residence?: string | null;
  rosterStatus?: "ON_DUTY" | "ANNUAL_LEAVE";
  [key: string]: unknown;
}

export interface StaffImportRow {
  rowNumber: number;
  status: "INVALID" | "DUPLICATE_FILE" | "CONFLICT" | "CREATE" | "UPDATE" | "SKIPPED";
  value: StaffImportRowValue;
  employeeId?: string;
  errors?: string[];
}

export interface StaffImportResult {
  importId?: string;
  rows: StaffImportRow[];
  summary: Record<string, number>;
}

export async function previewStaffImport(
  wardId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<StaffImportResult> {
  const form = new FormData();
  form.append("wardId", wardId);
  form.append("file", file);
  return uploadWithProgress<StaffImportResult>(`${API_URL}/staff/imports/preview`, form, onProgress);
}

export async function commitStaffImport(input: {
  wardId: string;
  sourceName?: string;
  duplicateStrategy: "SKIP" | "UPDATE";
  rows: StaffImportRowValue[];
}): Promise<StaffImportResult> {
  return apiFetch<StaffImportResult>("/staff/imports/commit", { method: "POST", body: input });
}

export async function setStaffActive(id: string, active: boolean): Promise<Employee> {
  return apiFetch<Employee>(`/staff/${id}/${active ? "reactivate" : "deactivate"}`, {
    method: "POST",
  });
}

// -- Phase 3: attendance ------------------------------------------------------

export interface AttendanceSession {
  id: string;
  token?: string;
  wardId: string;
  ward: WardRef;
  workDate: string;
  activity: string;
  location: string;
  opensAt: string;
  closesAt: string;
  createdAt: string;
  active?: boolean;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeNumber: string;
  fullName: string;
  wardId: string;
  sessionId: string;
  sessionActivity: string;
  workDate: string;
  checkedAt: string;
  status: string;
  verificationMethod: string;
}

export interface RosterRow {
  employee: { id: string; employeeNumber: string; fullName: string };
  status: string;
  detail: string;
  manualEditable: boolean;
  attendanceId: string | null;
  sessionId: string | null;
  correctionAllowed: boolean;
}

export interface CreateSessionInput {
  wardId: string;
  activity: string;
  location: string;
  durationMinutes: number;
}

export interface AttendanceQuery {
  wardId?: string;
  sessionId?: string;
  workDate?: string;
}

function attendanceQuery(query?: AttendanceQuery): string {
  const params = new URLSearchParams();
  if (query?.wardId) params.set("wardId", query.wardId);
  if (query?.sessionId) params.set("sessionId", query.sessionId);
  if (query?.workDate) params.set("workDate", query.workDate);
  return params.toString() ? `?${params.toString()}` : "";
}

export async function listSessions(query?: Omit<AttendanceQuery, "sessionId">): Promise<AttendanceSession[]> {
  return apiFetch<AttendanceSession[]>(`/attendance/sessions${attendanceQuery(query)}`);
}

export async function createSession(input: CreateSessionInput): Promise<AttendanceSession> {
  return apiFetch<AttendanceSession>("/attendance/sessions", { method: "POST", body: input });
}

export async function closeAttendanceSession(id: string, revoke = false): Promise<void> {
  await apiFetch(`/attendance/sessions/${encodeURIComponent(id)}/${revoke ? "revoke" : "close"}`, {
    method: "POST",
  });
}

export async function listAttendance(query?: AttendanceQuery): Promise<AttendanceRecord[]> {
  return apiFetch<AttendanceRecord[]>(`/attendance${attendanceQuery(query)}`);
}

export async function fetchRoster(wardId: string, workDate?: string): Promise<RosterRow[]> {
  const params = new URLSearchParams({ wardId });
  if (workDate) params.set("workDate", workDate);
  return apiFetch<RosterRow[]>(`/attendance/roster?${params.toString()}`);
}

export interface ManualAttendanceInput {
  sessionId: string;
  employeeId: string;
  workDate: string;
  status: string;
  reason: string;
}

export async function manualAttendance(input: ManualAttendanceInput): Promise<unknown> {
  return apiFetch("/attendance/manual", { method: "POST", body: input });
}

export async function correctAttendance(
  id: string,
  input: { sessionId: string; status: string; reason: string },
): Promise<unknown> {
  return apiFetch(`/attendance/${encodeURIComponent(id)}/corrections`, {
    method: "POST",
    body: input,
  });
}

export interface CheckInResponse {
  ok: boolean;
  message?: string;
  status: string;
  employee?: { id: string; fullName: string };
  checkedAt: string;
}

export async function checkInPublic(
  sessionToken: string,
  employeeNumber: string,
  latitude?: number | null,
  longitude?: number | null,
): Promise<CheckInResponse> {
  return apiFetch<CheckInResponse>(`/attendance/sessions/${encodeURIComponent(sessionToken)}/check-in`, {
    method: "POST",
    body: { employeeNumber, latitude, longitude },
  });
}

// -- Phase 4: absence management ---------------------------------------------

export interface AbsenceDocument {
  id: string;
  originalName: string;
  contentType: string;
  size: number;
  sensitivity: string;
  category: string;
}

export interface Absence {
  id: string;
  employee: { id: string; employeeNumber: string; fullName: string };
  wardId: string;
  kind: AbsenceKind;
  startDate: string;
  endDate: string;
  returnDate: string;
  reason: string;
  status: AbsenceStatus;
  version: number;
  submittedBy: string;
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  documents: AbsenceDocument[];
}

export interface CreateAbsenceInput {
  employeeId: string;
  kind: AbsenceKind;
  startDate: string;
  endDate: string;
  returnDate: string;
  reason: string;
  planned?: boolean;
}

export async function listAbsences(query?: {
  wardId?: string;
  status?: AbsenceStatus;
  employeeId?: string;
}): Promise<Absence[]> {
  const params = new URLSearchParams();
  if (query?.wardId) params.set("wardId", query.wardId);
  if (query?.status) params.set("status", query.status);
  if (query?.employeeId) params.set("employeeId", query.employeeId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<Absence[]>(`/absence-requests${suffix}`);
}

export async function createAbsence(input: CreateAbsenceInput): Promise<Absence> {
  return apiFetch<Absence>("/absence-requests", { method: "POST", body: input });
}

export async function absenceAction(
  id: string,
  input: { action: AbsenceAction; reviewNote?: string },
): Promise<Absence> {
  return apiFetch<Absence>(`/absence-requests/${id}/actions`, {
    method: "POST",
    body: input,
  });
}

export async function uploadAbsenceDocument(
  id: string,
  file: File,
  category: string,
  onProgress?: (percent: number) => void,
): Promise<AbsenceDocument> {
  const form = new FormData();
  form.append("file", file);
  form.append("documentCategory", category);
  return uploadWithProgress<AbsenceDocument>(
    `${API_URL}/absence-requests/${id}/documents`,
    form,
    onProgress,
  );
}

export async function downloadAbsenceDocument(documentId: string): Promise<Blob> {
  const response = await fetch(`${API_URL}/absence-requests/documents/${documentId}/download`, {
    credentials: "include",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      body?.error?.code ?? "REQUEST_FAILED",
      body?.error?.message ?? "Request failed",
    );
  }
  return response.blob();
}

export interface WorkLogOperations {
  areasRoads: string;
  numberOfTrips: number;
  wasteTransferInvolved: boolean;
  truckId: string | null;
  backhoeId: string | null;
  cleanupDone: boolean;
  cleanupStakeholders: string | null;
  climateTeamCount: number;
}

export interface WorkLogDetail {
  completionStatus: CompletionStatus;
  outstandingWork: string | null;
}

export interface WorkLog {
  id: string;
  wardId: string;
  workDate: string;
  activity: string;
  location: string;
  description: string;
  staffCount: number;
  challenges: string | null;
  suggestedSolutions: string | null;
  truthConfirmed: boolean;
  status: WorkLogStatus;
  version: number;
  submittedBy: string;
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  detail: WorkLogDetail;
  operations: WorkLogOperations;
}

export interface CreateWorkLogInput {
  wardId: string;
  workDate: string;
  activity: string;
  location: string;
  areasRoads: string;
  description: string;
  numberOfTrips?: number;
  wasteTransferInvolved?: boolean;
  truckId?: string;
  backhoeId?: string;
  staffCount?: number;
  challenges?: string | null;
  suggestedSolutions?: string | null;
  truthConfirmed: boolean;
  cleanupDone?: boolean;
  cleanupStakeholders?: string;
  climateTeamCount?: number;
  completionStatus?: CompletionStatus;
  outstandingWork?: string;
}

export async function listWorkLogs(query?: {
  wardId?: string;
  workDate?: string;
  status?: WorkLogStatus;
}): Promise<WorkLog[]> {
  const params = new URLSearchParams();
  if (query?.wardId) params.set("wardId", query.wardId);
  if (query?.workDate) params.set("workDate", query.workDate);
  if (query?.status) params.set("status", query.status);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<WorkLog[]>(`/work-logs${suffix}`);
}

export async function createWorkLog(input: CreateWorkLogInput): Promise<WorkLog> {
  return apiFetch<WorkLog>("/work-logs", { method: "POST", body: input });
}

export async function workLogAction(
  id: string,
  input: { action: WorkLogAction; expectedVersion: number; reviewNote?: string },
): Promise<WorkLog> {
  return apiFetch<WorkLog>(`/work-logs/${id}/actions`, {
    method: "POST",
    body: input,
  });
}

export interface Evidence {
  id: string;
  workLogId: string;
  stage: EvidenceStage;
  caption: string | null;
  contentType: string;
  size: number;
  sha256: string;
  uploadedBy: string;
  createdAt: string;
}

export async function listEvidence(workLogId: string): Promise<Evidence[]> {
  return apiFetch<Evidence[]>(`/evidence?workLogId=${encodeURIComponent(workLogId)}`);
}

export async function uploadEvidence(
  workLogId: string,
  file: File,
  stage: EvidenceStage,
  caption: string,
  onProgress?: (percent: number) => void,
): Promise<Evidence> {
  const form = new FormData();
  form.append("file", file);
  form.append("workLogId", workLogId);
  form.append("stage", stage);
  form.append("caption", caption);
  return uploadWithProgress<Evidence>(`${API_URL}/evidence`, form, onProgress);
}

/** Multipart upload via XMLHttpRequest so progress can be surfaced on slow field links. */
function uploadWithProgress<T>(
  url: string,
  form: FormData,
  onProgress?: (percent: number) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    if (csrfToken) xhr.setRequestHeader("x-csrf-token", csrfToken);
    if (onProgress) {
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      });
    }
    xhr.addEventListener("load", () => {
      const text = xhr.responseText || "null";
      let body: T | null = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as T);
        return;
      }
      const errorBody = body as { error?: { code?: string; message?: string } } | null;
      reject(
        new ApiError(
          xhr.status,
          errorBody?.error?.code ?? "REQUEST_FAILED",
          errorBody?.error?.message ?? "Request failed",
        ),
      );
    });
    xhr.addEventListener("error", () => {
      reject(new ApiError(0, "REQUEST_FAILED", "Network error during upload"));
    });
    xhr.send(form);
  });
}

export async function downloadEvidence(evidenceId: string): Promise<Blob> {
  const response = await fetch(`${API_URL}/evidence/${evidenceId}/download`, {
    credentials: "include",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      body?.error?.code ?? "REQUEST_FAILED",
      body?.error?.message ?? "Request failed",
    );
  }
  return response.blob();
}

// -- Phase 7: reports ---------------------------------------------------------

export interface OrganisationWard {
  id: string;
  code: string;
  name: string;
  subcountyId: string;
}

export interface OrganisationSubcounty {
  id: string;
  code: string;
  name: string;
  wards: OrganisationWard[];
}

export interface OrganisationCounty {
  id: string;
  code: string;
  name: string;
  subcounties: OrganisationSubcounty[];
}

export interface ReportPhotoRef {
  evidenceId: string;
  accessPath?: string;
  sha256: string;
  caption: string | null;
  stage: string;
}

export interface ReportRosterRow {
  employeeNumber: string;
  fullName: string;
  role: string | null;
  status: string;
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
  completionStatus: string;
  outstandingWork: string | null;
  photos: ReportPhotoRef[];
}

export interface ReportSnapshot {
  scopeType: ReportScopeType;
  scopeId: string;
  scopeName: string;
  startDate: string;
  endDate: string;
  kind: ReportKind;
  generatedAt: string;
  signedBy: string | null;
  signedTitle: string | null;
  totals: Record<string, number>;
  days: ReportDay[];
  workLogs: ReportWorkLog[];
}

export interface ReportEvidenceRef {
  id: string;
  evidenceId: string | null;
  accessPath?: string;
  sha256: string;
  caption: string | null;
  stage: string;
}

export interface Report {
  id: string;
  kind: ReportKind;
  scopeType: ReportScopeType;
  scopeId: string;
  periodStart: string;
  periodEnd: string;
  status: ReportStatus;
  title: string;
  narrative: string;
  recommendations: string;
  snapshot: ReportSnapshot;
  version: number;
  finalizedBy: string | null;
  finalizedAt: string | null;
  createdBy: string;
  createdAt: string;
  evidence: ReportEvidenceRef[];
}

export interface ReportSummary {
  id: string;
  kind: ReportKind;
  scopeType: ReportScopeType;
  scopeId: string;
  periodStart: string;
  periodEnd: string;
  status: ReportStatus;
  title: string;
  version: number;
  finalizedBy: string | null;
  finalizedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ReportPreview {
  snapshot: ReportSnapshot;
  narrative: string;
  recommendations: string;
  title: string;
}

export interface ReportAiDraft extends ReportPreview {
  narrativeSource: "ai" | "deterministic";
}

export interface ReportPeriodInput {
  scopeType: ReportScopeType;
  scopeId: string;
  startDate: string;
  endDate: string;
  kind: ReportKind;
}

export async function fetchOrganisationTree(): Promise<OrganisationCounty[]> {
  const result = await apiFetch<{ counties: OrganisationCounty[] }>("/organisations");
  return result.counties;
}

export async function previewReport(input: ReportPeriodInput): Promise<ReportPreview> {
  const params = new URLSearchParams();
  params.set("scopeType", input.scopeType);
  params.set("scopeId", input.scopeId);
  params.set("startDate", input.startDate);
  params.set("endDate", input.endDate);
  params.set("kind", input.kind);
  return apiFetch<ReportPreview>(`/reports/preview?${params.toString()}`);
}

export async function draftReportNarrative(input: ReportPeriodInput): Promise<ReportAiDraft> {
  return apiFetch<ReportAiDraft>("/reports/ai-draft", { method: "POST", body: input });
}

export async function finalizeReport(
  input: ReportPeriodInput & { narrative?: string; recommendations?: string },
): Promise<Report> {
  return apiFetch<Report>("/reports", { method: "POST", body: input });
}

export async function listReports(query?: {
  scopeType?: ReportScopeType;
  scopeId?: string;
  kind?: ReportKind;
}): Promise<ReportSummary[]> {
  return (await listReportsPage(query)).items;
}

export async function listReportsPage(query?: {
  scopeType?: ReportScopeType;
  scopeId?: string;
  kind?: ReportKind;
  page?: number;
  pageSize?: number;
}): Promise<{ items: ReportSummary[]; total: number; page: number; pageSize: number }> {
  const params = new URLSearchParams();
  if (query?.scopeType) params.set("scopeType", query.scopeType);
  if (query?.scopeId) params.set("scopeId", query.scopeId);
  if (query?.kind) params.set("kind", query.kind);
  if (query?.page) params.set("page", String(query.page));
  if (query?.pageSize) params.set("pageSize", String(query.pageSize));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`${API_URL}/reports${suffix}`, { credentials: "include" });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? "REQUEST_FAILED",
      body?.error?.message ?? "Request failed",
    );
  }
  return {
    items: body as ReportSummary[],
    total: Number(response.headers.get("x-total-count") ?? (body as ReportSummary[]).length),
    page: Number(response.headers.get("x-page") ?? query?.page ?? 1),
    pageSize: Number(response.headers.get("x-page-size") ?? query?.pageSize ?? 25),
  };
}

export async function fetchReport(id: string): Promise<Report> {
  return apiFetch<Report>(`/reports/${encodeURIComponent(id)}`);
}

export async function downloadReportEvidence(accessPath: string): Promise<Blob> {
  if (!accessPath.startsWith(`${API_URL}/reports/`)) {
    throw new ApiError(400, "INVALID_EVIDENCE_PATH", "Invalid report evidence path");
  }
  const response = await fetch(accessPath, { credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      body?.error?.code ?? "REQUEST_FAILED",
      body?.error?.message ?? "Request failed",
    );
  }
  return response.blob();
}

export async function downloadReportCsv(id: string): Promise<Blob> {
  const response = await fetch(`${API_URL}/reports/${encodeURIComponent(id)}/csv`, {
    credentials: "include",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      body?.error?.code ?? "REQUEST_FAILED",
      body?.error?.message ?? "Request failed",
    );
  }
  return response.blob();
}
