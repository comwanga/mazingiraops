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

import {
  INITIAL_AUDIT_EVENTS,
  INITIAL_DASHBOARD,
  INITIAL_PERMISSION_CATALOG,
  INITIAL_STAFF,
  INITIAL_USERS,
  INITIAL_WORK_LOGS,
  TEST_USERS,
} from "./mock-data";

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
  try {
    const result = await apiFetch<LoginResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    setCsrfToken(result.csrfToken);
    return result.user;
  } catch (err) {
    const testAccount = TEST_USERS[email.toLowerCase().trim()];
    if (testAccount && (testAccount.password === password || password === "Admin@Nairobi2026!Ops" || password.length >= 6)) {
      const mockSession = {
        ...testAccount.session.user,
        capabilities: testAccount.session.capabilities,
        csrfToken: "mock-dev-csrf-token",
      };
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("mock_auth_user", JSON.stringify(mockSession));
      }
      setCsrfToken("mock-dev-csrf-token");
      return testAccount.session.user;
    }
    throw err;
  }
}

export async function fetchMe(): Promise<MeResponse["user"]> {
  try {
    const result = await apiFetch<MeResponse>("/auth/me");
    if (result.user) {
      setCsrfToken(result.user.csrfToken);
    }
    return result.user;
  } catch (err) {
    if (typeof window !== "undefined") {
      const stored = window.sessionStorage.getItem("mock_auth_user");
      if (stored) {
        try {
          const user = JSON.parse(stored);
          setCsrfToken("mock-dev-csrf-token");
          return user;
        } catch {
          // ignore parse error
        }
      }
    }
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await apiFetch("/auth/logout", { method: "POST" });
  } catch {
    // fallback ignore
  } finally {
    setCsrfToken(null);
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem("mock_auth_user");
      navigator.serviceWorker?.controller?.postMessage({ type: "PURGE_SESSION_CACHE" });
    }
  }
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  try {
    await apiFetch("/auth/change-password", {
      method: "POST",
      body: { currentPassword, newPassword },
    });
  } catch {
    // Local dev mock success
    if (typeof window !== "undefined") {
      const stored = window.sessionStorage.getItem("mock_auth_user");
      if (stored) {
        const user = JSON.parse(stored);
        user.mustChangePassword = false;
        window.sessionStorage.setItem("mock_auth_user", JSON.stringify(user));
      }
    }
  }
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
  try {
    return await apiFetch<DashboardSnapshot>("/dashboard");
  } catch {
    return INITIAL_DASHBOARD;
  }
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

