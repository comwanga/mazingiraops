# Operations Guide

## Daily workflow

1. Sign in and generate the day's attendance QR with activity, location and closing time.
2. Display the QR at the work site. Use supervised check-in only when necessary and record the reason.
3. Review unaccounted staff. For staff who did not use the QR, record an audited supervised-present, confirmed-absent, or off-duty exception.
4. Record areas or roads covered, number of trips, staff count, equipment used, cleanup stakeholders and challenges.
5. Mark work complete or incomplete, then select up to four before, four during and four after photos from the phone gallery or camera.
6. Have an authorised reviewer approve requests and work logs.
7. Review the AI-assisted narrative and recommendations, then sign and archive the daily report.

## Weekly and monthly reports

Open Reports, choose the period and preview it. Daily reports contain all attached field photos. Weekly and monthly reports contain a balanced sample of up to four before, four during and four after photos from the period. Reports also include recommendations, the owner's full name, and generation date/time. Finalised reports are immutable archived snapshots for appraisal and future reference.

Use the date and status filters in **Daily attendance register** to review check-ins, absentees, leave, sick-off, and other statuses. After the register closes, generate and finalize the daily report; its immutable attendance snapshot remains in **Report history**, where it can be reopened by reporting date and authorized area.

## Staff roster

Upload the official Excel list under **Staff register**. The Employee ID must be 11 digits and start with the four-digit year, for example `20230464669`. Staff check in with the exact Employee ID saved in the register; phone numbers are not used for check-in verification. Existing IDs are updated. Correct typing errors or change a returning employee from **Annual leave** to **On duty** with **Edit**, and use **Deactivate** rather than deleting former staff.

## User access

Under **User access**, the owner approves sign-ups and picks the areas each account can open: attendance, staff register, daily work, leave and sick-off, reports, and audit history. A benchmark visitor who is not granted the staff register will see an access-denied message and can submit a request for that area, which appears in the approval queue. When a user has finished accessing the system, use **Revoke access** to disable the account and end all active sessions immediately. Use **Restore access** if they need to come back later.

## Scanned forms

Under **Leave & sick-off**, scan or upload sick sheets, medical certificates, leave forms, approvals and return-to-work forms. These files remain private to authorised HR/owner roles.

## Leave reminders

The application checks reminders at startup and hourly. It creates at most one delivery per request and reminder offset. Without SMTP configuration, reminders remain marked `queued`; no email is falsely reported as sent.

## Backup

- Back up PostgreSQL daily using the hosting provider's encrypted backup facility or `scripts/backup.sh`.
- `scripts/backup.sh` writes `db.dump` (and, for local object storage, `documents.tar.gz`) into one timestamped directory.
- When evidence is stored in S3-compatible object storage (production), `scripts/backup.sh` backs up the database only and warns that the object store must be protected separately. Configure S3 versioning, snapshots, or the provider's backup facility for the evidence bucket — do not rely on `scripts/backup.sh` for S3 evidence.
- Keep database and object backups aligned because document metadata (object keys) is stored in PostgreSQL. Always restore them together.
- Run the synthetic recovery drill before pilot launch and at least quarterly:
  `DATABASE_URL=<scratch-db-url> pnpm recovery-drill` — builds packages, seeds reference data, loads synthetic operational data, backs up, destroys the database, restores, and verifies the restored data and evidence object.

### Object-storage lifecycle policy

The object store holds evidence files (photos and scanned documents) that are immutable attachments to work logs and finalised reports.

- **Retention**: evidence objects are retained indefinitely while the related work log or report remains in the system. Never delete evidence from the object store while its database rows exist, or report/evidence reads will fail.
- **Backup**: for local object storage, the document volume is backed up on the same daily schedule as the database, via `scripts/backup.sh`. For S3-backed storage, protect the bucket with versioning, snapshots, or the provider's backup facility on the same retention schedule. Copies must be encrypted at rest (S3 server-side encryption, or encrypted volume snapshots for local storage) and kept in a separate region/location from the primary store.
- **Lifecycle**: for S3-backed storage, configure a bucket lifecycle rule to move objects older than 365 days to a cost-optimised storage class (e.g. Glacier Instant Retrieval); do not expire objects automatically — deletion is only ever manual and coordinated with database cleanup.
- **Access**: bucket access is restricted to the API role via least-privilege policy; the bucket is private and objects are served only through the API's authenticated routes.

### Restore

`scripts/restore.sh <BACKUP_DIR> <TARGET_DATABASE_URL>` restores a database dump and extracts the document archive into the object-store root. Restore with the application stopped (or the volume mounted read-only) so the database and document set stay consistent. After restore, verify `/health/ready` and spot-check evidence reads on a couple of recent work logs.

## Incident response

1. Disable public access or stop the web service if confidential data may be exposed.
2. Preserve application, reverse-proxy and audit logs.
3. Revoke affected user sessions by changing account credentials; rotate database, SMTP and AI keys where relevant.
4. Determine affected people, records and dates.
5. Follow Nairobi City County and Office of the Data Protection Commissioner notification procedures.
6. Document remediation before restoring service.

## Monitoring

- `/health/live` checks the web process.
- `/health/ready` checks database connectivity and document storage.
- Alert on repeated readiness failures, HTTP 500 rates, low disk space, failed email deliveries and backup failures.
- Do not place phone numbers, medical reasons, tokens or document contents in logs.
