"use client";

import { FormEvent, useEffect, useState } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { CheckInResponse, apiErrorMessage, checkInPublic } from "@/lib/api";
import { StatusMessages } from "@/components/StatusMessages";

function getGeolocation(): Promise<{ latitude: number; longitude: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  });
}

export default function CheckInPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState<string>("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [declaringAbsent, setDeclaringAbsent] = useState(false);
  const [absenceReason, setAbsenceReason] = useState<"SICK_OFF" | "WEEKEND_OFF_DUTY" | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckInResponse | null>(null);

  useEffect(() => {
    void params.then((value) => setToken(value.token));
  }, [params]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const geo = declaringAbsent ? null : await getGeolocation();
      const response = await checkInPublic(
        token,
        employeeNumber,
        geo?.latitude ?? null,
        geo?.longitude ?? null,
        declaringAbsent ? "ABSENT" : "PRESENT",
        declaringAbsent ? absenceReason || undefined : undefined,
      );
      setResult(response);
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to confirm attendance"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="home">
      <section className="hero">
        <BrandLogo size={80} priority />
        <p className="eyebrow">NAIROBI CITY COUNTY</p>
        <h1>Attendance check-in</h1>
        <p className="subtitle">Environment Operations Platform</p>

        {result ? (
          <div className="checkin-result">
            <StatusMessages notice={result.message ?? "Attendance confirmed."} />
            <p>
              <strong>{result.employee?.fullName ?? "Identity verified"}</strong>
            </p>
            <p>
              Status:{" "}
              <span className={`badge ${result.approvalStatus ? "submitted" : result.status.toLowerCase()}`}>
                {result.approvalStatus
                  ? `Pending approval · ${result.absenceReason === "SICK_OFF" ? "Sick off" : "Weekend off duty"}`
                  : result.status}
              </span>
            </p>
            <p className="subtitle">{new Date(result.checkedAt).toLocaleString()}</p>
          </div>
        ) : (
          <form className="auth-form" onSubmit={onSubmit}>
            <label htmlFor="employeeNumber">Payroll/Employee ID</label>
            <input
              id="employeeNumber"
              inputMode="numeric"
              autoComplete="off"
              placeholder="e.g. 20230228567"
              pattern="(19|20)\d{9}"
              maxLength={11}
              value={employeeNumber}
              onChange={(event) =>
                setEmployeeNumber(event.target.value.replace(/\D/g, "").slice(0, 11))
              }
              required
            />
            <label className="checkin-absence-toggle">
              <input
                type="checkbox"
                checked={declaringAbsent}
                onChange={(event) => {
                  setDeclaringAbsent(event.target.checked);
                  if (!event.target.checked) setAbsenceReason("");
                }}
              />
              <span>I am absent today</span>
            </label>
            {declaringAbsent && (
              <fieldset className="checkin-absence-reason">
                <legend>Reason for absence</legend>
                <p>Your Ward Environment Officer must approve this declaration in the attendance register.</p>
                <label><input type="radio" name="absenceReason" value="SICK_OFF" checked={absenceReason === "SICK_OFF"} onChange={() => setAbsenceReason("SICK_OFF")} required />Sick off</label>
                <label><input type="radio" name="absenceReason" value="WEEKEND_OFF_DUTY" checked={absenceReason === "WEEKEND_OFF_DUTY"} onChange={() => setAbsenceReason("WEEKEND_OFF_DUTY")} required />Weekend off duty</label>
              </fieldset>
            )}
            <StatusMessages error={error} />
            <button type="submit" disabled={submitting}>
              {submitting ? "Submitting..." : declaringAbsent ? "Submit absence for approval" : "Confirm attendance"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
