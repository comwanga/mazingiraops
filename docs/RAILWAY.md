# Railway Deployment

## Create the services

1. In Railway, create a project from the `comwanga/mazingiraops` GitHub repository.
2. Select `main` as the production branch and enable automatic deployments.
3. Create three services:
   - **api**: connects to the repository. `railway.json` builds `infrastructure/Dockerfile.api`, applies migrations and reference seed data in Railway's pre-deploy phase, starts the API on its assigned `PORT`, and checks `/health/ready` before promotion. Leave dashboard build/deploy command overrides empty so the checked-in configuration remains authoritative.
   - **web**: connects to the repository. Set its config-file path to `infrastructure/railway.web.json`. Add `API_INTERNAL_URL` as a build variable pointing to the API service's Railway private-network origin (for example `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}`; replace `api` if the service has a different name). The Next.js server proxies browser requests through the web origin.
   - **PostgreSQL**: add a Postgres service to the same Railway project.
4. Add the variables listed below to the api service.
5. Generate a public domain for the web service. An API public domain is optional because web-to-API traffic uses Railway private networking.
6. Add an S3-compatible object-storage service and wire the `S3_*` variables below. Production refuses to start without S3 configuration so evidence is never silently written to the ephemeral container filesystem.

## Required variables (api service)

```text
APP_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
PUBLIC_BASE_URL=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
SECURE_COOKIES=true
S3_BUCKET=<your S3 bucket>
S3_ACCESS_KEY_ID=<your S3 access key id>
S3_SECRET_ACCESS_KEY=<your S3 secret access key>
S3_REGION=<your bucket region>
OWNER_SETUP_TOKEN=<a separate random one-time token of at least 32 characters>
```

`PUBLIC_BASE_URL` must be the public **web** origin because attendance QR codes link to the web app's `/check-in/{token}` screen. It is required and must use HTTPS in production. If the web service is not named `web`, update the Railway variable reference accordingly. For a custom domain use:

```text
PUBLIC_BASE_URL=https://your-approved-domain.example.go.ke
```

The S3 credential must allow at least `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` and `s3:ListBucket` on the bucket. `s3:ListBucket` is required by both evidence reconciliation and the `/health/ready` storage probe, so a credential that only allows object operations will keep the deployment unhealthy.

`NEXT_PUBLIC_API_URL` remains supported for older deployments, but `API_INTERNAL_URL` is preferred because the API URL is consumed by the Next.js server-side proxy and does not need to be public.

> Railway has deprecated legacy Config as Code (`railway.json`) for removal on 1 December 2026. These files remain supported for the current deployment, but the project must migrate the two service definitions to Railway Infrastructure as Code before that date.

## First-time setup

After deployment, open `/setup` on the web domain, enter `OWNER_SETUP_TOKEN`, and create your permanent owner name, email and password. When setup completes, sign in with the account you just created. Remove `OWNER_SETUP_TOKEN` from Railway after setup and redeploy.

Visitors use `/register` to request access. They cannot sign in until an authorized reviewer approves them under **User access** and explicitly selects the role and scope. New accounts must change their password on first sign-in.

## Optional email variables

Leave reminders remain safely queued when SMTP is not configured.

```text
SMTP_HOST=<approved SMTP host>
SMTP_PORT=587
SMTP_USERNAME=<SMTP username>
SMTP_PASSWORD=<SMTP password>
SMTP_FROM=<approved sender address>
```

## Free Groq AI variables

Groq offers a rate-limited free plan suitable for light report drafting. Create an account at `https://console.groq.com`, open **API Keys**, and create a new key. Add the key only in Railway; never put it in GitHub or application source code.

```text
AI_ENABLED=true
AI_BASE_URL=https://api.groq.com/openai/v1
AI_API_KEY=<your Groq API key>
AI_MODEL=llama-3.1-8b-instant
```

The integration sends only the reporting period, attendance totals, and structured approved work facts: date, activity, location, quantity, unit and staff count. It excludes employee names, IDs, phone numbers, attendance rows, medical data, free-text descriptions and challenges. AI output is always a draft and must be reviewed before finalisation. If Groq is unavailable or a free-tier limit is reached, the application automatically produces its local non-AI narrative instead.

## Backup and object-storage lifecycle

- Configure Railway PostgreSQL backups before entering real staff data, or run `pnpm backup` on a schedule (see `docs/OPERATIONS.md`).
- Evidence objects live in the S3 bucket, not on the container filesystem. The database references them by key, so database and object-store backups must stay aligned.
- For S3, enable server-side encryption and a lifecycle rule that moves objects older than 365 days to a cost-optimised storage class. Do not expire objects automatically.
- Run the synthetic recovery drill quarterly: `DATABASE_URL=<scratch-db-url> pnpm recovery-drill` (see `docs/OPERATIONS.md`).

## First deployment checks

1. Open `/health/ready` on the api domain and confirm `{"status":"ready"}`.
2. Open the web domain and confirm it loads and reaches the API (sign-in page renders).
3. Open `/setup` on the web domain, complete owner setup with `OWNER_SETUP_TOKEN`, and sign in.
4. Generate an attendance QR and verify that its link uses the Railway or custom HTTPS domain.
5. Upload and download a synthetic medical document, redeploy, and confirm the file remains available from S3.
