"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DashNav } from "@/components/DashNav";
import { StatusMessages } from "@/components/StatusMessages";
import {
  AccessRequest,
  AccessRequestDecision,
  ApiError,
  ManagedUser,
  PermissionCatalog,
  apiErrorMessage,
  OrganisationCounty,
  ReportScopeType,
  RoleCode,
  UserAssignmentInput,
  fetchMe,
  fetchOrganisationTree,
  fetchPermissionCatalog,
  listAccessRequests,
  listUsers,
  resetUserPassword,
  reviewAccessRequest,
  setUserActive,
  updateUserAssignments,
  updateRoleCapabilities,
} from "@/lib/api";

const ROLE_OPTIONS: Array<{ code: RoleCode; label: string }> = [
  { code: "WARD_OFFICER", label: "Ward Environment Officer (Ward-level)" },
  { code: "SUBCOUNTY_REVIEWER", label: "Sub-County Environment Officer (Subcounty-level)" },
  { code: "ASSISTANT_DIRECTOR", label: "Assistant Director of Environment (County-level)" },
  { code: "DEPUTY_DIRECTOR", label: "Deputy Director of Environment (County-level)" },
  { code: "DIRECTOR", label: "Director of Environment (County-level)" },
  { code: "HR_VIEWER", label: "HR / Personnel Viewer" },
  { code: "READ_ONLY", label: "Read-Only Observer / Audit Reviewer" },
];

const USER_ROLE_OPTIONS: Array<{ code: RoleCode; label: string }> = [
  { code: "SYSTEM_ADMIN", label: "System Administrator (County Superuser)" },
  ...ROLE_OPTIONS,
];

interface ScopeOption {
  scopeType: ReportScopeType;
  scopeId: string;
  label: string;
}

function flattenScopes(counties: OrganisationCounty[]): ScopeOption[] {
  const options: ScopeOption[] = [];
  for (const county of counties) {
    options.push({ scopeType: "COUNTY", scopeId: county.id, label: `${county.name} (County)` });
    for (const subcounty of county.subcounties) {
      options.push({
        scopeType: "SUBCOUNTY",
        scopeId: subcounty.id,
        label: `${subcounty.name} (Subcounty)`,
      });
      for (const ward of subcounty.wards) {
        options.push({ scopeType: "WARD", scopeId: ward.id, label: `${ward.name} (Ward)` });
      }
    }
  }
  return options;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
}

interface ReviewDraft {
  roleCode: RoleCode;
  scopeType: ReportScopeType | "";
  scopeId: string;
  note: string;
}

function defaultDraft(request: AccessRequest): ReviewDraft {
  return {
    roleCode: "READ_ONLY",
    scopeType: (request.requestedScope ?? "") as ReviewDraft["scopeType"],
    scopeId: request.requestedScopeId ?? "",
    note: "",
  };
}

