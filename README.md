# StratOS

Work OS and AI CRM for digitally native businesses, sold white-label on a single subscription. One codebase, many
tenants (workspaces); each tenant's leads, calls, cadences and tickets are kept apart by Postgres row level security.

| Layer | Choice |
|---|---|
| App | Next.js 15 (App Router) on Vercel, Tailwind CSS v4, TypeScript, zod |
| Database | **Neon** Postgres via `pg`, raw SQL migrations, access enforced by row level security |
| Sign-in | **Better Auth** magic link; its tables live in the same database |
| Email | Resend behind an `EmailSender` interface (`EMAIL_PROVIDER=console` for local dev) |

Conventions follow the sister apps **DealGuard** and **myHR**: same shell, design tokens, fonts, `asUser`-style
transactions, API error shape and SQL test style. No ORM and no component library: components are hand-built Tailwind.

## What is built (Step 1)

- Schema for all five steps: tenants and members, industry templates, pipeline stages, scoring rules, leads, score
  history, interactions, tickets, cadences and steps, enrolment state, dispatch log, erasure requests, inbound
  webhook endpoints, AI usage metering and the AI tool-call audit (`db/migrations/0002_stratos_core.sql`).
- Onboarding: name, address, industry, data protection laws, region. `stratos.create_tenant()` makes you the owner and
  seeds stages, a starter cadence and scoring weights for the industry.
- Leads list (sorted by conversion probability), new lead form (phones saved as E.164), lead page with stage, status,
  consent and score history, pipeline board with weighted value, dashboard, read-only settings.
- Workspace switcher for people in more than one workspace.
- `src/lib/pii/mask.ts`: masking for logs and AI calls (email, phone, Aadhaar, PAN, UPI, IBAN, card, SSN, URL tokens;
  dates of birth and MRNs in strict / HIPAA mode).

## Lead sources and scoring (Step 2)

- `POST /api/v1/webhooks/inbound/website?t=<key>`: JSON or form data from any website form (CORS open, honeypot field
  `website`). `/google`: Google Ads lead form webhook, authenticated by `google_key`. `/meta`: Facebook and Instagram
  Lead Ads, signed by Meta (`X-Hub-Signature-256`); the lead is fetched from the Graph API and routed by page id.
- Admins connect sources at Settings > Lead sources; the key is shown once and only its hash is stored. A source can
  start a follow-up cadence, which only happens for people who gave consent and never for Google test leads.
- A form from someone already in the workspace (same email or phone) is added to their lead and scores
  "Enquires again" instead of making a duplicate. Meta and Google retries are de-duplicated by lead id.
- Starting scores per channel and the event points are editable at Settings > Lead scoring.
- `GET /api/cron/decay` (Vercel Cron, daily, `Authorization: Bearer $CRON_SECRET`) takes points off leads idle for
  48 hours. Google Business Profile has no lead webhook any more, so Google leads come from Ads lead forms.

Next: TeleCMI and call sentiment (Step 3), the cadence worker (Step 4) and
the AI sidebar (Step 5). The plan is in the project's "StratOS build plan" doc.

## How tenancy and access work

The app connects as the database owner. Every signed-in request opens a transaction that runs
`set local role stratos_app` and sets `app.user_id` (the Better Auth user) and `app.tenant_id` (the workspace picked
in the UI, kept in the `stratos.tenant` cookie). `stratos.current_tenant_id()` returns that tenant **only if the user is
an active member of it**, so a forged cookie resolves to no tenant and every policy hides every row.

- `tenant_id` is stamped from the session by trigger and can never change. Child tables use composite foreign keys
  `(id, tenant_id)`, so no row can point into another tenant.
- Roles: owner, admin, sales_rep, support_agent, viewer. Viewers read only; owners and admins change settings.
- Users cannot write scores. `conversion_probability` moves only through `stratos.apply_score()` and triggers
  (calls, replies, sentiment, inactivity, stage floors), and every change is logged in `score_events`.
- Users cannot delete leads. Setting consent to "Erasure requested" stops all messages and queues an erasure request;
  the purge worker hard-deletes the lead and its history and keeps only a SHA-256 hash as proof.
- Cadence stop rules (open ticket, reply, negative sentiment, unsubscribe, consent withdrawn) live in Postgres, so no
  code path can message a lead who should not be messaged. Resolving the last open ticket resumes at the same step.
- Webhooks, cron workers and migrations use `asService()` (owner, no RLS) and must always filter by `tenant_id`.

## Setup

1. Create a Neon project. Copy the pooled connection string to `DATABASE_URL` and the direct one to
   `DATABASE_URL_UNPOOLED`.
2. `cp .env.example .env.local`, fill it in, `npm install`, `npm run db:migrate`.
3. Resend: verify your sending domain, create an API key, set `RESEND_API_KEY` and `EMAIL_FROM`.
4. Meta (for Lead Ads): in a Meta app with the `leads_retrieval` and `pages_manage_metadata` permissions, subscribe
   the Page webhook `leadgen` field to `<site>/api/v1/webhooks/inbound/meta` with `META_VERIFY_TOKEN`, and set
   `META_APP_SECRET` and a system user token in `META_SYSTEM_USER_TOKEN`.
5. Vercel: import the repo, add the variables from `.env.example`, deploy. `NEXT_PUBLIC_PRODUCT_NAME` sets the
   white-label name.
6. Open the app, sign in with your email, and create your workspace.

Local development: `EMAIL_PROVIDER=console` prints sign-in links in the terminal. `npm run dev`.

Database checks (any Postgres 15+): `PGHOST=... PGPORT=... PGUSER=postgres npm run test:db`.

## Directory map

```
db/
  migrations/0001_auth.sql          Better Auth tables
  migrations/0002_stratos_core.sql  StratOS schema, triggers, RLS, industry templates
  tests/run.sh, stratos_rls_test.sql
scripts/migrate.mjs                 npm run db:migrate
src/
  middleware.ts                     sign-in redirect (session cookie check)
  app/
    login, onboarding               sign-in and workspace setup
    (app)/dashboard, leads, leads/new, leads/[id], pipeline, settings
    api/auth/[...all]               Better Auth endpoints
  components/shell, leads           shell, workspace switcher, badges and score bar
  lib/
    db.ts                           pg pool, asTenantUser() / asService()
    tenant.ts                       getMe() for pages, requireMember() for actions and routes
    leads/                          zod schema, E.164 phones, SQL repository
    stratos/types.ts                enums and labels mirrored from the migration
    pii/mask.ts                     PII masking
```