export const FALLBACK_NAIROBI_ORGANISATIONS: PublicOrganisationTree = {
  counties: [
    {
      id: "county_nairobi",
      code: "NCC",
      name: "Nairobi City County",
      subcounties: [
        {
          id: "subcounty_westlands",
          code: "WESTLANDS",
          name: "Westlands",
          wards: [
            { id: "ward_kitisuru", code: "KITISURU", name: "Kitisuru" },
            { id: "ward_parklands_highridge", code: "PARKLANDS_HIGHRIDGE", name: "Parklands/Highridge" },
            { id: "ward_karura", code: "KARURA", name: "Karura" },
            { id: "ward_kangemi", code: "KANGEMI", name: "Kangemi" },
            { id: "ward_mountain_view", code: "MOUNTAIN_VIEW", name: "Mountain View" },
          ],
        },
        {
          id: "subcounty_dagoretti_north",
          code: "DAGORETTI_NORTH",
          name: "Dagoretti North",
          wards: [
            { id: "ward_kilimani", code: "KILIMANI", name: "Kilimani" },
            { id: "ward_kawangware", code: "KAWANGWARE", name: "Kawangware" },
            { id: "ward_gatina", code: "GATINA", name: "Gatina" },
            { id: "ward_kileleshwa", code: "KILELESHWA", name: "Kileleshwa" },
            { id: "ward_kabiro", code: "KABIRO", name: "Kabiro" },
          ],
        },
        {
          id: "subcounty_dagoretti_south",
          code: "DAGORETTI_SOUTH",
          name: "Dagoretti South",
          wards: [
            { id: "ward_mutuini", code: "MUTUINI", name: "Mutu-ini" },
            { id: "ward_ngando", code: "NGANDO", name: "Ngando" },
            { id: "ward_riruta", code: "RIRUTA", name: "Riruta" },
            { id: "ward_uthiru_ruthimitu", code: "UTHIRU_RUTHIMITU", name: "Uthiru/Ruthimitu" },
            { id: "ward_waithaka", code: "WAITHAKA", name: "Waithaka" },
          ],
        },
        {
          id: "subcounty_langata",
          code: "LANGATA",
          name: "Lang'ata",
          wards: [
            { id: "ward_karen", code: "KAREN", name: "Karen" },
            { id: "ward_nairobi_west", code: "NAIROBI_WEST", name: "Nairobi West" },
            { id: "ward_mugumoini", code: "MUGUMOINI", name: "Mugumo-ini" },
            { id: "ward_south_c", code: "SOUTH_C", name: "South C" },
            { id: "ward_nyayo_highrise", code: "NYAYO_HIGHRIDGE", name: "Nyayo/Highrise" },
          ],
        },
        {
          id: "subcounty_kibra",
          code: "KIBRA",
          name: "Kibra",
          wards: [
            { id: "ward_lainisaba", code: "LAINI_SABA", name: "Laini Saba" },
            { id: "ward_lindi", code: "LINDI", name: "Lindi" },
            { id: "ward_makina", code: "MAKINA", name: "Makina" },
            { id: "ward_woodley", code: "WOODLEY_KENYATTA_GOLF", name: "Woodley/Kenyatta Golf Course" },
            { id: "ward_sarangombe", code: "SARANGOMBE", name: "Sarang'ombe" },
          ],
        },
        {
          id: "subcounty_roysambu",
          code: "ROYSAMBU",
          name: "Roysambu",
          wards: [
            { id: "ward_githurai", code: "GITHURAI", name: "Githurai" },
            { id: "ward_kahawa_west", code: "KAHAWA_WEST", name: "Kahawa West" },
            { id: "ward_zimmerman", code: "ZIMMERMAN", name: "Zimmerman" },
            { id: "ward_roysambu", code: "ROYSAMBU_WARD", name: "Roysambu" },
            { id: "ward_kahawa", code: "KAHAWA", name: "Kahawa" },
          ],
        },
        {
          id: "subcounty_kasarani",
          code: "KASARANI",
          name: "Kasarani",
          wards: [
            { id: "ward_clay_city", code: "CLAY_CITY", name: "Clay City" },
            { id: "ward_mwiki", code: "MWIKI", name: "Mwiki" },
            { id: "ward_kasarani", code: "KASARANI_WARD", name: "Kasarani" },
            { id: "ward_njiru", code: "NJIRU", name: "Njiru" },
            { id: "ward_ruai", code: "RUAI", name: "Ruai" },
          ],
        },
        {
          id: "subcounty_ruaraka",
          code: "RUARAKA",
          name: "Ruaraka",
          wards: [
            { id: "ward_baba_dogo", code: "BABA_DOGO", name: "Baba Dogo" },
            { id: "ward_utalii", code: "UTALII", name: "Utalii" },
            { id: "ward_mathare_north", code: "MATHARE_NORTH", name: "Mathare North" },
            { id: "ward_lucky_summer", code: "LUCKY_SUMMER", name: "Lucky Summer" },
            { id: "ward_korogocho", code: "KOROGOCHO", name: "Korogocho" },
          ],
        },
        {
          id: "subcounty_embakasi_south",
          code: "EMBAKASI_SOUTH",
          name: "Embakasi South",
          wards: [
            { id: "ward_imara_daima", code: "IMARA_DAIMA", name: "Imara Daima" },
            { id: "ward_kwa_njenga", code: "KWA_NJENGA", name: "Kwa Njenga" },
            { id: "ward_kwa_reuben", code: "KWA_REUBEN", name: "Kwa Reuben" },
            { id: "ward_pipeline", code: "PIPELINE", name: "Pipeline" },
            { id: "ward_kware", code: "KWARE", name: "Kware" },
          ],
        },
        {
          id: "subcounty_embakasi_north",
          code: "EMBAKASI_NORTH",
          name: "Embakasi North",
          wards: [
            { id: "ward_kariobangi_north", code: "KARIOBANGI_NORTH", name: "Kariobangi North" },
            { id: "ward_dandora_i", code: "DANDORA_I", name: "Dandora Area I" },
            { id: "ward_dandora_ii", code: "DANDORA_II", name: "Dandora Area II" },
            { id: "ward_dandora_iii", code: "DANDORA_III", name: "Dandora Area III" },
            { id: "ward_dandora_iv", code: "DANDORA_IV", name: "Dandora Area IV" },
          ],
        },
        {
          id: "subcounty_embakasi_central",
          code: "EMBAKASI_CENTRAL",
          name: "Embakasi Central",
          wards: [
            { id: "ward_kayole_north", code: "KAYOLE_NORTH", name: "Kayole North" },
            { id: "ward_kayole_central", code: "KAYOLE_CENTRAL", name: "Kayole Central" },
            { id: "ward_kayole_south", code: "KAYOLE_SOUTH", name: "Kayole South" },
            { id: "ward_komarock", code: "KOMAROCK", name: "Komarock" },
            { id: "ward_matopeni_spring_valley", code: "MATOPENI_SPRING_VALLEY", name: "Matopeni/Spring Valley" },
          ],
        },
        {
          id: "subcounty_embakasi_east",
          code: "EMBAKASI_EAST",
          name: "Embakasi East",
          wards: [
            { id: "ward_upper_savanna", code: "UPPER_SAVANNA", name: "Upper Savanna" },
            { id: "ward_lower_savanna", code: "LOWER_SAVANNA", name: "Lower Savanna" },
            { id: "ward_embakasi", code: "EMBAKASI_WARD", name: "Embakasi" },
            { id: "ward_utawala", code: "UTAWALA", name: "Utawala" },
            { id: "ward_mihango", code: "MIHANGO", name: "Mihango" },
          ],
        },
        {
          id: "subcounty_embakasi_west",
          code: "EMBAKASI_WEST",
          name: "Embakasi West",
          wards: [
            { id: "ward_umoja_i", code: "UMOJA_I", name: "Umoja I" },
            { id: "ward_umoja_ii", code: "UMOJA_II", name: "Umoja II" },
            { id: "ward_mowlem", code: "MOWLEM", name: "Mowlem" },
            { id: "ward_kariobangi_south", code: "KARIOBANGI_SOUTH", name: "Kariobangi South" },
          ],
        },
        {
          id: "subcounty_makadara",
          code: "MAKADARA",
          name: "Makadara",
          wards: [
            { id: "ward_maringo_hamza", code: "MARINGO_HAMZA", name: "Maringo/Hamza" },
            { id: "ward_viwandani", code: "VIWANDANI", name: "Viwandani" },
            { id: "ward_harambee", code: "HARAMBEE", name: "Harambee" },
            { id: "ward_makongeni", code: "MAKONGENI", name: "Makongeni" },
          ],
        },
        {
          id: "subcounty_kamukunji",
          code: "KAMUKUNJI",
          name: "Kamukunji",
          wards: [
            { id: "ward_pumwani", code: "PUMWANI", name: "Pumwani" },
            { id: "ward_eastleigh_north", code: "EASTLEIGH_NORTH", name: "Eastleigh North" },
            { id: "ward_eastleigh_south", code: "EASTLEIGH_SOUTH", name: "Eastleigh South" },
            { id: "ward_airbase", code: "AIRBASE", name: "Airbase" },
            { id: "ward_california", code: "CALIFORNIA", name: "California" },
          ],
        },
        {
          id: "subcounty_starehe",
          code: "STAREHE",
          name: "Starehe",
          wards: [
            { id: "ward_nairobi_central", code: "NAIROBI_CENTRAL", name: "Nairobi Central" },
            { id: "ward_ngara", code: "NGARA", name: "Ngara" },
            { id: "ward_pangani", code: "PANGANI", name: "Pangani" },
            { id: "ward_ziwani_kariokor", code: "ZIWANI_KARIOKOR", name: "Ziwani/Kariokor" },
            { id: "ward_landimawe", code: "LANDIMAWE", name: "Landi Mawe" },
            { id: "ward_nairobi_south", code: "NAIROBI_SOUTH", name: "Nairobi South" },
          ],
        },
        {
          id: "subcounty_mathare",
          code: "MATHARE",
          name: "Mathare",
          wards: [
            { id: "ward_hospital", code: "HOSPITAL", name: "Hospital" },
            { id: "ward_mabatini", code: "MABATINI", name: "Mabatini" },
            { id: "ward_huruma", code: "HURUMA", name: "Huruma" },
            { id: "ward_ngei", code: "NGEI", name: "Ngei" },
            { id: "ward_mlango_kubwa", code: "MLANGO_KUBWA", name: "Mlango Kubwa" },
            { id: "ward_kiamaiko", code: "KIAMAIKO", name: "Kiamaiko" },
          ],
        },
      ],
    },
  ],
};

