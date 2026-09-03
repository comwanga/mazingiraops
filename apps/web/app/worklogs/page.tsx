"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DashNav } from "@/components/DashNav";
import { StatusMessages } from "@/components/StatusMessages";
import { ApiError, CompletionStatus, Evidence, EvidenceStage, Ward, WorkLog, WorkLogAction, apiErrorMessage, createWorkLog, downloadEvidence, fetchMe, listEvidence, listWards, listWorkLogs, uploadEvidence, workLogAction } from "@/lib/api";
import { compressImage } from "@/lib/image";
import { buildDailyReportHref } from "@/lib/report-navigation";
import {
  EVIDENCE_MAX_PER_STAGE,
  addEvidenceFiles,
  createEvidenceFileSelection,
  evidenceUploadKey,
} from "@/lib/work-log-evidence";

const STAGES: EvidenceStage[] = ["BEFORE", "DURING", "AFTER"];
const STAGE_GUIDANCE: Record<EvidenceStage, { title: string; description: string }> = {
  BEFORE: { title: "Before work", description: "Show the site before the activity begins." },
  DURING: { title: "During work", description: "Capture the team and activity in progress." },
  AFTER: { title: "After work", description: "Show the completed work and final condition." },
};

interface SubmissionSuccess {
  activity: string;
  workDate: string;
  photoCount: number;
  reportHref: string;
}

function nairobiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function WorkLogsPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ capabilities: string[] } | null>(null);
  const [wards, setWards] = useState<Ward[]>([]);
  const [reviewLogs, setReviewLogs] = useState<WorkLog[]>([]);
  const [reviewEvidence, setReviewEvidence] = useState<Record<string, Evidence[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submissionSuccess, setSubmissionSuccess] = useState<SubmissionSuccess | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const submissionLocked = useRef(false);
  const submissionId = useRef<string | null>(null);
  const uploadedPhotoKeys = useRef(new Set<string>());
  const [pendingAction, setPendingAction] = useState<{ workLog: WorkLog; action: WorkLogAction } | null>(null);
  const [form, setForm] = useState({
    wardId: "",
    workDate: nairobiToday(),
    activity: "",
    location: "",
    staffCount: 0,
    challenges: "",
    suggestedSolutions: "",
    numberOfTrips: 0,
    wasteTransferInvolved: false,
    truckId: "",
    backhoeId: "",
    cleanupDone: false,
    cleanupStakeholders: "",
    climateTeamCount: 0,
    completionStatus: "COMPLETE" as CompletionStatus,
    outstandingWork: "",
    truthConfirmed: false,
  });
  const [evidenceFiles, setEvidenceFiles] = useState(createEvidenceFileSelection<File>);
  const [truckUsed, setTruckUsed] = useState(false);
  const [backhoeUsed, setBackhoeUsed] = useState(false);

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
      if (!current.capabilities.includes("WORK_READ")) {
        router.replace("/dashboard");
        return;
      }
      setMe(current);
      const accessible = await listWards();
      setWards(accessible);
      setForm((currentForm) => ({
        ...currentForm,
        wardId: currentForm.wardId || accessible[0]?.id || "",
      }));
      if (current.capabilities.includes("WORK_REVIEW")) {
        const submitted = await listWorkLogs({ status: "SUBMITTED" });
        setReviewLogs(submitted);
        const evidenceResults = await Promise.allSettled(
          submitted.map(async (workLog) => [workLog.id, await listEvidence(workLog.id)] as const),
        );
        setReviewEvidence(Object.fromEntries(
          evidenceResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
        ));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
      } else {
        setError(apiErrorMessage(err, "Unable to load work logs"));
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
    if (submissionLocked.current) return;
    submissionLocked.current = true;
    setError(null);
    setNotice(null);
    const selectedPhotos = STAGES.flatMap((stage) =>
      evidenceFiles[stage].map((file) => ({ stage, file })),
    );
    if (selectedPhotos.length === 0) {
      setError("Select at least one work photo from your gallery or camera.");
      submissionLocked.current = false;
      return;
    }
    setSubmitting(true);
    let draft: WorkLog | null = null;
    try {
      submissionId.current ??= crypto.randomUUID();
      draft = await createWorkLog({
        ...form,
        clientSubmissionId: submissionId.current,
        description: form.activity,
        areasRoads: form.location,
        numberOfTrips: form.wasteTransferInvolved ? form.numberOfTrips : 0,
        truckId: form.wasteTransferInvolved && truckUsed ? form.truckId : "",
        backhoeId: form.wasteTransferInvolved && backhoeUsed ? form.backhoeId : "",
        cleanupStakeholders: form.cleanupDone ? form.cleanupStakeholders : "",
        climateTeamCount: form.cleanupDone ? form.climateTeamCount : 0,
      });
      for (const { stage, file } of selectedPhotos) {
        const uploadKey = evidenceUploadKey(stage, file);
        if (uploadedPhotoKeys.current.has(uploadKey)) continue;
        setUploading(`${draft.id}:${stage}`);
        setUploadProgress(0);
        const prepared = await compressImage(file);
        await uploadEvidence(draft.id, prepared, stage, "", setUploadProgress);
        uploadedPhotoKeys.current.add(uploadKey);
      }
      const submitted = await workLogAction(draft.id, {
        action: "SUBMIT",
        expectedVersion: draft.version,
      });
      setNotice(`Work log submitted successfully. All ${selectedPhotos.length} photos were uploaded.`);
      setSubmissionSuccess({
        activity: submitted.activity,
        workDate: submitted.workDate,
        photoCount: uploadedPhotoKeys.current.size,
        reportHref: buildDailyReportHref(submitted.wardId, submitted.workDate),
      });
      setForm((current) => ({
        ...current,
        activity: "",
        location: "",
        staffCount: 0,
        challenges: "",
        suggestedSolutions: "",
        numberOfTrips: 0,
        wasteTransferInvolved: false,
        truckId: "",
        backhoeId: "",
        cleanupDone: false,
        cleanupStakeholders: "",
        climateTeamCount: 0,
        completionStatus: "COMPLETE",
        outstandingWork: "",
        truthConfirmed: false,
      }));
      setEvidenceFiles(createEvidenceFileSelection());
      setTruckUsed(false);
      setBackhoeUsed(false);
      submissionId.current = null;
      uploadedPhotoKeys.current.clear();
    } catch (err) {
      if (draft) {
        setNotice("The work log remains a draft. Resolve the photo error, then retry this submission.");
      }
      setError(apiErrorMessage(err, "Unable to create work log"));
    } finally {
      setUploading(null);
      setUploadProgress(null);
      setSubmitting(false);
      submissionLocked.current = false;
    }
  }

  function onSelectEvidenceFiles(stage: EvidenceStage, incoming: File[]) {
    setError(null);
    setEvidenceFiles((current) => {
      const result = addEvidenceFiles(current[stage], incoming);
      if (result.rejectedCount > 0) {
        setError(`Select up to ${EVIDENCE_MAX_PER_STAGE} unique ${stage.toLowerCase()} photos.`);
      }
      return { ...current, [stage]: result.files };
    });
  }

  function onRemoveEvidenceFile(stage: EvidenceStage, index: number) {
    setEvidenceFiles((current) => ({
      ...current,
      [stage]: current[stage].filter((_, fileIndex) => fileIndex !== index),
    }));
  }

  async function onOpenEvidence(evidence: Evidence) {
    setError(null);
    const viewer = window.open("about:blank", "_blank", "noopener,noreferrer");
    try {
      const blob = await downloadEvidence(evidence.id);
      const objectUrl = URL.createObjectURL(blob);
      if (viewer) viewer.location.href = objectUrl;
      else window.location.href = objectUrl;
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (err) {
      viewer?.close();
      setError(apiErrorMessage(err, "Unable to open photo"));
    }
  }

  async function onReviewAction(workLog: WorkLog, action: WorkLogAction, reviewNote?: string) {
    setError(null);
    setNotice(null);
    setPendingAction(null);
    try {
      await workLogAction(workLog.id, { action, expectedVersion: workLog.version, reviewNote });
      setReviewLogs((current) => current.filter((item) => item.id !== workLog.id));
      setNotice(`${workLog.activity} ${action === "APPROVE" ? "approved" : "rejected"}.`);
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to review work log"));
    }
  }

  return (
    <main className="dashboard" aria-busy={loading}>
      <header className="dash-header">
        <BrandLogo size={44} href="/dashboard" />
        <div className="dash-title">
          <p className="eyebrow">MAZINGIRA OPS · WORK OPERATIONS</p>
          <h1>Work logs</h1>
        </div>
        <DashNav />
      </header>

      <StatusMessages error={error} notice={notice} loading={loading ? "Loading work logs..." : null} />

      {submissionSuccess ? (
        <section className="panel worklog-success-panel" role="status" aria-live="polite">
          <div className="worklog-success-icon" aria-hidden="true">&#10003;</div>
          <p className="eyebrow">SUBMISSION COMPLETE</p>
          <h2>Work log submitted successfully</h2>
          <p>
            <strong>{submissionSuccess.activity}</strong> was submitted for {formatDate(submissionSuccess.workDate)}. All{" "}
            {submissionSuccess.photoCount} selected {submissionSuccess.photoCount === 1 ? "photo was" : "photos were"} uploaded.
          </p>
          <p className="muted-text">
            The daily report preview automatically includes this work entry and the day&apos;s staff attendance.
          </p>
          <div className="worklog-success-actions">
            <button type="button" onClick={() => router.push(submissionSuccess.reportHref)}>
              Generate daily report
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                setSubmissionSuccess(null);
                setNotice(null);
                setError(null);
              }}
            >
              Submit another work log
            </button>
          </div>
        </section>
      ) : can("WORK_CREATE") ? (
        <section className="panel">
          <h2>New work log</h2>
          <form className="grid-form worklog-form" onSubmit={onCreate}>
            <fieldset className="worklog-section">
              <legend><span className="worklog-step">1</span><span>Work details<small>Identify where, when, and what work was completed.</small></span></legend>
              <div className="worklog-fields">
                <label className="worklog-field">Ward<select value={form.wardId} onChange={(e) => setForm({ ...form, wardId: e.target.value })} required><option value="">Select ward…</option>{wards.map((ward) => <option key={ward.id} value={ward.id}>{ward.name} ({ward.code})</option>)}</select></label>
                <label className="worklog-field">Work date<input type="date" value={form.workDate} onChange={(e) => setForm({ ...form, workDate: e.target.value })} required /></label>
                <label className="worklog-field">Staff count<input type="number" min={0} value={form.staffCount} onChange={(e) => setForm({ ...form, staffCount: Number(e.target.value) })} /></label>
                <label className="worklog-field worklog-field-wide">Activity / description<input value={form.activity} onChange={(e) => setForm({ ...form, activity: e.target.value })} placeholder="e.g. Desilting drainage" required /></label>
                <label className="worklog-field worklog-field-wide">Location / areas or roads covered<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Makina Market area" required /></label>
              </div>
            </fieldset>

            <fieldset className="worklog-section">
              <legend><span className="worklog-step">2</span><span>Resources and completion<small>Record operational support, challenges, and remaining work.</small></span></legend>
              <div className="worklog-fields">
                <label className="worklog-field worklog-field-wide">Challenges<textarea value={form.challenges} onChange={(e) => setForm({ ...form, challenges: e.target.value })} rows={3} placeholder="What affected delivery, if anything?" /></label>
                <label className="worklog-field worklog-field-wide">Suggested solutions<textarea value={form.suggestedSolutions} onChange={(e) => setForm({ ...form, suggestedSolutions: e.target.value })} rows={3} placeholder="Recommended follow-up or support" /></label>
              </div>

              <div className="worklog-choice-grid">
                <label className="worklog-choice">
                  <input type="checkbox" checked={form.wasteTransferInvolved} onChange={(e) => {
                    const checked = e.target.checked;
                    setForm({ ...form, wasteTransferInvolved: checked, numberOfTrips: checked ? 1 : 0, truckId: checked ? form.truckId : "", backhoeId: checked ? form.backhoeId : "" });
                    if (!checked) { setTruckUsed(false); setBackhoeUsed(false); }
                  }} />
                  <span><strong>Waste transfer involved</strong><small>Record trips and equipment used.</small></span>
                </label>
                <label className="worklog-choice">
                  <input type="checkbox" checked={form.cleanupDone} onChange={(e) => setForm({ ...form, cleanupDone: e.target.checked, cleanupStakeholders: e.target.checked ? form.cleanupStakeholders : "", climateTeamCount: e.target.checked ? form.climateTeamCount : 0 })} />
                  <span><strong>Cleanup completed</strong><small>Record participating teams or stakeholders.</small></span>
                </label>
              </div>

              {form.wasteTransferInvolved && (
                <fieldset className="conditional-fields">
                  <legend>Waste transfer details</legend>
                  <label>Number of trips<select value={form.numberOfTrips} onChange={(e) => setForm({ ...form, numberOfTrips: Number(e.target.value) })}>{Array.from({ length: 20 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
                  <label className="inline-label"><input type="checkbox" checked={truckUsed} onChange={(e) => { setTruckUsed(e.target.checked); if (!e.target.checked) setForm({ ...form, truckId: "" }); }} />Truck used</label>
                  {truckUsed && <label>Truck ID<input value={form.truckId} onChange={(e) => setForm({ ...form, truckId: e.target.value })} placeholder="T-161" required /></label>}
                  <label className="inline-label"><input type="checkbox" checked={backhoeUsed} onChange={(e) => { setBackhoeUsed(e.target.checked); if (!e.target.checked) setForm({ ...form, backhoeId: "" }); }} />Backhoe used</label>
                  {backhoeUsed && <label>Backhoe ID<input value={form.backhoeId} onChange={(e) => setForm({ ...form, backhoeId: e.target.value })} placeholder="BH13" required /></label>}
                </fieldset>
              )}

              {form.cleanupDone && (
                <fieldset className="conditional-fields">
                  <legend>Cleanup details</legend>
                  <label>Cleanup stakeholders<input value={form.cleanupStakeholders} onChange={(e) => setForm({ ...form, cleanupStakeholders: e.target.value })} /></label>
                  <label>Climate Works team count<input type="number" min={0} value={form.climateTeamCount} onChange={(e) => setForm({ ...form, climateTeamCount: Number(e.target.value) })} /></label>
                </fieldset>
              )}

              <div className="worklog-fields worklog-completion">
                <label className="worklog-field">Completion status<select value={form.completionStatus} onChange={(e) => {
                  const completionStatus = e.target.value as CompletionStatus;
                  setForm({ ...form, completionStatus, outstandingWork: completionStatus === "COMPLETE" ? "" : form.outstandingWork });
                }}><option value="COMPLETE">Complete</option><option value="INCOMPLETE">Incomplete</option></select></label>
                {form.completionStatus === "INCOMPLETE" && <label className="worklog-field worklog-field-grow">Outstanding work<textarea value={form.outstandingWork} onChange={(e) => setForm({ ...form, outstandingWork: e.target.value })} rows={2} placeholder="Describe what remains and the next action required" required /></label>}
              </div>
            </fieldset>

            <fieldset className="worklog-section worklog-evidence-section">
              <legend><span className="worklog-step">3</span><span>Photo evidence<small>Add up to four JPEG or PNG photos at each stage.</small></span></legend>
              <p className="worklog-section-intro">Choose existing gallery photos or use your device camera. At least one photo across all stages is required.</p>
              <div className="worklog-evidence-grid">
                {STAGES.map((stage) => {
                  const files = evidenceFiles[stage];
                  const guidance = STAGE_GUIDANCE[stage];
                  return (
                    <section className="evidence-stage-card" key={stage} aria-labelledby={`evidence-${stage.toLowerCase()}`}>
                      <div className="evidence-stage-heading"><div><strong id={`evidence-${stage.toLowerCase()}`}>{guidance.title}</strong><p>{guidance.description}</p></div><span>{files.length}/{EVIDENCE_MAX_PER_STAGE}</span></div>
                      <label className={`evidence-picker ${files.length >= EVIDENCE_MAX_PER_STAGE ? "disabled" : ""}`}>
                        {files.length === 0 ? "Choose photos" : "Add more photos"}
                        <input className="visually-hidden" type="file" accept="image/jpeg,image/png" multiple disabled={files.length >= EVIDENCE_MAX_PER_STAGE} onChange={(e) => { onSelectEvidenceFiles(stage, Array.from(e.target.files ?? [])); e.target.value = ""; }} />
                      </label>
                      {files.length === 0 ? <p className="evidence-empty">No photos selected</p> : <ul className="evidence-file-list">{files.map((file, index) => <li key={`${file.name}:${file.size}:${file.lastModified}`}><span title={file.name}>{file.name}</span><button type="button" className="evidence-file-remove" onClick={() => onRemoveEvidenceFile(stage, index)} aria-label={`Remove ${file.name}`}>Remove</button></li>)}</ul>}
                    </section>
                  );
                })}
              </div>
              {uploading && uploadProgress !== null && <p className="upload-progress" role="status">Uploading photos: {uploadProgress}%</p>}
            </fieldset>

            <div className="worklog-submit-bar">
              <label className="worklog-confirm"><input type="checkbox" checked={form.truthConfirmed} onChange={(e) => setForm({ ...form, truthConfirmed: e.target.checked })} required /><span>I confirm that this work-log information and its photos are true and accurate.</span></label>
              <button type="submit" disabled={submitting}>{submitting ? "Uploading photos and submitting..." : "Submit work log"}</button>
            </div>
          </form>
        </section>
      ) : null}

      {can("WORK_REVIEW") && (
        <section className="panel">
          <h2>Submitted work awaiting review</h2>
          <p className="muted-text">Only submitted work within your assigned scope appears here.</p>
          {reviewLogs.length === 0 ? (!loading && <p className="empty">No work logs are awaiting review.</p>) : (
            <div className="table-wrap"><table className="data-table">
              <thead><tr><th>Date</th><th>Activity</th><th>Location</th><th>Completion</th><th>Evidence</th><th></th></tr></thead>
              <tbody>{reviewLogs.map((workLog) => (
                <tr key={workLog.id}>
                  <td>{formatDate(workLog.workDate)}</td>
                  <td>{workLog.activity}</td>
                  <td>{workLog.location}</td>
                  <td>{workLog.detail.completionStatus === "INCOMPLETE" ? `Incomplete — ${workLog.detail.outstandingWork}` : "Complete"}</td>
                  <td><ReviewEvidence evidence={reviewEvidence[workLog.id] ?? []} onOpen={onOpenEvidence} /></td>
                  <td><div className="doc-actions">
                    <button type="button" className="link-btn" onClick={() => setPendingAction({ workLog, action: "APPROVE" })}>Approve</button>
                    <button type="button" className="link-btn" onClick={() => setPendingAction({ workLog, action: "REJECT" })}>Reject</button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      )}

      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={`${pendingAction?.action === "APPROVE" ? "Approve" : "Reject"} work log?`}
        description={pendingAction ? `${pendingAction.workLog.activity} at ${pendingAction.workLog.location} will move to a terminal review state.` : ""}
        confirmLabel={pendingAction?.action === "APPROVE" ? "Approve" : "Reject"}
        requireText={pendingAction?.action === "REJECT"}
        onCancel={() => setPendingAction(null)}
        onConfirm={(text) => pendingAction && void onReviewAction(pendingAction.workLog, pendingAction.action, text || undefined)}
      />
    </main>
  );
}

function ReviewEvidence({ evidence, onOpen }: { evidence: Evidence[]; onOpen: (item: Evidence) => void }) {
  return (
    <div className="doc-list">
      {STAGES.map((stage) => {
        const items = evidence.filter((item) => item.stage === stage);
        return items.length > 0 && (
          <span key={stage} className="doc-stage">
            <strong>{stage.toLowerCase()}</strong> ({items.length})
            {items.map((item, index) => (
              <button key={item.id} type="button" className="link-btn" onClick={() => onOpen(item)}>
                view {index + 1}
              </button>
            ))}
          </span>
        );
      })}
    </div>
  );
}
