# Authorization Model

Status: **Phase 0 proposal** (awaiting review).

Default is **DENY**. Missing or unassigned capabilities never mean
unrestricted access. Client-supplied `wardId`/`subcountyId`/`countyId` are
never trusted; every scope is validated against the authenticated user's
assignments.

## 1. Evaluation flow

```
Request work log 123 (ward = Makina)
  -> Authenticate (session)
  -> Resolve user's assignments (role + scope)
  -> Determine requested resource scope
  -> Resolve required capability (e.g. WORK_READ)
  -> Capability granted? AND scope within assignment? -> ALLOW / DENY
```

Central guards/policies evaluate: authenticated user + role + assignment +
requested resource scope + required capability.

## 2. Capability set

```text
STAFF_READ            staff.read            view staff register / roster
STAFF_MANAGE          staff.manage          create/edit/deactivate staff, import roster

ATTENDANCE_READ       attendance.read       view roster, attendance history
ATTENDANCE_MANAGE     attendance.manage     create sessions, manual exceptions

WORK_READ             work.read             view work logs
WORK_CREATE           work.create           submit work logs + evidence
WORK_REVIEW           work.review           approve/reject work logs

ABSENCE_READ          absence.read          view absence requests
ABSENCE_MANAGE        absence.manage        create/submit/cancel absence requests
ABSENCE_REVIEW        absence.review        approve/reject absence requests

MEDICAL_READ          medical.read          download medical/supporting documents

REPORTS_READ          reports.read          view/preview/export reports
REPORTS_FINALIZE      reports.finalize      finalize immutable reports

AUDIT_READ            audit.read            view audit history

USERS_MANAGE          users.manage          create/disable users, review access requests, assignments
```

## 3. Role → capability matrix

| Capability | WARD_OFFICER | SUBCOUNTY_REVIEWER | HR_VIEWER | READ_ONLY | SYSTEM_ADMIN |
|---|:---:|:---:|:---:|:---:|:---:|
| STAFF_READ | ✓ | ✓ | ✓ | ✗¹ | ✗ |
| STAFF_MANAGE | ✓ | ✗ | ✗ | ✗ | ✗ |
| ATTENDANCE_READ | ✓ | ✓ | ✓ | ✓¹ | ✗ |
| ATTENDANCE_MANAGE | ✓ | ✗ | ✗ | ✗ | ✗ |
| WORK_READ | ✓ | ✓ | ✗ | ✗¹ | ✗ |
| WORK_CREATE | ✓ | ✗ | ✗ | ✗ | ✗ |
| WORK_REVIEW | ✗ | ✓ | ✗ | ✗ | ✗ |
| ABSENCE_READ | ✓ | ✓ | ✓ | ✗¹ | ✗ |
| ABSENCE_MANAGE | ✓ | ✗ | ✓ | ✗ | ✗ |
| ABSENCE_REVIEW | ✗ | ✓ | ✓ | ✗ | ✗ |
| MEDICAL_READ | ✗ | ✗ | ✓ | ✗ | ✗ |
| REPORTS_READ | ✓ | ✓ | ✓ | ✓¹ | ✓ |
| REPORTS_FINALIZE | ✓ | ✓ | ✗ | ✗ | ✗ |
| AUDIT_READ | ✗ | ✓ | ✗ | ✗ | ✗ |
| USERS_MANAGE | ✗ | ✗ | ✗ | ✗ | ✓ |

¹ READ_ONLY capability grants are controlled per-account at approval time
(the legacy model granted `attendance,reports` by default; the same is
expressed via assignments/capabilities rather than a CSV string).

### Enforced System Administrator boundary

`SYSTEM_ADMIN` is a platform-account role, not a ward-operations superuser.
Its capability set is fixed and reconciled by every seed run to:
`REPORTS_READ`, `USERS_MANAGE`, `USERS_READ`, `USERS_DISABLE`,
`PERMISSIONS_MANAGE`, and `SCOPE_MANAGE`. All staff, attendance, work-log,
absence, medical, report-generation/export/finalisation, audit, archive and
evidence-mutation capabilities are denied. The API rejects attempts to expand
the role, and the web permission editor renders it as a locked policy.

## 4. Scope resolution

- `WARD_OFFICER` → typically assigned to one `WARD`.
- `SUBCOUNTY_REVIEWER` → assigned to one `SUBCOUNTY` (aggregates authorized
  wards underneath).
- `HR_VIEWER` → assigned to a `SUBCOUNTY` or `COUNTY` as policy requires;
  `MEDICAL_READ` is restricted to the assigned scope.
- `SYSTEM_ADMIN` → assigned to `COUNTY` (platform administration; still scoped,
  not a global superuser that bypasses tenancy).
- `READ_ONLY` → scoped to a specific ward/subcounty/county at approval.

Scope checking rule: a capability is granted for a resource only when the
resource's scope (ward → subcounty → county lineage) is equal to or contained
within the user's assignment scope. A `SUBCOUNTY` assignment covers all wards
under that subcounty; a `COUNTY` assignment covers all subcounties/wards under
that county. A `WARD` assignment covers only that ward.

## 5. Enforcement points

- API guards (`@RequireCapability(CAPABILITY)` + `@RequireScope`) evaluate the
  authenticated user and resource scope before any handler logic.
- The data-access layer scopes every query by the resolved assignment scope
  (backend filtering is mandatory; the UI never gates tenancy).
- Dashboard/report aggregation derives its scope from the user's assignment,
  never from request parameters.

## 6. Release-critical isolation tests (must pass)

1. Makina officer CANNOT read another ward's work log.
2. Makina officer CANNOT modify another ward's attendance.
3. Ward officer CANNOT escalate scope through request parameters.
4. Subcounty reviewer CAN access authorized wards (and only those).
5. County-level user CAN access only the assigned county scope.

These are release gates (§50 of `projectredefine.md`).
