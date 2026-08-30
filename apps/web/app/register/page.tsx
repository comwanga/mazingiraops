"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { PasswordInput, evaluatePassword } from "@/components/PasswordInput";
import { StatusMessages } from "@/components/StatusMessages";
import {
  apiErrorMessage,
  listPublicOrganisations,
  PublicOrganisationTree,
  requestAccess,
} from "@/lib/api";

type ScopeOption = {
  type: "COUNTY" | "SUBCOUNTY" | "WARD";
  id: string;
  label: string;
  parentName?: string;
};

interface DesignationConfig {
  code: string;
  title: string;
  allowedScopeType: "WARD" | "SUBCOUNTY" | "COUNTY" | "ANY";
  description: string;
}

const DESIGNATIONS: DesignationConfig[] = [
  {
    code: "WARD_OFFICER",
    title: "Ward Environment Officer",
    allowedScopeType: "WARD",
    description:
      "Manages staff rosters, attendance check-ins, absences, and field work logs strictly for your assigned ward.",
  },
  {
    code: "SUB_COUNTY_OFFICER",
    title: "Sub-County Environment Officer",
    allowedScopeType: "SUBCOUNTY",
    description:
      "Supervises and monitors environmental operations and reports across all wards in your assigned sub-county.",
  },
  {
    code: "DIRECTOR",
    title: "Director of Environment",
    allowedScopeType: "COUNTY",
    description:
      "Executive oversight and analytics across all sub-counties and wards in Nairobi City County.",
  },
  {
    code: "DEPUTY_DIRECTOR",
    title: "Deputy Director of Environment",
    allowedScopeType: "COUNTY",
    description:
      "Executive operational management across Nairobi City County.",
  },
  {
    code: "ASSISTANT_DIRECTOR",
    title: "Assistant Director of Environment",
    allowedScopeType: "COUNTY",
    description:
      "Technical direction, operational review, and county-wide reporting.",
  },
  {
    code: "READ_ONLY_OBSERVER",
    title: "Read-Only Observer / Audit Reviewer",
    allowedScopeType: "ANY",
    description:
      "Read-only inspection of environmental data, attendance, and reports without modification privileges.",
  },
];

function buildScopeOptions(tree: PublicOrganisationTree): ScopeOption[] {
  return tree.counties.flatMap((county) => [
    { type: "COUNTY" as const, id: county.id, label: `${county.name} (County-wide)` },
    ...county.subcounties.flatMap((subcounty) => [
      {
        type: "SUBCOUNTY" as const,
        id: subcounty.id,
        label: `${subcounty.name} Sub-County`,
        parentName: county.name,
      },
      ...subcounty.wards.map((ward) => ({
        type: "WARD" as const,
        id: ward.id,
        label: `${ward.name} Ward (${subcounty.name})`,
        parentName: `${subcounty.name} Sub-County`,
      })),
    ]),
  ]);
}

