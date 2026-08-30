import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";

export default function Home() {
  return (
    <main className="home home-landing">
      <section className="hero landing-hero">
        <BrandLogo size={96} priority />
        <p className="eyebrow">NAIROBI CITY COUNTY</p>
        <p className="sector">Environment Sector</p>
        <h1>MazingiraOps</h1>
        <p className="subtitle">Environment Operations Platform</p>
        <p className="purpose">
          One accountable workspace for attendance, field operations, leave,
          evidence and reporting across Nairobi&apos;s wards and sub-counties.
        </p>
        <div className="home-actions">
          <Link className="primary-btn" href="/login">
            Sign in
          </Link>
          <Link className="secondary-link" href="/register">
            Request access
          </Link>
        </div>
        <ul className="landing-highlights" aria-label="Platform capabilities">
          <li>
            <strong>Field-ready</strong>
            <span>Fast attendance and operational updates from any device.</span>
          </li>
          <li>
            <strong>Scope-aware</strong>
            <span>Ward, sub-county and county views follow assigned authority.</span>
          </li>
          <li>
            <strong>Accountable</strong>
            <span>Review trails and immutable reports preserve every decision.</span>
          </li>
        </ul>
        <p className="landing-assurance">Official operations workspace · Access is verified and role-based</p>
      </section>
    </main>
  );
}
