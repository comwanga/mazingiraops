"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DashNav } from "@/components/DashNav";
import { StatusMessages } from "@/components/StatusMessages";
import { ApiError, CompletionStatus, Evidence, EvidenceStage, Ward, WorkLog, WorkLogAction, apiErrorMessage, createWorkLog, downloadEvidence, fetchMe, listEvidence, listWards, listWorkLogs, uploadEvidence, workLogAction } from "@/lib/api";
import { compressImage } from "@/lib/image";

const STAGES: EvidenceStage[] = ["BEFORE", "DURING", "AFTER"];

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
  const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
  const [wards, setWards] = useState<Ward[]>([]);
  const [evidenceByWorkLog, setEvidenceByWorkLog] = useState<Record<string, Evidence[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
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
  const [evidenceFiles, setEvidenceFiles] = useState<Partial<Record<EvidenceStage, File>>>({});
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
      const logs = await listWorkLogs();
      setWorkLogs(logs);
      const evidenceResults = await Promise.allSettled(
        logs.map(async (log) => [log.id, await listEvidence(log.id)] as const),
      );
      setEvidenceByWorkLog(
        Object.fromEntries(
          evidenceResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
        ),
      );
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

  async function loadEvidenceFor(workLogId: string) {
    try {
      const items = await listEvidence(workLogId);
      setEvidenceByWorkLog((current) => ({ ...current, [workLogId]: items }));
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to load evidence"));
    }
  }

  async function onUploadEvidence(workLog: WorkLog, file: File | null, stage: EvidenceStage) {
    if (!file) return;
    setError(null);
    setNotice(null);
    setUploading(`${workLog.id}:${stage}`);
    setUploadProgress(0);
    try {
      const prepared = await compressImage(file);
      await uploadEvidence(
        workLog.id,
        prepared,
        stage,
        "",
        setUploadProgress,
      );
      setUploading(null);
      setUploadProgress(null);
      setNotice(`${stage.toLowerCase()} photo uploaded.`);
      await loadEvidenceFor(workLog.id);
    } catch (err) {
      setUploading(null);
      setUploadProgress(null);
      setError(apiErrorMessage(err, "Unable to upload photo"));
    }
  }

  async function onOpenEvidence(evidence: Evidence) {
    setError(null);
    try {
      const blob = await downloadEvidence(evidence.id);
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to open photo"));
    }
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const selectedPhotos = STAGES.flatMap((stage) => {
      const file = evidenceFiles[stage];
      return file ? [{ stage, file }] : [];
    });
    if (selectedPhotos.length === 0) {
      setError("Select at least one work photo from your gallery or camera.");
      return;
    }
    setSubmitting(true);
    let draft: WorkLog | null = null;
    try {
      draft = await createWorkLog({
        ...form,
        description: form.activity,
        areasRoads: form.location,
        numberOfTrips: form.wasteTransferInvolved ? form.numberOfTrips : 0,
        truckId: form.wasteTransferInvolved && truckUsed ? form.truckId : "",
        backhoeId: form.wasteTransferInvolved && backhoeUsed ? form.backhoeId : "",
        cleanupStakeholders: form.cleanupDone ? form.cleanupStakeholders : "",
        climateTeamCount: form.cleanupDone ? form.climateTeamCount : 0,
      });
      for (const { stage, file } of selectedPhotos) {
        setUploading(`${draft.id}:${stage}`);
        setUploadProgress(0);
        const prepared = await compressImage(file);
        await uploadEvidence(draft.id, prepared, stage, "", setUploadProgress);
      }
      const submitted = await workLogAction(draft.id, {
        action: "SUBMIT",
        expectedVersion: draft.version,
      });
      setNotice(`Submitted ${submitted.activity} for ${formatDate(submitted.workDate)}.`);
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
      setEvidenceFiles({});
      setTruckUsed(false);
      setBackhoeUsed(false);
      setWorkLogs(await listWorkLogs());
    } catch (err) {
      if (draft) {
        setNotice("The work log remains a draft. Resolve the photo error, then submit it below.");
        setWorkLogs(await listWorkLogs().catch(() => workLogs));
      }
      setError(apiErrorMessage(err, "Unable to create work log"));
    } finally {
      setUploading(null);
      setUploadProgress(null);
      setSubmitting(false);
    }
  }

  async function onAction(workLog: WorkLog, action: WorkLogAction, reviewNote?: string) {
    setError(null);
    setNotice(null);
    setPendingAction(null);
    try {
      await workLogAction(workLog.id, { action, expectedVersion: workLog.version, reviewNote });
      const verb = action === "SUBMIT" ? "submitted" : action === "APPROVE" ? "approved" : "rejected";
      setNotice(`${workLog.activity} ${verb}.`);
      setWorkLogs(await listWorkLogs());
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to update work log"));
    }
  }

  const actionsFor = (workLog: WorkLog) => {
    const actions: Array<{ action: WorkLogAction; label: string; capability: string }> = [];
    if (workLog.status === "DRAFT") {
      actions.push({ action: "SUBMIT", label: "Submit", capability: "WORK_CREATE" });
    }
    if (workLog.status === "SUBMITTED") {
      actions.push({ action: "APPROVE", label: "Approve", capability: "WORK_REVIEW" });
      actions.push({ action: "REJECT", label: "Reject", capability: "WORK_REVIEW" });
    }
    return actions.filter((item) => can(item.capability));
  };

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

      {can("WORK_CREATE") && (
        <section className="panel">
          <h2>New work log</h2>
          <form className="grid-form" onSubmit={onCreate}>
            <label>
              Ward
              <select
                value={form.wardId}
                onChange={(e) => setForm({ ...form, wardId: e.target.value })}
                required
              >
                <option value="">Select ward…</option>
                {wards.map((ward) => (
                  <option key={ward.id} value={ward.id}>
                    {ward.name} ({ward.code})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Work date
              <input
                type="date"
                value={form.workDate}
                onChange={(e) => setForm({ ...form, workDate: e.target.value })}
                required
              />
            </label>
            <label>
              Activity / description
              <input
                value={form.activity}
                onChange={(e) => setForm({ ...form, activity: e.target.value })}
                placeholder="e.g. desilting drainage"
                required
              />
            </label>
            <label>
              Location / areas or roads covered
              <input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="e.g. Makina Market area"
                required
              />
            </label>
            <label>
              Staff count
              <input
                type="number"
                min={0}
                value={form.staffCount}
                onChange={(e) =>
                  setForm({ ...form, staffCount: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Challenges
              <textarea
                value={form.challenges}
                onChange={(e) => setForm({ ...form, challenges: e.target.value })}
                rows={2}
              />
            </label>
            <label>
              Suggested solutions to challenges
              <textarea
                value={form.suggestedSolutions}
                onChange={(e) => setForm({ ...form, suggestedSolutions: e.target.value })}
                rows={2}
              />
            </label>
            <label className="inline-label">
              <input
                type="checkbox"
                checked={form.wasteTransferInvolved}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setForm({ ...form, wasteTransferInvolved: checked, numberOfTrips: checked ? 1 : 0, truckId: checked ? form.truckId : "", backhoeId: checked ? form.backhoeId : "" });
                  if (!checked) {
                    setTruckUsed(false);
                    setBackhoeUsed(false);
                  }
                }}
              />
              Waste transfer involved
            </label>
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
            <label className="inline-label">
              <input
                type="checkbox"
                checked={form.cleanupDone}
                onChange={(e) => setForm({ ...form, cleanupDone: e.target.checked, cleanupStakeholders: e.target.checked ? form.cleanupStakeholders : "", climateTeamCount: e.target.checked ? form.climateTeamCount : 0 })}
              />
              Cleanup done
            </label>
            {form.cleanupDone && (
              <fieldset className="conditional-fields">
                <legend>Cleanup details</legend>
                <label>Cleanup stakeholders<input value={form.cleanupStakeholders} onChange={(e) => setForm({ ...form, cleanupStakeholders: e.target.value })} /></label>
                <label>Climate Works team count<input type="number" min={0} value={form.climateTeamCount} onChange={(e) => setForm({ ...form, climateTeamCount: Number(e.target.value) })} /></label>
              </fieldset>
            )}
            <label>
              Completion
              <select
                value={form.completionStatus}
                onChange={(e) =>
                  setForm({
                    ...form,
                    completionStatus: e.target.value as CompletionStatus,
                  })
                }
              >
                <option value="COMPLETE">Complete</option>
                <option value="INCOMPLETE">Incomplete</option>
              </select>
            </label>
            <label>
              Outstanding work
              <textarea
                value={form.outstandingWork}
                onChange={(e) => setForm({ ...form, outstandingWork: e.target.value })}
                rows={2}
                placeholder="Describe outstanding work if incomplete"
              />
            </label>
            <fieldset className="conditional-fields">
              <legend>Photo evidence before submission</legend>
              <p className="muted-text">Choose an existing gallery photo or use your device camera. At least one photo is required.</p>
              {STAGES.map((stage) => (
                <label key={stage}>{stage.toLowerCase()} photo<input type="file" accept="image/jpeg,image/png" onChange={(e) => { const file = e.target.files?.[0]; setEvidenceFiles((current) => ({ ...current, [stage]: file })); }} />{evidenceFiles[stage] && <span className="muted-text">{evidenceFiles[stage]?.name}</span>}</label>
              ))}
              {uploading && uploadProgress !== null && <p className="muted-text">Uploading photo: {uploadProgress}%</p>}
            </fieldset>
            <label className="inline-label">
              <input type="checkbox" checked={form.truthConfirmed} onChange={(e) => setForm({ ...form, truthConfirmed: e.target.checked })} required />
              I confirm that this work-log information and its photos are true and accurate.
            </label>
            <button type="submit" disabled={submitting}>
            {submitting ? "Uploading photos and submitting..." : "Submit work log"}
            </button>
          </form>
        </section>
      )}

      <section className="panel">
        <h2>Work logs</h2>
        {workLogs.length === 0 ? (!loading && (
          <p className="empty">No work logs recorded.</p>
        )) : (
          <div className="table-wrap"><table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Activity</th>
                <th>Location</th>
                <th>Status</th>
                <th>Completion</th>
                <th>Evidence</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {workLogs.map((workLog) => (
                <tr key={workLog.id}>
                  <td>{formatDate(workLog.workDate)}</td>
                  <td>
                    {workLog.activity}
                    <span className="muted-text"> — {workLog.description}</span>
                  </td>
                  <td>{workLog.location}</td>
                  <td>
                    <span className={`badge ${workLog.status.toLowerCase()}`}>
                      {workLog.status}
                    </span>
                    {workLog.reviewNote && (
                      <span className="muted-text"> — {workLog.reviewNote}</span>
                    )}
                  </td>
                  <td>
                    {workLog.detail.completionStatus === "INCOMPLETE"
                      ? `Incomplete — ${workLog.detail.outstandingWork}`
                      : "Complete"}
                  </td>
                  <td>
                    {can("WORK_READ") && (
                      <EvidenceCell
                        evidence={evidenceByWorkLog[workLog.id] ?? []}
                        canUpload={can("WORK_CREATE") && workLog.status === "DRAFT"}
                        onOpen={onOpenEvidence}
                        onUploaded={(file, stage) => void onUploadEvidence(workLog, file, stage)}
                        uploadingStage={uploading?.startsWith(`${workLog.id}:`) ? uploading.split(":")[1] : null}
                        uploadProgress={uploadProgress}
                      />
                    )}
                  </td>
                  <td>
                    <div className="doc-actions">
                      {actionsFor(workLog).map((item) => (
                        <button
                          key={item.action}
                          className="link-btn"
                          type="button"
                          onClick={() => item.action === "SUBMIT" ? void onAction(workLog, item.action) : setPendingAction({ workLog, action: item.action })}
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
      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={`${pendingAction?.action === "APPROVE" ? "Approve" : "Reject"} work log?`}
        description={pendingAction ? `${pendingAction.workLog.activity} at ${pendingAction.workLog.location} will move to a terminal review state.` : ""}
        confirmLabel={pendingAction?.action === "APPROVE" ? "Approve" : "Reject"}
        requireText={pendingAction?.action === "REJECT"}
        onCancel={() => setPendingAction(null)}
        onConfirm={(text) => pendingAction && void onAction(pendingAction.workLog, pendingAction.action, text || undefined)}
      />
    </main>
  );
}

function EvidenceCell({
  evidence,
  canUpload,
  onOpen,
  onUploaded,
  uploadingStage,
  uploadProgress,
}: {
  evidence: Evidence[];
  canUpload: boolean;
  onOpen: (evidence: Evidence) => void;
  onUploaded: (file: File | null, stage: EvidenceStage) => void;
  uploadingStage: string | null;
  uploadProgress: number | null;
}) {
  return (
    <div className="doc-list">
      {STAGES.map((stage) => {
        const items = evidence.filter((item) => item.stage === stage);
        return (
          <span key={stage} className="doc-stage">
            <strong>{stage.toLowerCase()}</strong> ({items.length})
            {items.map((item) => (
              <button
                key={item.id}
                className="link-btn"
                type="button"
                onClick={() => onOpen(item)}
              >
                view
              </button>
            ))}
            {canUpload && (
              <label className="link-btn">
                {uploadingStage === stage
                  ? uploadProgress !== null
                    ? `uploading ${uploadProgress}%`
                    : "preparing..."
                  : "+ upload"}
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  className="visually-hidden"
                  disabled={uploadingStage !== null}
                  onChange={(e) => onUploaded(e.target.files?.[0] ?? null, stage)}
                />
              </label>
            )}
          </span>
        );
      })}
    </div>
  );
}
