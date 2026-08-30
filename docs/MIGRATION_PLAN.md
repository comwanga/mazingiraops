# Migration Plan — Legacy → New Model

Status: **Tooling implemented; production execution awaits approval and a migration window.**

Migration is **never performed automatically by deployment**. The repository now
contains the mapping, migrator, reconciliation paths, scripts, and automated
tests described here. Run them against synthetic/test copies before any real
production migration, then require an approved backup, dry-run report, migration
window, and rollback decision.

## 1. Entity mapping

| Legacy (SQLAlchemy) | New (Prisma) | Notes |
|---|---|---|
| `users` | `User` | role column → assignments/capabilities |
| `user_sessions` | `UserSession` | token_hash, csrf, expiry preserved |
| `access_requests` | `AccessRequest` | requested_scope → typed scope |
| `employees` | `Employee` | add `wardId` (seed = Makina) |
| `employee_profiles` | `EmployeeProfile` | roster_status preserved |
| `attendance_sessions` | `AttendanceSession` | add `wardId` |
| `attendance` | `Attendance` | add `wardId`; status → enum |
| `absence_requests` | `AbsenceRequest` | unify `absences` + `planned_leave`; add `wardId`, `version` |
| `absences` (legacy) | `AbsenceRequest` | merge legacy rows |
| `planned_leave` (legacy) | `AbsenceRequest` | merge legacy rows (kind = leave) |
| `documents` | `Document` | storage_key → objectKey; move bytes to S3 |
| `document_classifications` | `DocumentClassification` | category → enum |
| `work_logs` | `WorkLog` | add `wardId`, `version`; drop quantity/unit |
| `work_log_details` | `WorkLogDetail` | completion_status → enum |
| `work_log_operations` | `WorkLogOperations` | unchanged (column renames) |
| `work_photos` + `work_photo_stages` | `Evidence` | stage inline |
| `report_records` | `Report` + `ReportEvidence` | snapshot_json → Json; extract evidence refs |
| `reminder_deliveries` | `ReminderDelivery` | status → enum |
| `audit_events` | `AuditEvent` | add scopeType/scopeId/requestId |

## 2. Roles → assignments

Legacy `users.role` values map to initial `Assignment` records:

| Legacy role | Role | Scope |
|---|---|---|
| `system_admin` | SYSTEM_ADMIN | COUNTY (Nairobi) |
| `ward_officer` | WARD_OFFICER | WARD (Makina) |
| `subcounty_reviewer` | SUBCOUNTY_REVIEWER | SUBCOUNTY (Kibra) |
| `hr_viewer` | HR_VIEWER | SUBCOUNTY (Kibra) |
| `read_only` | READ_ONLY | scope recorded at approval time |

Legacy CSV `permissions` string is decomposed into capabilities on the role
(the READ_ONLY role's optional capability grants are captured per account).

## 3. Scoping legacy single-ward data

All legacy records are single-ward (Makina). Migration seeds the hierarchy and
assigns `wardId = Makina` to every operational record. No data is lost; the
scope is simply made explicit.

## 4. Password hashes

scrypt hashes (`scrypt$salt$digest`) are algorithm-compatible. The NestJS auth
module will verify the same format (or re-hash on first successful login to
the chosen Argon2/bcrypt format). No plaintext exists.

## 5. Evidence / file migration (broken-photo safe)

Legacy files live on the container filesystem under `DOCUMENT_ROOT` and are
referenced by `storage_key`. Migration flow per file:

```
DB record exists? + legacy file exists? + SHA-256 matches?
  -> upload object to S3 (opaque key)
  -> verify object
  -> create/update new metadata (objectKey)
```

- Missing legacy files are reported; never fabricated.
- Hash mismatches are quarantined and reported.
- A migration report records success/failure per file.
- Reconciliation tooling detects (a) object with no DB metadata and
  (b) DB metadata with no object.

## 6. Ordering

1. Seed `County` → `Subcounty` → `Ward`.
2. Users + roles + capabilities + assignments.
3. Employees (+ ward assignment).
4. Attendance sessions + attendance.
5. Absences (unify legacy tables).
6. Work logs + details + operations.
7. Evidence (photos) + documents via §5 flow.
8. Reports + report evidence.
9. Reminder deliveries + audit events.
10. Verification queries + report.

## 7. Verification

- Row counts per table match source.
- Foreign keys resolve; scope columns populated.
- Cross-tenant isolation tests pass post-migration.
- A sample of evidence downloads and hashes correctly.
- Reports render identically to legacy snapshots.

## 8. Rollback

Migration is idempotent and run against a copy. Original filesystem and
database are preserved until verification completes. Rollback restores the
pre-migration copy.
