"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { PasswordInput } from "@/components/PasswordInput";
import { ApiError, apiErrorMessage, changePassword, fetchMe } from "@/lib/api";
import { StatusMessages } from "@/components/StatusMessages";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const guard = useCallback(async () => {
    try {
      const me = await fetchMe();
      if (!me) {
        router.push("/login");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
      } else {
        setError(apiErrorMessage(err, "Unable to verify your session"));
      }
    }
  }, [router]);

  useEffect(() => {
    void guard();
  }, [guard]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to change password"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="home">
      <section className="hero auth-hero">
        <BrandLogo size={96} priority />
        <p className="eyebrow">NAIROBI CITY COUNTY</p>
        <h1>Set a new password</h1>
        <p className="subtitle">Choose a strong password before continuing.</p>

        <form className="auth-form" onSubmit={onSubmit}>
          <PasswordInput
            id="current"
            name="current"
            label="Current password"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
            required
          />

          <PasswordInput
            id="new"
            name="new"
            label="New password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            minLength={12}
            showStrengthMeter={true}
            required
          />

          <PasswordInput
            id="confirm"
            name="confirm"
            label="Confirm new password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            minLength={12}
            required
          />

          <StatusMessages error={error} />
          <button type="submit" disabled={submitting}>
            {submitting ? "Saving..." : "Change password"}
          </button>
        </form>
      </section>
    </main>
  );
}