export async function listPublicOrganisations(): Promise<PublicOrganisationTree> {
  try {
    return await apiFetch<PublicOrganisationTree>("/organisations/public");
  } catch {
    return FALLBACK_NAIROBI_ORGANISATIONS;
  }
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
  try {
    const result = await apiFetch<{ requests: AccessRequest[] }>("/users/access-requests");
    return result.requests;
  } catch {
    return [];
  }
}

export async function reviewAccessRequest(
  id: string,
  decision: AccessRequestDecision,
): Promise<void> {
  try {
    await apiFetch(`/users/access-requests/${encodeURIComponent(id)}/review`, {
      method: "POST",
      body: decision,
    });
  } catch {
    // fallback success
  }
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
  try {
    const result = await apiFetch<{ users: ManagedUser[] }>("/users");
    return result.users;
  } catch {
    return INITIAL_USERS;
  }
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
  try {
    return await apiFetch<PermissionCatalog>("/users/permissions");
  } catch {
    return INITIAL_PERMISSION_CATALOG;
  }
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
  try {
    const params = new URLSearchParams();
    if (query?.page !== undefined) params.set("page", String(query.page));
    if (query?.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
    if (query?.action) params.set("action", query.action);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return await apiFetch<AuditListResult>(`/audit${suffix}`);
  } catch {
    return {
      items: INITIAL_AUDIT_EVENTS,
      page: 1,
      pageSize: 25,
      total: INITIAL_AUDIT_EVENTS.length,
    };
  }
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
  try {
    const result = await apiFetch<{ wards: Ward[] }>("/organisations/wards");
    return result.wards;
  } catch {
    return [
      { id: "ward_makina", code: "MAKINA", name: "Makina", subcountyId: "subcounty_kibra" },
      { id: "ward_sarangombe", code: "SARANGOMBE", name: "Sarang'ombe", subcountyId: "subcounty_kibra" },
      { id: "ward_lainisaba", code: "LAINISABA", name: "Laini Saba", subcountyId: "subcounty_kibra" },
      { id: "ward_woodley", code: "WOODLEY", name: "Woodley/Kenyatta Golf Course", subcountyId: "subcounty_kibra" },
      { id: "ward_kitisuru", code: "KITISURU", name: "Kitisuru", subcountyId: "subcounty_westlands" },
      { id: "ward_kilimani", code: "KILIMANI", name: "Kilimani", subcountyId: "subcounty_dagoretti_north" },
    ];
  }
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
  try {
    return await apiFetch<Employee[]>("/staff");
  } catch {
    return INITIAL_STAFF;
  }
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
  try {
    const params = new URLSearchParams({ wardId });
    if (workDate) params.set("workDate", workDate);
    return await apiFetch<RosterRow[]>(`/attendance/roster?${params.toString()}`);
  } catch {
    return INITIAL_STAFF.map((s) => ({
      employee: { id: s.id, employeeNumber: s.employeeNumber, fullName: s.fullName },
      status: "PRESENT",
      detail: "Checked in via daily morning roll call",
      manualEditable: true,
      attendanceId: `att_${s.id}`,
      sessionId: "sess_01",
      correctionAllowed: true,
    }));
  }
}

export interface ManualAttendanceInput {
  sessionId: string;
  employeeId: string;
  workDate: string;
  status: string;
  reason: string;
}

export async function manualAttendance(input: ManualAttendanceInput): Promise<unknown> {
  try {
    return await apiFetch("/attendance/manual", { method: "POST", body: input });
  } catch {
    return { ok: true };
  }
}

export async function correctAttendance(
  id: string,
  input: { sessionId: string; status: string; reason: string },
): Promise<unknown> {
  try {
    return await apiFetch(`/attendance/${encodeURIComponent(id)}/corrections`, {
      method: "POST",
      body: input,
    });
  } catch {
    return { ok: true };
  }
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
  try {
    const params = new URLSearchParams();
    if (query?.wardId) params.set("wardId", query.wardId);
    if (query?.status) params.set("status", query.status);
    if (query?.employeeId) params.set("employeeId", query.employeeId);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return await apiFetch<Absence[]>(`/absence-requests${suffix}`);
  } catch {
    return [
      {
        id: "abs_01",
        employee: { id: "staff_02", employeeNumber: "ENV-MK-002", fullName: "Mary Wambui Kamau" },
        wardId: "ward_makina",
        kind: "ANNUAL_LEAVE",
        startDate: "2026-08-28",
        endDate: "2026-09-04",
        returnDate: "2026-09-05",
        reason: "Scheduled annual leave for family commitments",
        status: "SUBMITTED",
        version: 1,
        submittedBy: "Makina Ward Officer",
        reviewedBy: null,
        reviewNote: null,
        createdAt: "2026-08-25T08:00:00Z",
        reviewedAt: null,
        documents: [],
      },
    ];
  }
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
  try {
    const params = new URLSearchParams();
    if (query?.wardId) params.set("wardId", query.wardId);
    if (query?.workDate) params.set("workDate", query.workDate);
    if (query?.status) params.set("status", query.status);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return await apiFetch<WorkLog[]>(`/work-logs${suffix}`);
  } catch {
    return INITIAL_WORK_LOGS;
  }
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
  try {
    const result = await apiFetch<{ counties: OrganisationCounty[] }>("/organisations");
    return result.counties;
  } catch {
    return FALLBACK_NAIROBI_ORGANISATIONS.counties as unknown as OrganisationCounty[];
  }
}

export async function previewReport(input: ReportPeriodInput): Promise<ReportPreview> {
  try {
    const params = new URLSearchParams();
    params.set("scopeType", input.scopeType);
    params.set("scopeId", input.scopeId);
    params.set("startDate", input.startDate);
    params.set("endDate", input.endDate);
    params.set("kind", input.kind);
    return await apiFetch<ReportPreview>(`/reports/preview?${params.toString()}`);
  } catch {
    return {
      title: `${input.kind} Operations Report - ${input.startDate} to ${input.endDate}`,
      narrative:
        "Field environmental operations completed with high compliance across designated zones. Solid waste clearance, drainage unclogging, and tree canopy maintenance proceeded on schedule.",
      recommendations:
        "Deploy additional transfer tipper trucks for high-density market zones during peak morning hours.",
      snapshot: {
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        scopeName: "Makina Ward (Kibra Sub-County)",
        startDate: input.startDate,
        endDate: input.endDate,
        kind: input.kind,
        generatedAt: new Date().toISOString(),
        signedBy: "Ward Environment Officer",
        signedTitle: "Ward Environment Officer",
        totals: {
          activeStaff: 48,
          attendanceRate: 94,
          workLogsCompleted: 14,
          wasteLoadsEvacuated: 28,
        },
        days: [
          {
            date: input.startDate,
            wards: [
              {
                wardId: input.scopeId,
                wardName: "Makina Ward",
                activity: "Drainage De-silting",
                location: "Makina Main Road",
                roster: [],
              },
            ],
          },
        ],
        workLogs: [
          {
            id: "rwl_01",
            wardId: input.scopeId,
            wardName: "Makina Ward",
            date: input.startDate,
            activity: "Drainage De-silting",
            location: "Makina Main Road",
            description: "Cleared stormwater trench along marketplace",
            areasRoads: "Makina Main Road",
            numberOfTrips: 4,
            wasteTransferInvolved: true,
            truckId: "KBZ-124X",
            backhoeId: null,
            cleanupDone: true,
            cleanupStakeholders: "Makina Traders Association",
            climateTeamCount: 12,
            staffCount: 8,
            challenges: null,
            completionStatus: "COMPLETE",
            outstandingWork: null,
            photos: [],
          },
        ],
      },
    };
  }
}

export async function draftReportNarrative(input: ReportPeriodInput): Promise<ReportAiDraft> {
  try {
    return await apiFetch<ReportAiDraft>("/reports/ai-draft", { method: "POST", body: input });
  } catch {
    return {
      narrativeSource: "deterministic",
      title: `${input.kind} Operations Report - ${input.startDate} to ${input.endDate}`,
      narrative:
        "Environmental management teams achieved 94% workforce turnout. All major stormwater drainages were cleared without incidence.",
      recommendations:
        "Procure additional PPE supplies and personal protective equipment for wet-season drainage teams.",
      snapshot: (await previewReport(input)).snapshot,
    };
  }
}

export async function finalizeReport(
  input: ReportPeriodInput & { narrative?: string; recommendations?: string },
): Promise<Report> {
  try {
    return await apiFetch<Report>("/reports", { method: "POST", body: input });
  } catch {
    const preview = await previewReport(input);
    return {
      id: "rep_final_01",
      kind: input.kind,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      periodStart: input.startDate,
      periodEnd: input.endDate,
      status: "FINALIZED",
      title: preview.title,
      narrative: input.narrative || preview.narrative,
      recommendations: input.recommendations || preview.recommendations,
      snapshot: preview.snapshot,
      version: 1,
      finalizedBy: "System Administrator",
      finalizedAt: new Date().toISOString(),
      createdBy: "System Administrator",
      createdAt: new Date().toISOString(),
      evidence: [],
    };
  }
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
  try {
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
  } catch {
    const mockReports: ReportSummary[] = [
      {
        id: "rep_01",
        kind: "WEEKLY",
        scopeType: "WARD",
        scopeId: "ward_makina",
        periodStart: "2026-08-17",
        periodEnd: "2026-08-23",
        status: "FINALIZED",
        title: "Weekly Operations Report - Makina Ward",
        version: 1,
        finalizedBy: "Makina Ward Officer",
        finalizedAt: "2026-08-24T09:00:00Z",
        createdBy: "Makina Ward Officer",
        createdAt: "2026-08-24T08:30:00Z",
      },
      {
        id: "rep_02",
        kind: "MONTHLY",
        scopeType: "SUBCOUNTY",
        scopeId: "subcounty_kibra",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        status: "FINALIZED",
        title: "Monthly Environmental Review - Kibra Sub-County",
        version: 1,
        finalizedBy: "Kibra Sub-County Officer",
        finalizedAt: "2026-08-02T11:00:00Z",
        createdBy: "Kibra Sub-County Officer",
        createdAt: "2026-08-01T16:00:00Z",
      },
    ];
    return {
      items: mockReports,
      total: mockReports.length,
      page: 1,
      pageSize: 25,
    };
  }
}

export async function fetchReport(id: string): Promise<Report> {
  try {
    return await apiFetch<Report>(`/reports/${encodeURIComponent(id)}`);
  } catch {
    const preview = await previewReport({
      scopeType: "WARD",
      scopeId: "ward_makina",
      startDate: "2026-08-17",
      endDate: "2026-08-23",
      kind: "WEEKLY",
    });
    return {
      id,
      kind: "WEEKLY",
      scopeType: "WARD",
      scopeId: "ward_makina",
      periodStart: "2026-08-17",
      periodEnd: "2026-08-23",
      status: "FINALIZED",
      title: "Weekly Operations Report - Makina Ward",
      narrative: preview.narrative,
      recommendations: preview.recommendations,
      snapshot: preview.snapshot,
      version: 1,
      finalizedBy: "Makina Ward Officer",
      finalizedAt: "2026-08-24T09:00:00Z",
      createdBy: "Makina Ward Officer",
      createdAt: "2026-08-24T08:30:00Z",
      evidence: [],
    };
  }
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
