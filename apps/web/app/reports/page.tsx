"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { DashNav } from "@/components/DashNav";
import { StatusMessages } from "@/components/StatusMessages";
import {
  ApiError,
  AuthUser,
  apiErrorMessage,
  OrganisationCounty,
  Report,
  ReportKind,
  ReportPreview,
  ReportScopeType,
  ReportSummary,
  downloadReportEvidence,
  downloadReportCsv,
  draftReportNarrative,
  fetchMe,
  fetchOrganisationTree,
  fetchReport,
  finalizeReport,
  listReportsPage,
  previewReport,
} from "@/lib/api";

const KINDS: ReportKind[] = ["DAILY", "WEEKLY", "MONTHLY", "CUSTOM"];

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

export default function ReportsPage() {
  const router = useRouter();
  const [me, setMe] = useState<(AuthUser & { capabilities: string[] }) | null>(null);
  const [scopes, setScopes] = useState<ScopeOption[]>([]);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [reportPage, setReportPage] = useState(1);
  const [reportTotal, setReportTotal] = useState(0);
  const [selected, setSelected] = useState<Report | null>(null);
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    scopeId: "",
    startDate: nairobiToday(),
    endDate: nairobiToday(),
    kind: "DAILY" as ReportKind,
    narrative: "",
    recommendations: "",
  });

  const can = (capability: string) => me?.capabilities.includes(capability) ?? false;
  const canExport = can("REPORTS_EXPORT");

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
      if (!current.capabilities.includes("REPORTS_READ")) {
        router.replace("/dashboard");
        return;
      }
      const counties = await fetchOrganisationTree();
      const options = flattenScopes(counties);
      setScopes(options);
      setForm((currentForm) => ({
        ...currentForm,
        scopeId: currentForm.scopeId || options[0]?.scopeId || "",
      }));
      const archive = await listReportsPage({ page: reportPage, pageSize: 25 });
      setReports(archive.items);
      setReportTotal(archive.total);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
      } else {
        setError(apiErrorMessage(err, "Unable to load reports"));
      }
    } finally {
      setLoading(false);
    }
  }, [reportPage, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const scopeOption = scopes.find((option) => option.scopeId === form.scopeId);
  const periodInput = {
    scopeType: (scopeOption?.scopeType ?? "WARD") as ReportScopeType,
    scopeId: form.scopeId,
    startDate: form.startDate,
    endDate: form.endDate,
    kind: form.kind,
  };

  async function onPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const result = await previewReport(periodInput);
      setSelected(null);
      setPreview(result);
      setForm((current) => ({
        ...current,
        narrative: result.narrative,
        recommendations: result.recommendations,
      }));
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to build preview"));
    }
  }

  async function onFinalize() {
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const created = await finalizeReport({
        ...periodInput,
        narrative: form.narrative,
        recommendations: form.recommendations,
      });
      setNotice(`Finalized ${created.title}.`);
      setSelected(created);
      setReportPage(1);
      const archive = await listReportsPage({ page: 1, pageSize: 25 });
      setReports(archive.items);
      setReportTotal(archive.total);
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to finalize report"));
    } finally {
      setSubmitting(false);
    }
  }

  async function onAiDraft() {
    setError(null);
    setNotice(null);
    setDrafting(true);
    try {
      const draft = await draftReportNarrative(periodInput);
      setPreview(draft);
      setForm((current) => ({
        ...current,
        narrative: draft.narrative,
        recommendations: draft.recommendations,
      }));
      setNotice(
        draft.narrativeSource === "ai"
          ? "AI narrative draft generated."
          : "AI narrative unavailable. A deterministic fallback was used.",
      );
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to draft narrative"));
    } finally {
      setDrafting(false);
    }
  }

  async function onOpen(report: ReportSummary) {
    setError(null);
    try {
      const opened = await fetchReport(report.id);
      setPreview(null);
      setSelected(opened);
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to open report"));
    }
  }

  async function onCsv(report: ReportSummary) {
    setError(null);
    try {
      const blob = await downloadReportCsv(report.id);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `mazingira-${report.kind.toLowerCase()}-${report.periodStart}.csv`;
      link.click();
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to export report"));
    }
  }

  async function onOpenEvidence(accessPath?: string) {
    if (!accessPath) {
      setError("This report photo is not available from the finalized evidence archive.");
      return;
    }
    setError(null);
    const viewer = window.open("about:blank", "_blank", "noopener,noreferrer");
    try {
      const blob = await downloadReportEvidence(accessPath);
      const objectUrl = URL.createObjectURL(blob);
      if (viewer) viewer.location.href = objectUrl;
      else window.location.href = objectUrl;
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (err) {
      viewer?.close();
      setError(apiErrorMessage(err, "Unable to open report evidence"));
    }
  }

  const snapshot = selected?.snapshot ?? preview?.snapshot ?? null;
  const narrative = selected ? selected.narrative : form.narrative;
  const recommendations = selected ? selected.recommendations : form.recommendations;

  return (
    <main className="dashboard" aria-busy={loading}>
      <header className="dash-header">
        <BrandLogo size={44} href="/dashboard" />
        <div className="dash-title">
          <p className="eyebrow">MAZINGIRA OPS · REPORTS</p>
          <h1>Reports</h1>
        </div>
        <DashNav />
      </header>

      <StatusMessages error={error} notice={notice} loading={loading ? "Loading reports..." : null} />

      {can("REPORTS_GENERATE") && <section className="panel">
        <h2>Build a report</h2>
        <form className="grid-form" onSubmit={onPreview}>
          <label>
            Scope
            <select
              value={form.scopeId}
              onChange={(e) => { setForm({ ...form, scopeId: e.target.value }); setPreview(null); setSelected(null); }}
              required
            >
              <option value="">Select scope…</option>
              {scopes.map((option) => (
                <option key={`${option.scopeType}-${option.scopeId}`} value={option.scopeId}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Period type
            <select
              value={form.kind}
              onChange={(e) => { setForm({ ...form, kind: e.target.value as ReportKind }); setPreview(null); setSelected(null); }}
            >
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind.charAt(0) + kind.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start date
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => { setForm({ ...form, startDate: e.target.value }); setPreview(null); setSelected(null); }}
              required
            />
          </label>
          <label>
            End date
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => { setForm({ ...form, endDate: e.target.value }); setPreview(null); setSelected(null); }}
              required
            />
          </label>
          <button type="submit">Preview report</button>
        </form>
      </section>}

      {preview && !selected && (
        <section className="panel">
          <h2>Draft: {preview.title}</h2>
          <p className="muted-text">
            Period {formatDate(preview.snapshot.startDate)} to{" "}
            {formatDate(preview.snapshot.endDate)} · {preview.snapshot.scopeName}
          </p>
          <TotalsBar totals={preview.snapshot.totals} />
          <label>
            Narrative
            <textarea
              value={form.narrative}
              onChange={(e) => setForm({ ...form, narrative: e.target.value })}
              rows={4}
            />
          </label>
          {can("REPORTS_FINALIZE") && (
            <button
              type="button"
              className="link-btn"
              onClick={() => void onAiDraft()}
              disabled={drafting}
            >
              {drafting ? "Drafting..." : "Draft narrative with AI"}
            </button>
          )}
          <label>
            Recommendations
            <textarea
              value={form.recommendations}
              onChange={(e) => setForm({ ...form, recommendations: e.target.value })}
              rows={3}
            />
          </label>
          {can("REPORTS_FINALIZE") && (
            <button type="button" onClick={() => void onFinalize()} disabled={submitting}>
              {submitting ? "Finalizing..." : "Finalize report"}
            </button>
          )}
        </section>
      )}

      {selected && snapshot && (
        <section className="panel report-output">
          <h2>{selected.title}</h2>
          <p className="muted-text">
            <span className={`badge finalized`}>FINALIZED</span>{" "}
            {formatDate(snapshot.startDate)} to {formatDate(snapshot.endDate)} ·{" "}
            {snapshot.scopeName} · version {selected.version}
            {snapshot.signedBy ? ` · Signed by ${snapshot.signedBy} (${snapshot.signedTitle})` : ""}
          </p>
          <TotalsBar totals={snapshot.totals} />
          <p>
            <strong>Narrative</strong>
            <br />
            {narrative}
          </p>
          <p>
            <strong>Recommendations</strong>
            <br />
            {recommendations}
          </p>
          <div className="doc-actions">
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setSelected(null);
                setPreview(null);
              }}
            >
              Back
            </button>
            <button type="button" className="link-btn" onClick={() => window.print()}>
              Print / PDF
            </button>
            {canExport && (
              <button type="button" className="link-btn" onClick={() => void onCsv(selected)}>
                Export CSV
              </button>
            )}
          </div>
          <h3>Daily roster snapshot</h3>
          {snapshot.days.length === 0 ? (
            <p className="empty">No attendance days in this period.</p>
          ) : (
            <div className="table-wrap"><table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Ward</th>
                  <th>Activity</th>
                  <th>Location</th>
                  <th>Present</th>
                  <th>Late</th>
                  <th>Absent</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.days.map((day) =>
                  day.wards.map((ward) => {
                    const statuses = ward.roster.map((row) => row.status);
                    return (
                      <tr key={`${day.date}-${ward.wardId}`}>
                        <td>{formatDate(day.date)}</td>
                        <td>{ward.wardName}</td>
                        <td>{ward.activity}</td>
                        <td>{ward.location}</td>
                        <td>{statuses.filter((status) => status === "PRESENT").length}</td>
                        <td>{statuses.filter((status) => status === "LATE").length}</td>
                        <td>{statuses.filter((status) => status === "ABSENT").length}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table></div>
          )}
          <h3>Approved work</h3>
          {snapshot.workLogs.length === 0 ? (
            <p className="empty">No approved work logs in this period.</p>
          ) : (
            <div className="table-wrap"><table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Ward</th>
                  <th>Activity</th>
                  <th>Location</th>
                  <th>Trips</th>
                  <th>Photos</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.workLogs.map((workLog) => (
                  <tr key={workLog.id}>
                    <td>{formatDate(workLog.date)}</td>
                    <td>{workLog.wardName}</td>
                    <td>{workLog.activity}</td>
                    <td>{workLog.location}</td>
                    <td>{workLog.numberOfTrips}</td>
                    <td>
                      {workLog.photos.length === 0 ? (
                        <span className="muted-text">None</span>
                      ) : (
                        <div className="doc-list">
                          {workLog.photos.map((photo, index) => (
                            <button
                              type="button"
                              className="link-btn"
                              key={photo.accessPath ?? photo.evidenceId}
                              onClick={() => void onOpenEvidence(photo.accessPath)}
                            >
                              {photo.stage.toLowerCase()} {index + 1}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </section>
      )}

      <section className="panel">
        <h2>Finalized reports</h2>
        {reports.length === 0 ? (!loading && (
          <p className="empty">No finalized reports yet.</p>
        )) : (
          <div className="table-wrap"><table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Period</th>
                <th>Kind</th>
                <th>Finalized</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id}>
                  <td>{report.title}</td>
                  <td>
                    {formatDate(report.periodStart)} to {formatDate(report.periodEnd)}
                  </td>
                  <td>{report.kind.toLowerCase()}</td>
                  <td>{report.finalizedAt ? formatDate(report.finalizedAt.slice(0, 10)) : "—"}</td>
                  <td>
                    <div className="doc-actions">
                      <button type="button" className="link-btn" onClick={() => void onOpen(report)}>
                        View
                      </button>
                      {canExport && (
                        <button type="button" className="link-btn" onClick={() => void onCsv(report)}>
                          CSV
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {reportTotal > 25 && (
          <div className="pagination" aria-label="Report archive pages">
            <button type="button" disabled={reportPage === 1 || loading} onClick={() => setReportPage((value) => value - 1)}>
              Previous
            </button>
            <span>Page {reportPage} of {Math.ceil(reportTotal / 25)}</span>
            <button type="button" disabled={reportPage * 25 >= reportTotal || loading} onClick={() => setReportPage((value) => value + 1)}>
              Next
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function TotalsBar({ totals }: { totals: Record<string, number> }) {
  return (
    <div className="metrics">
      {Object.entries(totals).map(([status, count]) => (
        <div className="metric" key={status}>
          <span className="metric-value">{count}</span>
          <span className="metric-label">{status.replace(/_/g, " ").toLowerCase()}</span>
        </div>
      ))}
    </div>
  );
}