export default function AccessRequestsPage() {
  const router = useRouter();
  const [currentUserId, setCurrentUserId] = useState("");
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [scopes, setScopes] = useState<ScopeOption[]>([]);
  const [reviews, setReviews] = useState<Record<string, ReviewDraft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [assignmentDraft, setAssignmentDraft] = useState<UserAssignmentInput[]>([]);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmActive, setConfirmActive] = useState<{ user: ManagedUser; active: boolean } | null>(null);
  const [permissions, setPermissions] = useState<PermissionCatalog | null>(null);
  const [roleCapabilityDrafts, setRoleCapabilityDrafts] = useState<Record<string, string[]>>({});

  const load = useCallback(async () => {
    try {
      const me = await fetchMe();
      if (!me) {
        router.push("/login");
        return;
      }
      if (me.mustChangePassword) {
        router.push("/account/password");
        return;
      }
      if (!me.capabilities.includes("USERS_MANAGE")) {
        router.replace("/dashboard");
        return;
      }
      setCurrentUserId(me.id);
      const counties = await fetchOrganisationTree();
      setScopes(flattenScopes(counties));
      const [items, managedUsers, permissionCatalog] = await Promise.all([
        listAccessRequests(),
        listUsers(),
        me.capabilities.includes("PERMISSIONS_MANAGE") ? fetchPermissionCatalog() : Promise.resolve(null),
      ]);
      setRequests(items);
      setUsers(managedUsers);
      setPermissions(permissionCatalog);
      setRoleCapabilityDrafts(Object.fromEntries(
        permissionCatalog?.roles.map((role) => [role.code, role.capabilities]) ?? [],
      ));
      setReviews(
        Object.fromEntries(items.map((item) => [item.id, defaultDraft(item)])),
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
      } else {
        setError(apiErrorMessage(err, "Unable to load access requests"));
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  async function saveRolePermissions(roleCode: RoleCode) {
    setBusy(`role-${roleCode}`);
    setError(null);
    try {
      await updateRoleCapabilities(roleCode, roleCapabilityDrafts[roleCode] ?? []);
      setPermissions(await fetchPermissionCatalog());
      setNotice(`Updated permissions for ${roleCode.replace(/_/g, " ").toLowerCase()}.`);
    } catch (cause) {
      setError(apiErrorMessage(cause, "Unable to update role permissions"));
    } finally {
      setBusy(null);
    }
  }

  async function refreshUsers() {
    setUsers(await listUsers());
  }

  useEffect(() => {
    void load();
  }, [load]);

  function updateReview(id: string, patch: Partial<ReviewDraft>) {
    setReviews((current) => ({
      ...current,
      [id]: { ...(current[id] ?? defaultDraft({ id, requestedScope: "", requestedScopeId: null } as AccessRequest)), ...patch },
    }));
  }

  async function decide(id: string, action: "approve" | "reject") {
    const draft = reviews[id];
    setError(null);
    setNotice(null);
    setBusy(id);
    try {
      const decision: AccessRequestDecision = { action, note: draft?.note || undefined };
      if (action === "approve") {
        decision.roleCode = draft?.roleCode ?? "READ_ONLY";
        if (draft?.scopeType && draft.scopeId) {
          decision.scopeType = draft.scopeType;
          decision.scopeId = draft.scopeId;
        }
      }
      await reviewAccessRequest(id, decision);
      setNotice(
        action === "approve"
          ? `Approved ${requests.find((request) => request.id === id)?.email ?? "the request"}.`
          : "Request rejected.",
      );
      const items = await listAccessRequests();
      setRequests(items);
      setReviews((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to review request"));
    } finally {
      setBusy(null);
    }
  }

  function beginEdit(user: ManagedUser) {
    setEditingUser(user);
    setAssignmentDraft(
      user.assignments.map(({ roleCode, scopeType, scopeId }) => ({ roleCode, scopeType, scopeId })),
    );
    setTemporaryPassword("");
    setConfirmPassword("");
  }

  function updateAssignment(index: number, patch: Partial<UserAssignmentInput>) {
    setAssignmentDraft((current) =>
      current.map((assignment, assignmentIndex) =>
        assignmentIndex === index ? { ...assignment, ...patch } : assignment,
      ),
    );
  }

  async function saveAssignments() {
    if (!editingUser || assignmentDraft.length === 0) return;
    setBusy(editingUser.id);
    setError(null);
    setNotice(null);
    try {
      await updateUserAssignments(editingUser.id, assignmentDraft);
      setNotice(`Updated assignments for ${editingUser.displayName}. Their active sessions were closed.`);
      setEditingUser(null);
      await refreshUsers();
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to update user assignments"));
    } finally {
      setBusy(null);
    }
  }

  async function changeUserActive(user: ManagedUser, active: boolean) {
    setConfirmActive(null);
    setBusy(user.id);
    setError(null);
    setNotice(null);
    try {
      await setUserActive(user.id, active);
      setNotice(`${user.displayName} was ${active ? "restored" : "disabled"}.`);
      await refreshUsers();
    } catch (err) {
      setError(apiErrorMessage(err, `Unable to ${active ? "restore" : "disable"} the account`));
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword() {
    if (!editingUser) return;
    if (temporaryPassword !== confirmPassword) {
      setError("Temporary passwords do not match.");
      return;
    }
    setBusy(editingUser.id);
    setError(null);
    setNotice(null);
    try {
      await resetUserPassword(editingUser.id, temporaryPassword);
      setNotice(`Password reset for ${editingUser.displayName}. They must change it at next sign-in.`);
      setTemporaryPassword("");
      setConfirmPassword("");
      await refreshUsers();
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to reset the password"));
    } finally {
      setBusy(null);
    }
  }

  const pending = requests.filter((request) => request.status === "PENDING");

  return (
    <main className="dashboard" aria-busy={loading}>
      <header className="dash-header">
        <BrandLogo size={44} href="/dashboard" />
        <div className="dash-title">
          <p className="eyebrow">MAZINGIRA OPS · USER ACCESS</p>
          <h1>Access requests</h1>
        </div>
        <DashNav />
      </header>

      <StatusMessages error={error} notice={notice} loading={loading ? "Loading user access..." : null} />

      {pending.length === 0 ? (!loading && (
        <section className="panel">
          <h2>Pending requests</h2>
          <p className="empty">No access requests waiting for review.</p>
        </section>
      )) : (
        pending.map((request) => {
          const draft = reviews[request.id];
          return (
            <section className="panel" key={request.id}>
              <h2>{request.displayName}</h2>
              <p className="muted-text">
                {request.email} · requested {formatWhen(request.createdAt)}
              </p>
              {request.reason && <p className="muted-text">“{request.reason}”</p>}
              {request.requestedScope && (
                <p className="muted-text">
                  Requested scope: {request.requestedScope}
                  {request.requestedScopeId ? ` · ${request.requestedScopeId}` : ""}
                </p>
              )}
              <form
                className="grid-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void decide(request.id, "approve");
                }}
              >
                <label>
                  Role
                  <select
                    value={draft?.roleCode ?? "READ_ONLY"}
                    onChange={(event) =>
                      updateReview(request.id, { roleCode: event.target.value as RoleCode })
                    }
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Scope
                  <select
                    value={draft?.scopeId ?? ""}
                    onChange={(event) => {
                      const scope = scopes.find((option) => option.scopeId === event.target.value);
                      updateReview(request.id, {
                        scopeId: event.target.value,
                        scopeType: scope?.scopeType ?? "",
                      });
                    }}
                    required={!request.requestedScopeId}
                  >
                    <option value="">Select scope...</option>
                    {scopes.map((option) => (
                      <option key={`${option.scopeType}-${option.scopeId}`} value={option.scopeId}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Review note
                  <input
                    type="text"
                    value={draft?.note ?? ""}
                    maxLength={500}
                    placeholder="Optional note to the requester"
                    onChange={(event) => updateReview(request.id, { note: event.target.value })}
                  />
                </label>
                <div className="review-actions">
                  <button type="submit" disabled={busy === request.id}>
                    {busy === request.id ? "Working..." : "Approve"}
                  </button>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => void decide(request.id, "reject")}
                    disabled={busy === request.id}
                  >
                    Reject
                  </button>
                </div>
              </form>
            </section>
          );
        })
      )}

      <section className="panel" aria-labelledby="user-accounts-title">
        <h2 id="user-accounts-title">User accounts</h2>
        {users.length === 0 ? (!loading && (
          <p className="empty">No user accounts are visible in your scope.</p>
        )) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Assignments</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.displayName}{user.id === currentUserId && <span className="muted-text"> (you)</span>}</td>
                    <td>{user.email}</td>
                    <td>
                      <div className="assignment-list">
                        {user.assignments.map((assignment) => (
                          <span key={assignment.id}>
                            {assignment.roleName} · {scopes.find((scope) => scope.scopeId === assignment.scopeId)?.label ?? `${assignment.scopeType} scope`}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${user.active ? "approved" : "rejected"}`}>{user.active ? "ACTIVE" : "DISABLED"}</span>
                      {user.mustChangePassword && <span className="muted-text"> · password change required</span>}
                    </td>
                    <td>
                      <div className="doc-actions">
                        <button type="button" className="link-btn" onClick={() => beginEdit(user)}>Manage</button>
                        <button
                          type="button"
                          className={user.active ? "danger-link" : "link-btn"}
                          disabled={busy === user.id || (user.active && user.id === currentUserId)}
                          title={user.active && user.id === currentUserId ? "You cannot disable your own account" : undefined}
                          onClick={() => setConfirmActive({ user, active: !user.active })}
                        >
                          {user.active ? "Disable" : "Restore"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editingUser && (
        <section className="panel" aria-labelledby="manage-user-title">
          <div className="panel-heading">
            <div>
              <h2 id="manage-user-title">Manage {editingUser.displayName}</h2>
              <p className="muted-text">Assignment changes and password resets close the user&apos;s active sessions.</p>
            </div>
            <button type="button" className="link-btn" onClick={() => setEditingUser(null)}>Close</button>
          </div>
          <div className="user-assignment-editor">
            {assignmentDraft.map((assignment, index) => (
              <div className="assignment-row" key={`${index}-${assignment.scopeId}`}>
                <label>
                  Role
                  <select value={assignment.roleCode} onChange={(event) => updateAssignment(index, { roleCode: event.target.value as RoleCode })}>
                    {USER_ROLE_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
                  </select>
                </label>
                <label>
                  Scope
                  <select
                    value={assignment.scopeId}
                    onChange={(event) => {
                      const selectedScope = scopes.find((scope) => scope.scopeId === event.target.value);
                      if (selectedScope) updateAssignment(index, { scopeId: selectedScope.scopeId, scopeType: selectedScope.scopeType });
                    }}
                    required
                  >
                    <option value="">Select scope...</option>
                    {scopes.map((scope) => <option key={`${scope.scopeType}-${scope.scopeId}`} value={scope.scopeId}>{scope.label}</option>)}
                  </select>
                </label>
                <button type="button" className="danger-link" disabled={assignmentDraft.length === 1} onClick={() => setAssignmentDraft((current) => current.filter((_, assignmentIndex) => assignmentIndex !== index))}>Remove</button>
              </div>
            ))}
            <div className="review-actions">
              <button
                type="button"
                className="secondary-btn"
                disabled={scopes.length === 0}
                onClick={() => scopes[0] && setAssignmentDraft((current) => [...current, { roleCode: "READ_ONLY", scopeType: scopes[0].scopeType, scopeId: scopes[0].scopeId }])}
              >
                Add assignment
              </button>
              <button type="button" disabled={busy === editingUser.id || assignmentDraft.length === 0 || assignmentDraft.some((assignment) => !assignment.scopeId)} onClick={() => void saveAssignments()}>
                {busy === editingUser.id ? "Saving..." : "Save assignments"}
              </button>
            </div>
          </div>
          <form className="password-reset-form" onSubmit={(event) => { event.preventDefault(); void resetPassword(); }}>
            <h3>Reset password</h3>
            <label>Temporary password<input type="password" autoComplete="new-password" minLength={12} value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} required /></label>
            <label>Confirm temporary password<input type="password" autoComplete="new-password" minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
            <button type="submit" className="danger-btn" disabled={busy === editingUser.id}>{busy === editingUser.id ? "Resetting..." : "Reset password"}</button>
          </form>
        </section>
      )}

      {permissions && (
        <section className="panel" aria-labelledby="role-permissions-title">
          <h2 id="role-permissions-title">Role permissions</h2>
          <p className="muted-text">
            These capability bundles apply only within each user assignment&apos;s organisation scope.
          </p>
          <div className="permission-role-list">
            {permissions.roles.map((role) => (
              <details key={role.code}>
                <summary>{role.name}</summary>
                <div className="permission-grid">
                  {permissions.capabilities.map((capability) => {
                    const checked = (roleCapabilityDrafts[role.code] ?? []).includes(capability.code);
                    return (
                      <label key={capability.code}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => setRoleCapabilityDrafts((current) => ({
                            ...current,
                            [role.code]: event.target.checked
                              ? [...(current[role.code] ?? []), capability.code]
                              : (current[role.code] ?? []).filter((code) => code !== capability.code),
                          }))}
                        />
                        {capability.name}
                      </label>
                    );
                  })}
                </div>
                <button
                  type="button"
                  disabled={busy === `role-${role.code}`}
                  onClick={() => void saveRolePermissions(role.code)}
                >
                  {busy === `role-${role.code}` ? "Saving..." : "Save role permissions"}
                </button>
              </details>
            ))}
          </div>
        </section>
      )}

      {requests.some((request) => request.status !== "PENDING") && (
        <section className="panel">
          <h2>Reviewed</h2>
          <div className="table-wrap"><table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Scope</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {requests
                .filter((request) => request.status !== "PENDING")
                .map((request) => (
                  <tr key={request.id}>
                    <td>{request.displayName}</td>
                    <td>{request.email}</td>
                    <td>
                      <span className={`badge ${request.status === "APPROVED" ? "approved" : "rejected"}`}>
                        {request.status}
                      </span>
                    </td>
                    <td>
                      {request.requestedScope ? `${request.requestedScope} · ${request.requestedScopeId ?? ""}` : "—"}
                    </td>
                    <td>{request.reason}</td>
                  </tr>
                ))}
            </tbody>
          </table></div>
        </section>
      )}
      <ConfirmDialog
        open={Boolean(confirmActive)}
        title={`${confirmActive?.active ? "Restore" : "Disable"} user account?`}
        description={confirmActive?.active ? `${confirmActive.user.displayName} will be able to sign in again.` : `${confirmActive?.user.displayName ?? "This user"} will be signed out and unable to sign in.`}
        confirmLabel={confirmActive?.active ? "Restore account" : "Disable account"}
        onCancel={() => setConfirmActive(null)}
        onConfirm={() => confirmActive && void changeUserActive(confirmActive.user, confirmActive.active)}
      />
    </main>
  );
}
