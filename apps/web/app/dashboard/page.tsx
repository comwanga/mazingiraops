"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { DashNav } from "@/components/DashNav";
import { StatusMessages } from "@/components/StatusMessages";
import {
  apiErrorMessage,
  ApiError,
  AuthUser,
  DashboardSnapshot,
  fetchDashboard,
  fetchMe,
} from "@/lib/api";
import { formatUserIdentity } from "@/lib/identity";

const METRICS: Array<{
  key: keyof DashboardSnapshot["metrics"];
  label: string;
  href: string;
  detail: string;
  capability: string;
}> = [
  { key: "activeStaff", label: "Active staff", href: "/staff", detail: "in accessible wards", capability: "STAFF_READ" },
  { key: "presentOrLateToday", label: "Present or late", href: "/attendance", detail: "recorded today", capability: "ATTENDANCE_READ" },
  { key: "openSessions", label: "Open sessions", href: "/attendance", detail: "accepting check-ins", capability: "ATTENDANCE_READ" },
  { key: "approvedAbsencesToday", label: "Approved absences", href: "/absences", detail: "covering today", capability: "ABSENCE_READ" },
  { key: "pendingAbsences", label: "Pending absences", href: "/absences", detail: "awaiting review", capability: "ABSENCE_REVIEW" },
  { key: "pendingWorkLogs", label: "Pending work logs", href: "/worklogs", detail: "awaiting review", capability: "WORK_REVIEW" },
  { key: "finalizedReports", label: "Finalized reports", href: "/reports", detail: "within your scope", capability: "REPORTS_READ" },
];

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<(AuthUser & { capabilities: string[] }) | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await fetchMe();
      if (!current) return router.replace("/login");
      if (current.mustChangePassword) return router.replace("/account/password");
      setUser(current);
      setSnapshot(await fetchDashboard());
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) router.replace("/login");
      else setError(apiErrorMessage(cause, "Unable to load the dashboard"));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  return (
    <main className="dashboard">
      <header className="dash-header">
        <BrandLogo size={44} href="/dashboard" />
        <div className="dash-title">
          <p className="eyebrow">MAZINGIRA OPS · OPERATIONS</p>
          <h1>Dashboard</h1>
        </div>
        <DashNav />
      </header>

      <section className="dashboard-welcome">
        <div>
          <p className="eyebrow">CURRENT OPERATIONAL VIEW</p>
          <h2>{user ? `Welcome, ${user.displayName}` : "Loading dashboard"}</h2>
          {user && <p className="dashboard-identity">{formatUserIdentity(user)}</p>}
          <p>
            {snapshot
              ? `One synchronized snapshot as of ${new Date(snapshot.asOf).toLocaleString()}.`
              : "Live information from your assigned scope."}
          </p>
        </div>
        <button type="button" className="secondary-btn" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </section>

      <StatusMessages error={error} loading={loading ? "Loading operational snapshot..." : null} />
      {snapshot && (
        <>
          <section className="metric-grid" aria-label="Operational summary">
            {METRICS.filter((metric) => user?.capabilities.includes(metric.capability)).map((metric) => (
              <Link className="dashboard-metric" href={metric.href} key={metric.key}>
                <span className="metric-value">{snapshot.metrics[metric.key]}</span>
                <strong>{metric.label}</strong>
                <span>{metric.detail}</span>
              </Link>
            ))}
          </section>
          {snapshot.queue.length > 0 && (
            <section className="panel dashboard-queue" aria-labelledby="dashboard-queue-title">
              <h2 id="dashboard-queue-title">Needs attention</h2>
              {snapshot.queue.map((item) => (
                <Link href={item.href} key={`${item.type}-${item.id}`}>
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </Link>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
