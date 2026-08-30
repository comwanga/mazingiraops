# Open Business-Rule Questions

Status: **Open policy decisions** — the current implementation uses the pilot
defaults documented below. Policy owners must confirm them before production
rollout; changes may require schema, validation, retention, and procedure updates.

These decisions do not block technical verification, but they do block a fully
approved production operating model.

## Attendance

1. Late threshold — legacy is hard-coded to 30 minutes. Confirm per policy.
2. Allowed session durations — legacy allows {30, 60, 120, 240, 480} min.
   Confirm the intended set.
3. Geofence / distance validation — mentioned in the legacy implementation
   plan but not implemented. Required for pilot, or manual + optional GPS
   only?
4. Check-in rate limit — legacy is 15 attempts / 10 min / IP+token. Confirm.

## Staff

5. Employee number uniqueness — legacy is globally unique; new model scopes
   uniqueness to the ward. Confirm whether the same Employee ID may legally
   appear in two wards.
6. Roster import field set and statuses — legacy accepts ON DUTY / ANNUAL
   LEAVE. Confirm the authoritative source and field definitions.

## Absence / leave

7. Absence `kind` set — legacy: annual/maternity/paternity/compassionate
   leave, sick_off, official_duty, unpaid_leave. Confirm the complete set.
8. Sick-off reason minimum length and rejection-note length (legacy 10 and 3
   chars). Confirm.

## Work logs

9. Truck/backhoe identifier formats (`T-161`, `BH13`) — confirm.
10. Photo limits (≤4 before/during/after) and whether compression/thumbnail
    policy is approved.

## Reports

11. Photo sampling policy for weekly/monthly (≤4 per stage) — confirm.
12. Report signature title ("Ward Environment Officer" vs role-derived) —
    confirm the official wording.

## Retention & privacy

13. Medical document retention/deletion periods (legacy: undefined).
14. Object-storage lifecycle/backup policy (documented, needs sign-off).
15. County SSO / MFA — when available, replace local passwords?

## Branding

16. Confirm `nairobi-city-county-logo.png` is the officially approved logo and
    `nairobi-green-corridor.png` the approved background for all documents and
    screens (see `docs/BRANDING.md`).
