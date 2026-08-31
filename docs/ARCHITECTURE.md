# Architecture — Multi-Ward Operations Platform

Status: **Phase 0 proposal** (awaiting review).

This document defines the target architecture for the rewrite. It follows
`projectredefine.md` and freezes the technology stack.

## 1. Goals

- Makina Ward is the **first** organisational scope, not a hard-coded
  assumption.
- One deployment supports Makina Ward → Kibra Subcounty → other subcounties →
  Nairobi City County without per-ward databases or deployments.
- Default-deny, server-enforced tenant isolation.
- Evidence (photos/documents) survives redeployment via private object storage.

## 2. Stack (frozen)

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), React, TypeScript |
| Backend | NestJS with Fastify adapter, TypeScript |
| Database | PostgreSQL |
| ORM | Prisma (schema, migrations, typed client) |
| Supporting cache | Redis (optional; never authoritative) |
| Validation | Zod (shared contracts) + NestJS DTO where useful |
| Storage | S3-compatible object storage (private) |
| Deployment | Docker + Railway |
| Repo | Monorepo (one repo, clear app/package boundaries) |

## 3. Boundaries

```
Next.js   = presentation (rendering, interaction, forms)
NestJS    = authoritative business logic (auth, tenancy, attendance, staff,
            absences, work logs, evidence, approvals, reports, audit,
            notifications, storage orchestration)
PostgreSQL = structured source of truth
S3        = binary evidence (private)
Redis     = optional short-lived cache and distributed rate-limit counters
```

No business logic is duplicated in Next.js. Prisma models are never exposed
directly as public API contracts.

## 4. Repository structure (proposed)

```text
ward-ops/
├── apps/
│   ├── web/          # Next.js App Router
│   └── api/          # NestJS + Fastify
├── packages/
│   ├── contracts/    # shared TypeScript contracts (enums, DTO shapes, errors)
│   ├── validation/   # shared Zod schemas
│   ├── database/     # generated Prisma client + schema (single source)
│   └── config/       # environment validation + typed config
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── infrastructure/   # docker-compose, railway
├── docs/             # this Phase 0 set + ADRs
├── branding/         # approved NCC logo + canvas background
└── tests/            # e2e / shared fixtures
```

Only `contracts` and `validation` are justified initially; `database` and
`config` are split only if the boundary proves real.

## 5. Organisational hierarchy

```text
County (e.g. Nairobi City County)
   └── Subcounty (e.g. Kibra)
          └── Ward (e.g. Makina)
```

Names/branding are configuration/data, never hard-coded in logic.

## 6. Tenancy & authorization

- Every operational resource carries an organisational scope (ward/subcounty/
  county).
- `User` → `Assignment(role, scopeType, scopeId)`; a user may hold many
  assignments.
- Central capability model (`staff.read`, `attendance.manage`, …) combined
  with assignment scope.
- Default **DENY**. Client-supplied `wardId`/`subcountyId`/`countyId` are never
  trusted; they are validated against the authenticated user's assignments.
- Central guards/policies, not per-controller checks.

See `AUTHORIZATION_MODEL.md` and `DOMAIN_MODEL.md`.

## 7. API surface (v1)

```
/api/v1/auth/...
/api/v1/staff
/api/v1/attendance            # sessions, QR, check-in, manual
/api/v1/absence-requests
/api/v1/work-logs
/api/v1/reports
/api/v1/evidence
/api/v1/admin/...
/health/live
/health/ready
```

Consistent status codes, one error shape:

```json
{ "error": { "code": "WORK_LOG_INVALID_TRANSITION", "message": "..." } }
```

No GraphQL. No SQL/stack/secret leakage.

## 8. Authentication

Server-controlled browser auth (secure HttpOnly cookies) with:
scrypt/Argon2 hashing, session expiration, logout, revocation, password change,
account disabling, audit events, login throttling, CSRF protection.
No long-lived secrets in `localStorage`.

## 9. Evidence / storage pipeline

```
Phone → validation (signature, size, dimensions) → orientation normalization
→ resize → compression → S3 (private, opaque key) → metadata in PostgreSQL
```

- Opaque/random object keys; no permanent public URLs.
- Access via authorized application logic or short-lived signed URLs.
- Compensating cleanup on partial failure (no orphaned objects, no dangling
  metadata); lightweight reconciliation.

## 10. Reporting

```
PostgreSQL → deterministic aggregation → structured snapshot
→ optional AI narrative → human review → finalized immutable report
```

- One reusable aggregation engine for ward → subcounty → county.
- Finalized reports store immutable facts (evidence ID, object key, sha256,
  caption, stage, snapshot, narrative, recommendations, version, finalizedBy,
  finalizedAt, scope, period).
- AI never computes authoritative totals.

## 11. Background processing

Application-level scheduled tasks only (leave reminders, cleanup,
reconciliation). Redis is available as optional shared infrastructure, but no
queue framework is introduced yet. The notification interface and singleton
Redis client allow a queue to be added later without moving durable state out
of PostgreSQL.

## 12. Observability & security

- Structured logs, request correlation ID.
- `/health/live` + `/health/ready` (ready verifies DB + object storage and
  reports optional Redis independently without failing readiness).
- Security headers (CSP, X-Content-Type-Options, frame restrictions,
  Referrer-Policy, Permissions-Policy, HSTS after HTTPS verified).
- Secrets from environment; validated at startup; fail clearly.

## 13. Deployment topology

```
Railway project
├── web (Next.js)
├── api (NestJS + Fastify)
└── PostgreSQL
External: S3-compatible object storage
```

No Kubernetes, no service mesh, no microservices.

## 14. Branding

The approved `nairobi-city-county-logo.png` replaces the placeholder "NCC"
text seal across the login/setup/register/check-in screens, the dashboard
sidebar, all reports, CSV/print exports and QR sign-in. The approved
`nairobi-green-corridor.png` is the persistent application background canvas.

See `BRANDING.md`.

## 15. Implementation phases

Follow `projectredefine.md` §59. Phase 0 (this document set) must be approved
before any production code. Each subsequent phase is implemented, linted,
type-checked, unit-tested, integration-tested, E2E-tested where applicable,
security-verified, documented, and reported as a checkpoint.
