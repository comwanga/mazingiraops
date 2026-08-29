"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { DashNav } from "@/components/DashNav";
import { QrCode } from "@/components/QrCode";
import { StatusMessages } from "@/components/StatusMessages";
import {
  ApiError,
  AttendanceRecord,
  AttendanceSession,
  RosterRow,
  Ward,
  apiErrorMessage,
  closeAttendanceSession,
  correctAttendance,
  createSession,
  fetchMe,
  fetchRoster,
  listAttendance,
  listSessions,
  listWards,
  manualAttendance,
} from "@/lib/api";

const DURATIONS = [30, 60, 120, 240, 480];
const MANUAL_STATUSES = ["PRESENT", "ABSENT", "OFF_DUTY", "SICK_OFF"];

function nairobiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Nairobi",
  });
}

function remainingTime(closesAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((Date.parse(closesAt) - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours ? `${hours}:` : ""}${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export default function AttendancePage() {
  const router = useRouter();
  const [canManage, setCanManage] = useState(false);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [wards, setWards] = useState<Ward[]>([]);
  const [qrSession, setQrSession] = useState<AttendanceSession | null>(null);
  const [manualEmployee, setManualEmployee] = useState<RosterRow | null>(null);
  const [correctionRecord, setCorrectionRecord] = useState<AttendanceRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ wardId: "", activity: "Cleaning", location: "", durationMinutes: 120 });
  const [rosterDate, setRosterDate] = useState(nairobiToday());
  const [history, setHistory] = useState({ wardId: "", workDate: "" });
  const [manualForm, setManualForm] = useState({ status: "PRESENT", reason: "" });
  const [correctionForm, setCorrectionForm] = useState({ status: "PRESENT", reason: "" });

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
      if (!me.capabilities.includes("ATTENDANCE_READ")) {
        router.replace("/dashboard");
        return;
      }
      const manageable = me.capabilities.includes("ATTENDANCE_MANAGE");
      setCanManage(manageable);
      const [sessionList, recordList, accessible] = await Promise.all([
        listSessions(),
        listAttendance(),
        listWards(),
      ]);
      setSessions(sessionList);
      setRecords(recordList);
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
      else setError(apiErrorMessage(caught, "Unable to load attendance"));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreateSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const session = await createSession(form);
      setNotice("Attendance session opened. Share the QR code with staff at the location.");
      setQrSession({
        ...session,
        ward: session.ward ?? wards.find((ward) => ward.id === session.wardId) ?? {
          id: session.wardId,
          code: "WARD",
          name: "Selected ward",
        },
      });
      setForm((current) => ({ ...current, location: "" }));
      setSessions(await listSessions());
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to open session"));
    } finally {
      setSubmitting(false);
    }
  }

  async function loadRoster(wardId: string, workDate = rosterDate) {
    setForm((current) => ({ ...current, wardId }));
    setRosterDate(workDate);
    setManualEmployee(null);
    setError(null);
    if (!wardId) {
      setRoster(null);
      return;
    }
    try {
      setRoster(await fetchRoster(wardId, workDate));
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to load roster"));
    }
  }

  async function onManualAttendance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manualEmployee) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      if (!manualEmployee.sessionId) {
        setError("Open an attendance session for this ward and date before recording manual attendance.");
        return;
      }
      await manualAttendance({
        sessionId: manualEmployee.sessionId,
        employeeId: manualEmployee.employee.id,
        workDate: rosterDate,
        status: manualForm.status,
        reason: manualForm.reason,
      });
      setNotice(`Recorded ${manualForm.status.replace(/_/g, " ").toLowerCase()} for ${manualEmployee.employee.fullName}.`);
      setManualEmployee(null);
      setManualForm({ status: "PRESENT", reason: "" });
      setRoster(await fetchRoster(form.wardId, rosterDate));
      setRecords(await listAttendance(history));
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to record attendance"));
    } finally {
      setSubmitting(false);
    }
  }

  async function onCloseSession(session: AttendanceSession) {
    setError(null);
    try {
      await closeAttendanceSession(session.id);
      setQrSession(null);
      setNotice(`${session.activity} attendance session closed.`);
      setSessions(await listSessions());
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to close attendance session"));
    }
  }

  async function onFilterHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      setRecords(await listAttendance({
        wardId: history.wardId || undefined,
        workDate: history.workDate || undefined,
      }));
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to load attendance history"));
    }
  }

  async function onCorrectAttendance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!correctionRecord) return;
    setSubmitting(true);
    setError(null);
    try {
      await correctAttendance(correctionRecord.id, {
        sessionId: correctionRecord.sessionId,
        status: correctionForm.status,
        reason: correctionForm.reason,
      });
      setNotice(`Corrected attendance for ${correctionRecord.fullName}.`);
      setCorrectionRecord(null);
      setCorrectionForm({ status: "PRESENT", reason: "" });
      setRecords(await listAttendance({ wardId: history.wardId || undefined, workDate: history.workDate || undefined }));
      if (form.wardId) setRoster(await fetchRoster(form.wardId, rosterDate));
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to correct attendance"));
    } finally {
      setSubmitting(false);
    }
  }

  const checkInUrl = (session: AttendanceSession) =>
    `${window.location.origin}/check-in/${session.token}`;

  return (
    <main className="dashboard" aria-busy={loading}>
      <header className="dash-header">
        <BrandLogo size={44} href="/dashboard" />
        <div className="dash-title"><p className="eyebrow">MAZINGIRA OPS · ATTENDANCE</p><h1>Attendance</h1></div>
        <DashNav />
      </header>

      <StatusMessages error={error} notice={notice} loading={loading ? "Loading attendance..." : null} />

      {canManage && (
        <section className="panel">
          <h2>Open an attendance session</h2>
          <form className="grid-form" onSubmit={onCreateSession}>
            <label>Ward<select value={form.wardId} onChange={(event) => setForm({ ...form, wardId: event.target.value })} required><option value="">Select ward...</option>{wards.map((ward) => <option key={ward.id} value={ward.id}>{ward.name} ({ward.code})</option>)}</select></label>
            <label>Activity<select value={form.activity} onChange={(event) => setForm({ ...form, activity: event.target.value })}><option>Cleaning</option><option>Sweeping</option><option>Drainage</option><option>Garbage collection</option><option>Other</option></select></label>
            <label>Location<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="e.g. Makina Ward Office" required /></label>
            <label>Duration (minutes)<select value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: Number(event.target.value) })}>{DURATIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes}</option>)}</select></label>
            <button type="submit" disabled={submitting}>{submitting ? "Opening..." : "Open session"}</button>
          </form>
        </section>
      )}

      <section className="panel">
        <h2>Attendance sessions</h2>
        {sessions.length === 0 ? (!loading && <p className="empty">No sessions have been opened.</p>) : (
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Ward</th><th>Activity</th><th>Location</th><th>Opens</th><th>Closes</th>{canManage && <th>Check-in</th>}</tr></thead><tbody>{sessions.map((session) => (
            <tr key={session.id}><td>{session.ward.code}</td><td>{session.activity}</td><td>{session.location}</td><td>{formatTime(session.opensAt)}</td><td>{formatTime(session.closesAt)}</td>{canManage && <td>{session.token ? <button type="button" className="link-btn" onClick={() => setQrSession(session)}>{Date.parse(session.closesAt) > Date.now() ? "Show QR" : "View"}</button> : <span className="muted-text">Unavailable</span>}</td>}</tr>
          ))}</tbody></table></div>
        )}
      </section>

      <section className="panel">
        <h2>Daily roster</h2>
        <div className="filter-row">
          <label>Ward<select value={form.wardId} onChange={(event) => void loadRoster(event.target.value)}><option value="">Select ward...</option>{wards.map((ward) => <option key={ward.id} value={ward.id}>{ward.name} ({ward.code})</option>)}</select></label>
          <label>Date<input type="date" value={rosterDate} onChange={(event) => void loadRoster(form.wardId, event.target.value)} /></label>
          <button type="button" className="secondary-btn" disabled={!form.wardId} onClick={() => void loadRoster(form.wardId)}>Refresh roster</button>
        </div>
        {!roster && <p className="empty">Select a ward to view its roster.</p>}
        {roster && roster.length === 0 && <p className="empty">No active staff are assigned to this ward.</p>}
        {roster && roster.length > 0 && <div className="table-wrap"><table className="data-table"><thead><tr><th>Number</th><th>Name</th><th>Status</th><th>Detail</th>{canManage && <th>Action</th>}</tr></thead><tbody>{roster.map((row) => <tr key={row.employee.id}><td>{row.employee.employeeNumber}</td><td>{row.employee.fullName}</td><td><span className={`badge ${row.status.toLowerCase()}`}>{row.status.replace(/_/g, " ")}</span></td><td>{row.detail}</td>{canManage && <td>{row.manualEditable ? <button type="button" className="link-btn" onClick={() => setManualEmployee(row)}>Record manually</button> : <span className="muted-text">Recorded</span>}</td>}</tr>)}</tbody></table></div>}

        {manualEmployee && <form className="manual-form" onSubmit={onManualAttendance} aria-labelledby="manual-title"><div><h3 id="manual-title">Manual attendance for {manualEmployee.employee.fullName}</h3><p className="muted-text">Use only when a staff member could not use the QR check-in.</p></div><label>Status<select value={manualForm.status} onChange={(event) => setManualForm({ ...manualForm, status: event.target.value })}>{MANUAL_STATUSES.map((status) => <option key={status} value={status}>{status.replace(/_/g, " ").toLowerCase()}</option>)}</select></label><label>Reason<input value={manualForm.reason} minLength={5} onChange={(event) => setManualForm({ ...manualForm, reason: event.target.value })} required /></label><div className="dialog-actions"><button type="button" className="secondary-btn" onClick={() => setManualEmployee(null)}>Cancel</button><button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Record attendance"}</button></div></form>}
      </section>

      <section className="panel">
        <h2>Attendance history</h2>
        <form className="filter-row" onSubmit={onFilterHistory}><label>Ward<select value={history.wardId} onChange={(event) => setHistory({ ...history, wardId: event.target.value })}><option value="">All accessible wards</option>{wards.map((ward) => <option key={ward.id} value={ward.id}>{ward.name} ({ward.code})</option>)}</select></label><label>Date<input type="date" value={history.workDate} onChange={(event) => setHistory({ ...history, workDate: event.target.value })} /></label><button type="submit" className="secondary-btn">Apply filters</button></form>
        {records.length === 0 ? (!loading && <p className="empty">No attendance records match these filters.</p>) : <div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Employee</th><th>Activity</th><th>Status</th><th>Checked at</th><th>Method</th>{canManage && <th>Action</th>}</tr></thead><tbody>{records.map((record) => <tr key={record.id}><td>{record.workDate.slice(0, 10)}</td><td>{record.fullName} <span className="muted-text">({record.employeeNumber})</span></td><td>{record.sessionActivity}</td><td><span className={`badge ${record.status.toLowerCase()}`}>{record.status.replace(/_/g, " ")}</span></td><td>{formatTime(record.checkedAt)}</td><td>{record.verificationMethod.toLowerCase()}</td>{canManage && <td><button type="button" className="link-btn" onClick={() => { setCorrectionRecord(record); setCorrectionForm({ status: record.status, reason: "" }); }}>Correct</button></td>}</tr>)}</tbody></table></div>}
        {correctionRecord && <form className="manual-form" onSubmit={onCorrectAttendance} aria-labelledby="correction-title"><div><h3 id="correction-title">Correct {correctionRecord.fullName}&apos;s record</h3><p className="muted-text">The original value remains in the audit history.</p></div><label>Status<select value={correctionForm.status} onChange={(event) => setCorrectionForm({ ...correctionForm, status: event.target.value })}>{[...MANUAL_STATUSES, "LATE"].map((status) => <option key={status} value={status}>{status.replace(/_/g, " ").toLowerCase()}</option>)}</select></label><label>Correction reason<input value={correctionForm.reason} minLength={5} maxLength={2000} onChange={(event) => setCorrectionForm({ ...correctionForm, reason: event.target.value })} required /></label><div className="dialog-actions"><button type="button" className="secondary-btn" onClick={() => setCorrectionRecord(null)}>Cancel</button><button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save correction"}</button></div></form>}
      </section>

      {qrSession?.token && <AttendanceQrDialog session={qrSession} url={checkInUrl(qrSession)} onClose={() => setQrSession(null)} onCloseSession={onCloseSession} onNotice={setNotice} />}
    </main>
  );
}

