# MazingiraOps

Multi-ward environment operations platform, deployed first for Makina Ward → Kibra Subcounty → Nairobi City County. It combines QR attendance, staff records, leave and sick-off evidence, field work documentation, immutable report generation, controlled AI assistance, and an appraisal-ready report archive.

This is a pnpm monorepo:

| Workspace | Technology |
| --- | --- |
| `apps/web` | Next.js (App Router), React, TypeScript |
| `apps/api` | NestJS + Fastify, TypeScript |
| `packages/contracts` | shared domain enums and API contract types |
| `packages/validation` | shared Zod schemas |
| `packages/database` | Prisma schema, migrations, generated client, seed |

Deployment definitions live under [`infrastructure/`](infrastructure/), design and ADR documentation under [`docs/`](docs/), and operational tooling under [`scripts/`](scripts/).

## Main Features

### Staff and access management

- One-time system owner setup using API-side bootstrap credentials with a mandatory first-login password change, or `/setup` with a private `OWNER_SETUP_TOKEN`.
- Visitor access requests at `/register`, approved or rejected by the owner under **User access**.
- Owner-controlled access with scoped roles (system admin, ward officer, subcounty reviewer, HR viewer, read-only).
- Read-only benchmark accounts cannot create, change, approve or export operational records.
- Revoke or restore an account at any time; revocation ends active sessions immediately.
- Staff creation, correction, deactivation, and reactivation without deleting historical records.
- Excel/CSV roster imports that update existing Employee IDs and add new staff.

### Attendance and leave

- Expiring daily QR attendance sessions with duplicate check-in prevention, late classification, and optional GPS capture.
- Employee verification using the exact 11-digit, year-prefixed Employee ID.
- Audited manual exceptions for staff who remain absent after QR check-in.
- Date-based attendance and check-in history with daily staff report generation.
- Planned leave schedules with 30-, 14-, and 7-day reminder processing.
- Approval and rejection workflows for leave and sick-off records.
- Private uploads for sick sheets, medical certificates, leave forms, approvals, and return-to-work forms.

### Field operations and reports

- Daily work descriptions, areas/roads, trip counts, staff counts, and challenges.
- Up to four before, four during, and four after photos per work log.
- Review and approval workflow before work appears in final reports.
- Daily, weekly, monthly, and custom report periods with deterministic aggregation.
- Immutable finalised reports retained for appraisals and future reference.
- Print-to-PDF layout and Excel-compatible CSV export.
- Optional Groq AI narrative drafting with a local deterministic fallback.

## Technology

| Layer | Technology |
| --- | --- |
| Frontend | Next.js (App Router), React, TypeScript |
| Backend | NestJS + Fastify, TypeScript |
| Database | PostgreSQL via Prisma |
| Validation | Zod (shared schemas) |
| Object storage | S3-compatible (production) or local filesystem (dev/test) |
| Auth | scrypt password hashing, server-side sessions, CSRF protection |
| Deployment | Docker + Railway |

## Local Development

Requires Node 24 and pnpm 8.15.9, plus a PostgreSQL server.

```bash
pnpm install
pnpm db:generate
cp .env.example .env   # then fill in DATABASE_URL etc.
pnpm db:migrate        # or pnpm db:deploy against an existing database
pnpm db:seed
pnpm dev:api           # NestJS API on :4000
pnpm dev:web           # Next.js web on :3000
```

Open `http://localhost:3000`. First-time setup can use paired `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` values (the temporary password must be changed immediately after sign-in), or the interactive `/setup` flow with `OWNER_SETUP_TOKEN`.

## Environment Variables

See [`.env.example`](.env.example) for the complete list. Key variables:

```text
APP_ENV=development
DATABASE_URL=postgresql://ward_ops:ward_ops@localhost:5432/ward_ops
OWNER_SETUP_TOKEN=<random one-time token for /setup>
BOOTSTRAP_ADMIN_EMAIL=<initial administrator email>
BOOTSTRAP_ADMIN_PASSWORD=<temporary password; configure on the API only>
PUBLIC_BASE_URL=https://your-web-domain.example.go.ke  # required in production for QR links
S3_BUCKET=             # required in production, along with S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
SECURE_COOKIES=true    # required in production
```

Production refuses to start without an HTTPS `PUBLIC_BASE_URL`, `SECURE_COOKIES=true`, and complete S3 configuration, so QR links remain usable and evidence is never silently written to the container filesystem.

## Tests

```bash
pnpm lint
pnpm typecheck
pnpm test              # unit tests
TEST_DATABASE_URL=postgresql://ward_ops:ward_ops@localhost:5432/ward_ops_test \
  pnpm --filter @ward-ops/api test:integration   # integration tests (requires PostgreSQL)
```

## Railway Deployment

See [docs/RAILWAY.md](docs/RAILWAY.md) for the complete deployment and first-run checklist.

## Health Checks

```text
GET /health/live
GET /health/ready
```

Readiness verifies database connectivity and object-storage reachability.

## Security and Privacy

- Server-side sessions, secure cookies, CSRF protection, and capability-scoped authorization.
- Default-deny tenant isolation enforced server-side across staff, attendance, absence, work logs, evidence, and reports.
- QR check-in verification attempts and login attempts are rate-limited.
- Sensitive uploads are stored in private object storage and served only through authorized routes.
- Medical files are restricted to authorised HR/owner roles.
- Operational changes, approvals, downloads, exports, and access decisions are audited.
- Finalised report snapshots are retained independently of later source-record edits.
- Spreadsheet values are escaped during CSV exports to reduce formula-injection risk.

Before entering real personnel or medical data, complete a Kenya Data Protection Act impact assessment, approve retention periods, configure encrypted backups, and confirm official branding and attendance rules.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Authorization model](docs/AUTHORIZATION_MODEL.md)
- [Domain model](docs/DOMAIN_MODEL.md)
- [Operations guide](docs/OPERATIONS.md)
- [Railway deployment](docs/RAILWAY.md)
- [ADRs](docs/adr/)

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
