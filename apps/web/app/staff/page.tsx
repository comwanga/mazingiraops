"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DashNav } from "@/components/DashNav";
import { StatusMessages } from "@/components/StatusMessages";
import {
  ApiError,
  Employee,
  StaffImportResult,
  Ward,
  apiErrorMessage,
  assignStaff,
  commitStaffImport,
  createStaff,
  endStaffAssignment,
  fetchMe,
  listStaff,
  listWards,
  previewStaffImport,
  setStaffActive,
  updateStaff,
} from "@/lib/api";

const PAGE_SIZE = 20;

const EMPTY_FORM = {
  employeeNumber: "",
  fullName: "",
  phone: "",
  email: "",
  designation: "Green Army Staff",
  wardId: "",
};

export default function StaffPage() {
  const router = useRouter();
  const [canManage, setCanManage] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [wards, setWards] = useState<Ward[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Employee | null>(null);
  const editDialogRef = useRef<HTMLDialogElement>(null);
  const [assignmentWard, setAssignmentWard] = useState("");
  const [assignmentType, setAssignmentType] = useState<"TEMPORARY" | "TRANSFER">("TEMPORARY");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importWard, setImportWard] = useState("");
  const [importPreview, setImportPreview] = useState<StaffImportResult | null>(null);
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [duplicateStrategy, setDuplicateStrategy] = useState<"SKIP" | "UPDATE">("SKIP");
  const [confirmEmployee, setConfirmEmployee] = useState<Employee | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const refreshStaff = useCallback(async () => setEmployees(await listStaff()), []);

  const load = useCallback(async () => {
    try {
      const me = await fetchMe();
      if (!me) {
        router.replace("/login");
        return;
      }
      if (me.mustChangePassword) {
        router.replace("/account/password");
        return;
      }
      if (!me.capabilities.includes("STAFF_READ")) {
        router.replace("/dashboard");
        return;
      }
      setCanManage(me.capabilities.includes("STAFF_MANAGE"));
      const [staff, accessible] = await Promise.all([listStaff(), listWards()]);
      setEmployees(staff);
      setWards(accessible);
      setForm((current) => ({
        ...current,
        wardId:
          current.wardId ||
          accessible.find((ward) => ward.id === me.assignments[0]?.wardId)?.id ||
          accessible[0]?.id ||
          "",
      }));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) router.replace("/login");
      else setError(apiErrorMessage(caught, "Unable to load staff"));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const dialog = editDialogRef.current;
    if (!dialog) return;
    if (editing && !dialog.open) dialog.showModal();
    if (!editing && dialog.open) dialog.close();
  }, [editing]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const created = await createStaff({
        ...form,
        email: form.email.trim() || undefined,
      });
      setNotice(`Created ${created.fullName} (${created.employeeNumber}).`);
      setForm((current) => ({ ...EMPTY_FORM, wardId: current.wardId }));
      await refreshStaff();
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to create staff"));
    } finally {
      setSubmitting(false);
    }
  }

  async function onSaveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await updateStaff(editing.id, {
        employeeNumber: editing.employeeNumber,
        fullName: editing.fullName,
        phone: editing.phone,
        email: editing.email?.trim() || null,
        designation: editing.designation,
        residence: editing.profile?.residence ?? null,
        rosterStatus: editing.profile?.rosterStatus === "ANNUAL_LEAVE" ? "ANNUAL_LEAVE" : "ON_DUTY",
      });
      setNotice(`Updated ${updated.fullName}.`);
      setEditing(null);
      await refreshStaff();
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to update staff"));
    } finally {
      setSubmitting(false);
    }
  }

  async function onAssign() {
    if (!editing || !assignmentWard) return;
    setSubmitting(true);
    setError(null);
    try {
      await assignStaff(editing.id, assignmentWard, assignmentType);
      setNotice(
        assignmentType === "TRANSFER"
          ? `Transferred ${editing.fullName} to the selected ward.`
          : `Assigned ${editing.fullName} to an additional ward.`,
      );
      setAssignmentWard("");
      setEditing(null);
      await refreshStaff();
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to assign staff"));
    } finally {
      setSubmitting(false);
    }
  }

  async function onEndAssignment(assignmentId: string) {
    if (!editing) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await endStaffAssignment(editing.id, assignmentId);
      setEditing(updated);
      setNotice("Temporary assignment ended.");
      await refreshStaff();
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to end assignment"));
    } finally {
      setSubmitting(false);
    }
  }

  async function onPreviewImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!importFile || !importWard) return;
    setError(null);
    setNotice(null);
    setImportProgress(0);
    try {
      setImportPreview(await previewStaffImport(importWard, importFile, setImportProgress));
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to preview the staff register"));
    } finally {
      setImportProgress(null);
    }
  }

  async function onCommitImport() {
    if (!importPreview || !importFile || !importWard) return;
    const rows = importPreview.rows
      .filter((row) => row.status === "CREATE" || row.status === "UPDATE")
      .map((row) => row.value);
    if (rows.length === 0) {
      setError("There are no valid rows to import.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await commitStaffImport({
        wardId: importWard,
        sourceName: importFile.name,
        duplicateStrategy,
        rows,
      });
      setNotice(`Import complete. ${result.summary.CREATE ?? 0} created, ${result.summary.UPDATE ?? 0} updated, and ${result.summary.SKIPPED ?? 0} skipped.`);
      setImportPreview(null);
      setImportFile(null);
      await refreshStaff();
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to import the staff register"));
    } finally {
      setSubmitting(false);
    }
  }

  async function onToggleActive(employee: Employee) {
    setConfirmEmployee(null);
    setError(null);
    try {
      await setStaffActive(employee.id, !employee.active);
      setNotice(`${employee.fullName} is now ${employee.active ? "inactive" : "active"}.`);
      await refreshStaff();
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to update staff"));
    }
  }

  const query = search.trim().toLowerCase();
  const filtered = employees.filter((employee) => {
    const rosterStatus = employee.active
      ? employee.profile?.rosterStatus ?? "ON_DUTY"
      : "INACTIVE";
    return (
      (statusFilter === "ALL" || rosterStatus === statusFilter) &&
      [employee.fullName, employee.employeeNumber, employee.phone, employee.email ?? "", employee.ward.name]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <main className="dashboard" aria-busy={loading}>
      <header className="dash-header">
        <BrandLogo size={44} href="/dashboard" />
        <div className="dash-title">
          <p className="eyebrow">MAZINGIRA OPS · STAFF REGISTER</p>
          <h1>Staff</h1>
        </div>
        <DashNav />
      </header>

      <StatusMessages error={error} notice={notice} loading={loading ? "Loading staff..." : null} />

      {canManage && (
        <section className="panel">
          <h2>Add staff member</h2>
          <form className="grid-form" onSubmit={onCreate}>
            <label>
              Payroll/Employee ID
              <input value={form.employeeNumber} onChange={(event) => setForm({ ...form, employeeNumber: event.target.value.replace(/\D/g, "").slice(0, 11) })} placeholder="e.g. 20230228567" pattern="(19|20)\d{9}" maxLength={11} required />
            </label>
            <label>
              Full name
              <input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required />
            </label>
            <label>
              Phone
              <input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="0712 000 000" required />
            </label>
            <label>
              Email <span className="optional">Optional</span>
              <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </label>
            <label>
              Designation
              <input value={form.designation} onChange={(event) => setForm({ ...form, designation: event.target.value })} required />
            </label>
            <label>
              Primary ward
              <select value={form.wardId} onChange={(event) => setForm({ ...form, wardId: event.target.value })} required>
                <option value="">Select ward...</option>
                {wards.map((ward) => <option key={ward.id} value={ward.id}>{ward.name} ({ward.code})</option>)}
              </select>
            </label>
            <button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Add staff"}</button>
          </form>
        </section>
      )}

      {canManage && (
        <section className="panel" aria-labelledby="import-title">
          <h2 id="import-title">Import staff register</h2>
          <p className="muted-text">Upload a CSV or XLSX register, review every row, then commit valid records.</p>
          <form className="grid-form" onSubmit={onPreviewImport}>
            <label>Ward<select value={importWard} onChange={(event) => { setImportWard(event.target.value); setImportPreview(null); }} required><option value="">Select ward...</option>{wards.map((ward) => <option key={ward.id} value={ward.id}>{ward.name} ({ward.code})</option>)}</select></label>
            <label>Register file<input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setImportFile(event.target.files?.[0] ?? null); setImportPreview(null); }} required /></label>
            <button type="submit" disabled={!importFile || !importWard || importProgress !== null}>{importProgress === null ? "Preview import" : `Uploading ${importProgress}%`}</button>
          </form>
          {importPreview && (
            <div className="import-preview" aria-live="polite">
              <div className="metrics">{Object.entries(importPreview.summary).map(([status, count]) => <div className="metric" key={status}><span className="metric-value">{count}</span><span className="metric-label">{status.replace(/_/g, " ")}</span></div>)}</div>
              <div className="table-wrap"><table className="data-table"><thead><tr><th>Row</th><th>Payroll/Employee ID</th><th>Name</th><th>Phone</th><th>Status</th><th>Residence</th><th>Result</th><th>Details</th></tr></thead><tbody>{importPreview.rows.map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{String(row.value.employeeNumber ?? "")}</td><td>{String(row.value.fullName ?? "")}</td><td>{String(row.value.phone ?? "")}</td><td>{String(row.value.rosterStatus ?? "").replace(/_/g, " ")}</td><td>{String(row.value.residence ?? "")}</td><td><span className={`badge ${row.status === "CREATE" ? "ok" : row.status === "UPDATE" ? "submitted" : "rejected"}`}>{row.status.replace(/_/g, " ")}</span></td><td>{row.errors?.join("; ") ?? ""}</td></tr>)}</tbody></table></div>
              <div className="import-actions"><label>Existing employee IDs<select value={duplicateStrategy} onChange={(event) => setDuplicateStrategy(event.target.value as "SKIP" | "UPDATE")}><option value="SKIP">Skip existing staff</option><option value="UPDATE">Update existing staff</option></select></label><button type="button" className="secondary-btn" onClick={() => setImportPreview(null)}>Discard preview</button><button type="button" disabled={submitting || !importPreview.rows.some((row) => row.status === "CREATE" || row.status === "UPDATE")} onClick={() => void onCommitImport()}>{submitting ? "Importing..." : "Commit valid rows"}</button></div>
            </div>
          )}
        </section>
      )}

      <dialog
        ref={editDialogRef}
        className="app-dialog staff-edit-dialog"
        aria-labelledby="edit-staff-title"
        onCancel={(event) => { event.preventDefault(); setEditing(null); }}
        onClose={() => setEditing(null)}
      >
        {editing && <>
          <div className="panel-heading">
            <h2 id="edit-staff-title">Edit {editing.fullName}</h2>
            <button type="button" className="link-btn" onClick={() => setEditing(null)}>Close</button>
          </div>
          <form className="grid-form" onSubmit={onSaveEdit}>
            <label>Payroll/Employee ID<input value={editing.employeeNumber} onChange={(event) => setEditing({ ...editing, employeeNumber: event.target.value.replace(/\D/g, "").slice(0, 11) })} placeholder="e.g. 20230228567" pattern="(19|20)\d{9}" maxLength={11} required /></label>
            <label>Full name<input value={editing.fullName} onChange={(event) => setEditing({ ...editing, fullName: event.target.value })} required /></label>
            <label>Phone<input type="tel" value={editing.phone} onChange={(event) => setEditing({ ...editing, phone: event.target.value })} required /></label>
            <label>Email <span className="optional">Optional</span><input type="email" value={editing.email ?? ""} onChange={(event) => setEditing({ ...editing, email: event.target.value })} /></label>
            <label>Designation<input value={editing.designation} onChange={(event) => setEditing({ ...editing, designation: event.target.value })} required /></label>
            <label>Residence<input value={editing.profile?.residence ?? ""} onChange={(event) => setEditing({ ...editing, profile: { residence: event.target.value, rosterStatus: editing.profile?.rosterStatus ?? "ON_DUTY" } })} /></label>
            <label>Roster status<select value={editing.profile?.rosterStatus ?? "ON_DUTY"} onChange={(event) => setEditing({ ...editing, profile: { residence: editing.profile?.residence ?? null, rosterStatus: event.target.value } })}><option value="ON_DUTY">On duty</option><option value="ANNUAL_LEAVE">Annual leave</option></select></label>
            <button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save changes"}</button>
          </form>
          <div className="assignment-row">
            <label>Assignment type<select value={assignmentType} onChange={(event) => setAssignmentType(event.target.value as "TEMPORARY" | "TRANSFER")}><option value="TEMPORARY">Temporary additional ward</option><option value="TRANSFER">Transfer primary ward</option></select></label>
            <label>Destination ward<select value={assignmentWard} onChange={(event) => setAssignmentWard(event.target.value)}><option value="">Select ward...</option>{wards.filter((ward) => ward.id !== editing.wardId && !editing.assignments.some((assignment) => assignment.wardId === ward.id)).map((ward) => <option key={ward.id} value={ward.id}>{ward.name} ({ward.code})</option>)}</select></label>
            <button type="button" className="secondary-btn" disabled={!assignmentWard || submitting} onClick={() => void onAssign()}>{assignmentType === "TRANSFER" ? "Transfer" : "Add assignment"}</button>
          </div>
          {editing.assignments.length > 0 && <div className="active-assignments"><strong>Temporary assignments</strong>{editing.assignments.map((assignment) => <span key={assignment.id}>{wards.find((ward) => ward.id === assignment.wardId)?.name ?? assignment.wardId}<button type="button" className="danger-link" disabled={submitting} onClick={() => void onEndAssignment(assignment.id)}>End</button></span>)}</div>}
        </>}
      </dialog>

      <section className="panel">
        <div className="panel-heading">
          <h2>Registered staff <span className="count">{filtered.length}</span></h2>
          <label className="search-label">
            <span className="visually-hidden">Search staff</span>
            <input type="search" value={search} placeholder="Search staff" onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          </label>
        </div>
        <div className="filter-row">
          <label>Status<select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option value="ALL">All statuses</option><option value="ON_DUTY">On duty</option><option value="ANNUAL_LEAVE">Annual leave</option><option value="INACTIVE">Inactive</option></select></label>
        </div>
        {visible.length === 0 ? (!loading && <p className="empty">No staff match this search.</p>) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Number</th><th>Name</th><th>Contact</th><th>Ward</th><th>Designation</th><th>Roster status</th>{canManage && <th>Actions</th>}</tr></thead>
              <tbody>{visible.map((employee) => (
                <tr key={employee.id}>
                  <td>{employee.employeeNumber}</td>
                  <td>{employee.fullName}</td>
                  <td>{employee.phone}{employee.email && <><br /><span className="muted-text">{employee.email}</span></>}</td>
                  <td>{employee.ward.code}{employee.assignments.length > 0 && <span className="muted-text"> +{employee.assignments.length}</span>}</td>
                  <td>{employee.designation}</td>
                  <td><span className={`badge ${!employee.active ? "muted" : employee.profile?.rosterStatus === "ANNUAL_LEAVE" ? "leave" : "ok"}`}>{!employee.active ? "Inactive" : employee.profile?.rosterStatus === "ANNUAL_LEAVE" ? "Annual leave" : "On duty"}</span></td>
                  {canManage && <td><div className="doc-actions"><button type="button" className="link-btn" onClick={() => { setEditing(employee); setAssignmentWard(""); }}>Edit</button><button type="button" className={employee.active ? "danger-link" : "link-btn"} onClick={() => setConfirmEmployee(employee)}>{employee.active ? "Deactivate" : "Reactivate"}</button></div></td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {pageCount > 1 && <nav className="pagination" aria-label="Staff pages"><button type="button" className="secondary-btn" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button type="button" className="secondary-btn" disabled={page === pageCount} onClick={() => setPage((current) => current + 1)}>Next</button></nav>}
      </section>

      <ConfirmDialog
        open={Boolean(confirmEmployee)}
        title={`${confirmEmployee?.active ? "Deactivate" : "Reactivate"} staff member?`}
        description={confirmEmployee?.active ? `${confirmEmployee.fullName} will no longer appear on active attendance rosters.` : `${confirmEmployee?.fullName ?? "This staff member"} will return to active rosters.`}
        confirmLabel={confirmEmployee?.active ? "Deactivate" : "Reactivate"}
        onCancel={() => setConfirmEmployee(null)}
        onConfirm={() => confirmEmployee && void onToggleActive(confirmEmployee)}
      />
    </main>
  );
}
