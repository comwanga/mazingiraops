import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";

export default function Home() {
  return (
    <main className="home">
      <section className="hero">
        <BrandLogo size={96} priority />
        <p className="eyebrow">NAIROBI CITY COUNTY</p>
        <p className="sector">Environment Sector</p>
        <h1>MazingiraOps</h1>
        <p className="subtitle">Environment Operations Platform</p>
        <p className="purpose">
          Coordinate environmental operations across wards and sub-counties in
          one place.
        </p>
        <div className="home-actions">
          <Link className="primary-btn" href="/login">
            Sign in
          </Link>
          <Link className="secondary-link" href="/register">
            Sign up / Request access
          </Link>
        </div>
      </section>
    </main>
  );
}
