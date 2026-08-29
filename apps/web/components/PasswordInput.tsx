"use client";

import { useState } from "react";

export interface PasswordRequirement {
  id: string;
  label: string;
  met: boolean;
}

export function evaluatePassword(password: string): {
  score: number; // 0 to 4
  level: "Weak" | "Fair" | "Good" | "Strong";
  requirements: PasswordRequirement[];
} {
  const reqs: PasswordRequirement[] = [
    {
      id: "length",
      label: "At least 12 characters",
      met: password.length >= 12,
    },
    {
      id: "lowercase",
      label: "Lowercase letter (a-z)",
      met: /[a-z]/.test(password),
    },
    {
      id: "uppercase",
      label: "Uppercase letter (A-Z)",
      met: /[A-Z]/.test(password),
    },
    {
      id: "number",
      label: "Number (0-9)",
      met: /[0-9]/.test(password),
    },
    {
      id: "symbol",
      label: "Special character (!@#$%...)",
      met: /[^A-Za-z0-9]/.test(password),
    },
  ];

  const metCount = reqs.filter((r) => r.met).length;

  let level: "Weak" | "Fair" | "Good" | "Strong" = "Weak";
  let score = 0;

  if (password.length > 0) {
    if (metCount <= 2 || password.length < 8) {
      level = "Weak";
      score = 1;
    } else if (metCount === 3 || (metCount >= 4 && password.length < 12)) {
      level = "Fair";
      score = 2;
    } else if (metCount >= 4 && password.length >= 12) {
      if (metCount === 5 && password.length >= 14) {
        level = "Strong";
        score = 4;
      } else {
        level = "Good";
        score = 3;
      }
    }
  }

  return { score, level, requirements: reqs };
}

interface PasswordInputProps {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  showStrengthMeter?: boolean;
  label?: string;
  disabled?: boolean;
}

export function PasswordInput({
  id = "password",
  name = "password",
  value,
  onChange,
  placeholder = "••••••••••••",
  autoComplete = "current-password",
  required = true,
  minLength = 12,
  showStrengthMeter = false,
  label = "Password",
  disabled = false,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const { score, level, requirements } = evaluatePassword(value);

  return (
    <div className="password-input-group">
      {label && <label htmlFor={id}>{label}</label>}
      <div className="password-input-wrapper">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          disabled={disabled}
          className="password-input"
        />
        <button
          type="button"
          className="password-toggle-btn"
          aria-label={visible ? "Hide password" : "Show password"}
          title={visible ? "Hide password" : "Show password"}
          onClick={() => setVisible(!visible)}
          tabIndex={-1}
        >
          {visible ? (
            /* Eye Off Icon */
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            /* Eye Icon */
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>

      {showStrengthMeter && value.length > 0 && (
        <div className="password-security-meter" aria-live="polite">
          <div className="security-meter-header">
            <span className="meter-label">Password security:</span>
            <span className={`meter-badge level-${level.toLowerCase()}`}>
              {level}
            </span>
          </div>

          <div className="meter-bars" role="progressbar" aria-valuenow={score} aria-valuemin={0} aria-valuemax={4}>
            <span className={`meter-segment ${score >= 1 ? `active level-${level.toLowerCase()}` : ""}`} />
            <span className={`meter-segment ${score >= 2 ? `active level-${level.toLowerCase()}` : ""}`} />
            <span className={`meter-segment ${score >= 3 ? `active level-${level.toLowerCase()}` : ""}`} />
            <span className={`meter-segment ${score >= 4 ? `active level-${level.toLowerCase()}` : ""}`} />
          </div>

          <ul className="requirements-list">
            {requirements.map((req) => (
              <li key={req.id} className={req.met ? "met" : "unmet"}>
                <span className="req-icon" aria-hidden="true">
                  {req.met ? "✓" : "○"}
                </span>
                <span>{req.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
