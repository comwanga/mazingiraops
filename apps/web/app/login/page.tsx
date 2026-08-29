"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { PasswordInput } from "@/components/PasswordInput";
import { apiErrorMessage, fetchMe, login } from "@/lib/api";
import { StatusMessages } from "@/components/StatusMessages";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void fetchMe()
      .then((user) => {
        if (user) router.replace(user.mustChangePassword ? "/account/password" : "/dashboard");
      })
      .catch(() => undefined);
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(email, password);
      router.push(user.mustChangePassword ? "/account/password" : "/dashboard");
      router.refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to sign in"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="home">
      <section className="hero auth-hero">
        <BrandLogo size={96} priority />
        <p className="eyebrow">NAIROBI CITY COUNTY</p>
        <h1>MazingiraOps</h1>
        <p className="subtitle">Environment Operations Platform</p>

        <div className="auth-switcher" role="tablist" aria-label="Authentication modes">
          <span className="auth-tab active" aria-selected="true">
            Sign in
          </span>
          <Link href="/register" className="auth-tab" aria-selected="false">
            Sign up / Request access
          </Link>
        </div>

        <form className="auth-form" onSubmit={onSubmit}>
          <label htmlFor="email">Official Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            placeholder="officer@nairobi.go.ke"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <PasswordInput
            id="password"
            name="password"
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            required
          />

          <StatusMessages error={error} />
          <button type="submit" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div className="test-credentials-card" role="region" aria-label="Demo Credentials">
          <p className="test-credentials-title">⚡ Quick Test Accounts (Local Environment)</p>
          <div className="test-credentials-grid">
            <button
              type="button"
              className="test-credential-btn"
              onClick={() => {
                setEmail("admin@nairobi.go.ke");
                setPassword("Admin@Nairobi2026!Ops");
              }}
            >
              👑 System Admin
            </button>
            <button
              type="button"
              className="test-credential-btn"
              onClick={() => {
                setEmail("ward.officer@nairobi.go.ke");
                setPassword("Officer@Makina2026!Ops");
              }}
            >
              📋 Ward Officer (Makina)
            </button>
            <button
              type="button"
              className="test-credential-btn"
              onClick={() => {
                setEmail("subcounty.officer@nairobi.go.ke");
                setPassword("Officer@Kibra2026!Ops");
              }}
            >
              🔍 Sub-County Officer (Kibra)
            </button>
            <button
              type="button"
              className="test-credential-btn"
              onClick={() => {
                setEmail("director.environment@nairobi.go.ke");
                setPassword("Director@Nairobi2026!Ops");
              }}
            >
              🏛️ Director of Environment
            </button>
          </div>
        </div>

        <p className="auth-links">
          <Link href="/">Back to home</Link>
        </p>
      </section>
    </main>
  );
}