export default function RegisterPage() {
  const [allScopes, setAllScopes] = useState<ScopeOption[]>([]);
  const [designation, setDesignation] = useState("WARD_OFFICER");
  const [scopeKey, setScopeKey] = useState("");
  const [form, setForm] = useState({ displayName: "", email: "", password: "", reason: "" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void listPublicOrganisations()
      .then((tree) => {
        const scopes = buildScopeOptions(tree);
        setAllScopes(scopes);
      })
      .catch((cause) => setError(apiErrorMessage(cause, "Unable to load organisation scopes")));
  }, []);

  const selectedDesignation = useMemo(
    () => DESIGNATIONS.find((d) => d.code === designation) ?? DESIGNATIONS[0]!,
    [designation],
  );

  const filteredScopes = useMemo(() => {
    if (selectedDesignation.allowedScopeType === "ANY") return allScopes;
    return allScopes.filter((s) => s.type === selectedDesignation.allowedScopeType);
  }, [allScopes, selectedDesignation]);

  const groupedScopes = useMemo(() => {
    const groups: Array<{ groupLabel: string; items: ScopeOption[] }> = [];
    for (const option of filteredScopes) {
      const groupName = option.parentName || "Nairobi City County";
      let group = groups.find((g) => g.groupLabel === groupName);
      if (!group) {
        group = { groupLabel: groupName, items: [] };
        groups.push(group);
      }
      group.items.push(option);
    }
    return groups;
  }, [filteredScopes]);

  // Auto-select first matching scope when designation changes
  useEffect(() => {
    if (filteredScopes.length > 0) {
      setScopeKey(`${filteredScopes[0]!.type}:${filteredScopes[0]!.id}`);
    } else {
      setScopeKey("");
    }
  }, [filteredScopes]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = filteredScopes.find((option) => `${option.type}:${option.id}` === scopeKey);
    if (!selected) {
      setError("Select the organisation scope (Ward / Sub-County / County) where you will work.");
      return;
    }

    const { score } = evaluatePassword(form.password);
    if (score < 2 || form.password.length < 12) {
      setError("Please choose a stronger password meeting all security requirements.");
      return;
    }

    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const formattedReason = `[Designation: ${selectedDesignation.title}] ${form.reason.trim()}`;
      await requestAccess({
        displayName: form.displayName.trim(),
        email: form.email.trim(),
        password: form.password,
        reason: formattedReason,
        requestedScope: selected.type,
        requestedScopeId: selected.id,
      });
      setNotice(
        "Your access request was submitted. An administrator must verify your role and scope before you can sign in.",
      );
      setForm({ displayName: "", email: "", password: "", reason: "" });
    } catch (cause) {
      setError(apiErrorMessage(cause, "Unable to submit the access request"));
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
        <p className="subtitle">Create account & request operational access</p>

        <nav className="auth-switcher" aria-label="Account access">
          <Link href="/login" className="auth-tab">
            Sign in
          </Link>
          <span className="auth-tab active" aria-current="page">
            Request access
          </span>
        </nav>

        <form className="auth-form" onSubmit={onSubmit}>
          <label htmlFor="displayName">Full Name</label>
          <input
            id="displayName"
            type="text"
            placeholder="e.g. Jane Wangari"
            autoComplete="name"
            value={form.displayName}
            onChange={(event) =>
              setForm((current) => ({ ...current, displayName: event.target.value }))
            }
            required
          />

          <label htmlFor="email">Official Email Address</label>
          <input
            id="email"
            type="email"
            placeholder="name@nairobi.go.ke"
            autoComplete="email"
            value={form.email}
            onChange={(event) =>
              setForm((current) => ({ ...current, email: event.target.value }))
            }
            required
          />

          <PasswordInput
            id="password"
            name="password"
            label="Password"
            value={form.password}
            onChange={(val) => setForm((current) => ({ ...current, password: val }))}
            autoComplete="new-password"
            minLength={12}
            showStrengthMeter={true}
            required
          />

          <label htmlFor="designation">Designation / Official Role</label>
          <select
            id="designation"
            value={designation}
            onChange={(event) => setDesignation(event.target.value)}
          >
            {DESIGNATIONS.map((d) => (
              <option key={d.code} value={d.code}>
                {d.title}
              </option>
            ))}
          </select>
          <p className="field-hint">{selectedDesignation.description}</p>

          <label htmlFor="scope">
            {selectedDesignation.allowedScopeType === "WARD"
              ? "Assigned Ward"
              : selectedDesignation.allowedScopeType === "SUBCOUNTY"
              ? "Assigned Sub-County"
              : "Assigned Jurisdiction / Scope"}
          </label>
          <select
            id="scope"
            value={scopeKey}
            onChange={(event) => setScopeKey(event.target.value)}
            disabled={!filteredScopes.length}
            required
          >
            {!filteredScopes.length && <option value="">Loading available scopes...</option>}
            {groupedScopes.map((group) => (
              <optgroup key={group.groupLabel} label={group.groupLabel}>
                {group.items.map((option) => (
                  <option key={`${option.type}:${option.id}`} value={`${option.type}:${option.id}`}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <label htmlFor="reason">Reason for Access / Department</label>
          <textarea
            id="reason"
            placeholder="Describe your operational responsibilities and environment posting..."
            value={form.reason}
            onChange={(event) =>
              setForm((current) => ({ ...current, reason: event.target.value }))
            }
            required
          />

          <div className="approval-notice-box" role="note">
            <span className="notice-icon" aria-hidden="true">
              ℹ
            </span>
            <p>
              <strong>Approval required:</strong> An administrator will verify your identity,
              requested role and operational scope. Approval does not happen automatically.
            </p>
          </div>

          <StatusMessages error={error} notice={notice} />

          <button type="submit" disabled={submitting || !filteredScopes.length}>
            {submitting ? "Submitting request..." : "Sign up & Request access"}
          </button>
        </form>

        <p className="auth-links">
          <Link href="/login">Already have an account? Sign in</Link>
        </p>
      </section>
    </main>
  );
}

