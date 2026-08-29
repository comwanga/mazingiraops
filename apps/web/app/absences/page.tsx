"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DashNav } from "@/components/DashNav";
import { StatusMessages } from "@/components/StatusMessages";
import { Absence, AbsenceAction, AbsenceDocument, AbsenceKind, ApiError, Employee, Ward, absenceAction, apiErrorMessage, createAbsence, downloadAbsenceDocument, fetchMe, listAbsences, listStaff, listWards, uploadAbsenceDocument } from "@/lib/api";
import { compressImage } from "@/lib/image";

const KINDS: AbsenceKind[] = [
  "ANNUAL_LEAVE",
  "MATERNITY_LEAVE",
  "PATERNITY_LEAVE",
  "COMPASSIONATE_LEAVE",
  "SICK_OFF",
  "OFFICIAL_DUTY",
  "UNPAID_LEAVE",
];

const DOCUMENT_CATEGORIES = [
  "SICK_SHEET",
  "MEDICAL_CERTIFICATE",
  "LEAVE_FORM",
  "LEAVE_APPROVAL",
  "RETURN_TO_WORK",
  "OTHER",
];

function nairobiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function AbsencesPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ capabilities: string[] } | null>(null);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [wards, setWards] = useState<Ward[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<{ absence: Absence; action: AbsenceAction } | null>(null);
  const [form, setForm] = useState({
    employeeId: "",
    kind: "ANNUAL_LEAVE" as AbsenceKind,
    startDate: nairobiToday(),
    endDate: nairobiToday(),
    returnDate: addDays(nairobiToday(), 1),
    reason: "",
    planned: false,
  });

  const can = (capability: string) => me?.capabilities.includes(capability) ?? false;

  const load = useCallback(async () => {
    try {
      const current = await fetchMe();
      if (!current) {
        router.push("/login");
        return;
      }
      if (current.mustChangePassword) {
        router.push("/account/password");
        return;
      }
      setMe(current);
      if (!current.capabilities.includes("ABSENCE_READ")) {
        router.replace("/dashboard");
        return;
      }
      const [absenceList, staff, accessible] = await Promise.all([
        listAbsences(),
        listStaff(),
        listWards(),
      ]);
      setAbsences(absenceList);
      setEmployees(staff);
      setWards(accessible);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
      } else {
        setError(apiErrorMessage(err, "Unable to load absences"));
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const created = await createAbsence(form);
      setNotice(`Created ${form.kind} for ${created.employee.fullName}.`);
      setForm((current) => ({ ...current, reason: "" }));
      setAbsences(await listAbsences());
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to create absence"));
    } finally {
      setSubmitting(false);
    }
  }

  async function onAction(absence: Absence, action: AbsenceAction, reviewNote?: string) {
    setError(null);
    setNotice(null);
    setPendingAction(null);
    try {
      await absenceAction(absence.id, { action, reviewNote });
      const resultLabel: Record<AbsenceAction, string> = {
        SUBMIT: "submitted",
        APPROVE: "approved",
        REJECT: "rejected",
        CANCEL: "cancelled",
      };
      setNotice(`${absence.employee.fullName}'s request was ${resultLabel[action]}.`);
      setAbsences(await listAbsences());
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to update absence"));
    }
  }

  async function onUploadDocument(
    absence: Absence,
    file: File | null,
    category: string,
  ) {
    if (!file) return;
    setError(null);
    setNotice(null);
    setUploading(true);
    setUploadProgress(0);
    try {
      const prepared = await compressImage(file);
      await uploadAbsenceDocument(absence.id, prepared, category, setUploadProgress);
      setUploading(false);
      setUploadProgress(null);
      setNotice("Document uploaded.");
      setAbsences(await listAbsences());
    } catch (err) {
      setUploading(false);
      setUploadProgress(null);
      setError(apiErrorMessage(err, "Unable to upload document"));
    }
  }

  async function onOpenDocument(document: AbsenceDocument) {
    setError(null);
    try {
      const blob = await downloadAbsenceDocument(document.id);
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to open document"));
    }
  }

  const actionsFor = (absence: Absence) => {
    const actions: Array<{ action: AbsenceAction; label: string; capability: string }> = [];
    if (absence.status === "PLANNED") {
      actions.push({ action: "SUBMIT", label: "Submit", capability: "ABSENCE_MANAGE" });
      actions.push({ action: "CANCEL", label: "Cancel", capability: "ABSENCE_MANAGE" });
    } else if (absence.status === "SUBMITTED") {
      actions.push({ action: "APPROVE", label: "Approve", capability: "ABSENCE_REVIEW" });
      actions.push({ action: "REJECT", label: "Reject", capability: "ABSENCE_REVIEW" });
      actions.push({ action: "CANCEL", label: "Cancel", capability: "ABSENCE_MANAGE" });
    }
    return actions.filter((item) => can(item.capability));
  };

  return (
    <main className="dashboard" aria-busy={loading}>
      <header className="dash-header">
        <BrandLogo size={44} href="/dashboard" />
        <div className="dash-title">
          <p className="eyebrow">MAZINGIRA OPS · ABSENCE MANAGEMENT</p>
          <h1>Absences</h1>
        </div>
        <DashNav />
      </header>

      <StatusMessages error={error} notice={notice} loading={loading ? "Loading absences..." : null} />

      {can("ABSENCE_MANAGE") && (
        <section className="panel">
          <h2>New absence request</h2>
          <form className="grid-form" onSubmit={onCreate}>
            <label>
              Employee
              <select
                value={form.employeeId}
                onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                required
              >
                <option value="">Select employee…</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.fullName} ({employee.employeeNumber})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Kind
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as AbsenceKind })}
              >
                {KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind.replace(/_/g, " ").toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Start date
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                required
              />
            </label>
            <label>
              End date
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                required
              />
            </label>
            <label>
              Return date
              <input
                type="date"
                value={form.returnDate}
                onChange={(e) => setForm({ ...form, returnDate: e.target.value })}
                required
              />
            </label>
            <label>
              Reason
              <input
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder={form.kind === "SICK_OFF" ? "Describe the illness (min 10 chars)" : "Reason for absence"}
              />
            </label>
            <label className="inline-label">
              <input
                type="checkbox"
                checked={form.planned}
                onChange={(e) => setForm({ ...form, planned: e.target.checked })}
              />
              Planned (draft — not yet submitted)
            </label>
            <button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Create request"}
            </button>
          </form>
        </section>
      )}

      <section className="panel">
        <h2>Absence requests</h2>
        {wards.length === 0 && <p className="empty">No wards are within your scope.</p>}
        {absences.length === 0 ? (!loading && (
          <p className="empty">No absence requests.</p>
        )) : (
          <div className="table-wrap"><table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Kind</th>
                <th>Dates</th>
                <th>Returns</th>
                <th>Status</th>
                <th>Documents</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {absences.map((absence) => (
                <tr key={absence.id}>
                  <td>
                    {absence.employee.fullName}{" "}
                    <span className="muted-text">({absence.employee.employeeNumber})</span>
                  </td>
                  <td>{absence.kind.replace(/_/g, " ").toLowerCase()}</td>
                  <td>
                    {formatDate(absence.startDate)} → {formatDate(absence.endDate)}
                  </td>
                  <td>{formatDate(absence.returnDate)}</td>
                  <td>
                    <span className={`badge ${absence.status.toLowerCase()}`}>{absence.status}</span>
                    {absence.reviewNote && (
                      <span className="muted-text"> — {absence.reviewNote}</span>
                    )}
                  </td>
                  <td>
                    {absence.documents.filter((document) => document.sensitivity !== "MEDICAL" || can("MEDICAL_READ")).length === 0 ? (
                      <span className="muted-text">—</span>
                    ) : (
                      <div className="doc-list">
                        {absence.documents.filter((document) => document.sensitivity !== "MEDICAL" || can("MEDICAL_READ")).map((document) => (
                          <button
                            key={document.id}
                            className="link-btn"
                            type="button"
                            onClick={() => void onOpenDocument(document)}
                          >
                            {document.category.toLowerCase()}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="doc-actions">
                       {can("ABSENCE_MANAGE") && (absence.kind !== "SICK_OFF" || can("MEDICAL_READ")) && (
<DocumentUploadRow
                        absence={absence}
                        onUploaded={(file, category) => void onUploadDocument(absence, file, category)}
                        uploading={uploading}
                        uploadProgress={uploadProgress}
                      />
                      )}
                      {actionsFor(absence).map((item) => (
                        <button
                          key={item.action}
                          className="link-btn"
                          type="button"
                          onClick={() => setPendingAction({ absence, action: item.action })}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
      {!can("MEDICAL_READ") && absences.some((absence) => absence.documents.some((document) => document.sensitivity === "MEDICAL")) && (
        <p className="privacy-notice">Medical attachments are hidden because your account does not have medical-record access.</p>
      )}
      {can("MEDICAL_READ") && (
        <p className="privacy-notice">Medical documents are restricted records. Access is logged and should be limited to official duties.</p>
      )}
      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={`${pendingAction?.action ? pendingAction.action.charAt(0) + pendingAction.action.slice(1).toLowerCase() : "Update"} absence request?`}
        description={pendingAction ? `This will update the request for ${pendingAction.absence.employee.fullName}.` : ""}
        confirmLabel={pendingAction?.action ? pendingAction.action.charAt(0) + pendingAction.action.slice(1).toLowerCase() : "Confirm"}
        requireText={pendingAction?.action === "REJECT"}
        onCancel={() => setPendingAction(null)}
        onConfirm={(text) => pendingAction && void onAction(pendingAction.absence, pendingAction.action, text || undefined)}
      />
    </main>
  );
}

function DocumentUploadRow({
  absence,
  onUploaded,
  uploading,
  uploadProgress,
}: {
  absence: Absence;
  onUploaded: (file: File | null, category: string) => void;
  uploading: boolean;
  uploadProgress: number | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState(
    absence.kind === "SICK_OFF" ? "SICK_SHEET" : "OTHER",
  );
  return (
    <>
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        aria-label="Document category"
        disabled={uploading}
      >
        {DOCUMENT_CATEGORIES.filter((item) => absence.kind === "SICK_OFF" || !["SICK_SHEET", "MEDICAL_CERTIFICATE", "RETURN_TO_WORK"].includes(item)).map((item) => (
          <option key={item} value={item}>
            {item.toLowerCase()}
          </option>
        ))}
      </select>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="visually-hidden"
        disabled={uploading}
        onChange={(e) => onUploaded(e.target.files?.[0] ?? null, category)}
      />
      <button
        type="button"
        className="link-btn"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? (uploadProgress !== null ? `uploading ${uploadProgress}%` : "preparing...") : "Upload"}
      </button>
    </>
  );
}
