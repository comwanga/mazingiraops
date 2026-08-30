"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { DashNav } from "@/components/DashNav";
import { StatusMessages } from "@/components/StatusMessages";
import { ApiError, AuditEvent, apiErrorMessage, fetchMe, listAudit } from "@/lib/api";

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
}

export default function AuditPage() {
  const router = useRouter();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
      if (!me.capabilities.includes("AUDIT_READ")) {
        router.replace("/dashboard");
        return;
      }
      const result = await listAudit({ page, pageSize: 50 });
      setEvents(result.items);
      setTotal(result.total);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
      } else {
        setError(apiErrorMessage(err, "Unable to load audit history"));
      }
    } finally {
      setLoading(false);
    }
  }, [page, router]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="dashboard" aria-busy={loading}>
      <header className="dash-header">
        <BrandLogo size={44} href="/dashboard" />
        <div className="dash-title">
          <p className="eyebrow">AUDIT HISTORY</p>
          <h1>Audit</h1>
        </div>
        <DashNav />
      </header>

      <section className="panel">
        <h2>Recent activity ({total} total)</h2>
        <StatusMessages error={error} loading={loading ? "Loading audit history..." : null} />
        {events.length === 0 ? (!loading && (
          <p className="empty">No audit events visible in your scope.</p>
        )) : (
          <div className="table-wrap"><table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Target</th>
                <th>Scope</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{formatWhen(event.occurredAt)}</td>
                  <td>{event.action}</td>
                  <td>{event.actorDisplayName ?? "System"}</td>
                  <td>{event.targetType}</td>
                  <td>{event.scopeType ? event.scopeType.toLowerCase() : "global"}</td>
                  <td>{typeof event.details === "string" ? event.details : JSON.stringify(event.details ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {total > 50 && (
          <div className="pagination" aria-label="Audit pages">
            <button type="button" disabled={page === 1 || loading} onClick={() => setPage((value) => value - 1)}>
              Previous
            </button>
            <span>Page {page} of {Math.ceil(total / 50)}</span>
            <button type="button" disabled={page * 50 >= total || loading} onClick={() => setPage((value) => value + 1)}>
              Next
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