function AttendanceQrDialog({ session, url, onClose, onCloseSession, onNotice }: { session: AttendanceSession; url: string; onClose: () => void; onCloseSession: (session: AttendanceSession) => Promise<void>; onNotice: (message: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [now, setNow] = useState(Date.now());
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      onNotice("Check-in link copied.");
    } catch {
      onNotice("Copy is unavailable in this browser. Select the link below instead.");
    }
  }

  const expired = Date.parse(session.closesAt) <= now;
  return (
    <dialog ref={ref} className="app-dialog qr-dialog" aria-labelledby="qr-title" onCancel={onClose} onClose={onClose}>
      <div className="qr-print-area">
        <p className="eyebrow">MAZINGIRA OPS · ATTENDANCE</p>
        <h2 id="qr-title">{session.activity}</h2>
        <p>{session.ward.name} · {session.location}</p>
        <QrCode value={url} />
        <p className={`countdown ${expired ? "expired" : ""}`} role="timer" aria-live="off">{expired ? "Session closed" : `Closes in ${remainingTime(session.closesAt, now)}`}</p>
        <input className="qr-url" value={url} readOnly aria-label="Check-in link" onFocus={(event) => event.currentTarget.select()} />
      </div>
      {confirmClose ? (
        <div className="close-confirm no-print" role="alertdialog" aria-label="Confirm session close"><p>Stop accepting check-ins now?</p><div className="dialog-actions"><button type="button" className="secondary-btn" onClick={() => setConfirmClose(false)}>Keep open</button><button type="button" className="danger-btn" onClick={() => void onCloseSession(session)}>Close session</button></div></div>
      ) : (
        <div className="dialog-actions no-print"><button type="button" className="secondary-btn" onClick={() => void copyLink()}>Copy link</button><button type="button" className="secondary-btn" onClick={() => window.print()}>Print</button>{!expired && <button type="button" className="danger-btn" onClick={() => setConfirmClose(true)}>Close session</button>}<button type="button" onClick={onClose}>Close window</button></div>
      )}
    </dialog>
  );
}
