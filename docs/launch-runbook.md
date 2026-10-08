# Launch runbook

The single document for taking HeavyCards from this repository to an open
production store. A new developer should be able to follow it without any
earlier conversation.

**Status (Milestone 15, 2026-10-03).** All repository work for launch is
complete. **No provider account exists yet**: Vercel, Neon, Stripe, Resend,
the domain and the production GitHub organisation are created later by the
store owner with the developer. Nothing in this document has been verified
against a production deployment; every live check is marked _pending_ until
someone performs it.

Related documents:

| Document                                           | Contents                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| [production-readiness.md](production-readiness.md) | Protections in the code, accepted limitations, incident runbooks, PII table |
| [store-operations.md](store-operations.md)         | Daily store operation for the owner (Swedish)                               |
| [architecture.md](architecture.md)                 | Design decisions per milestone (Milestone 15 at the end)                    |
| [database.md](database.md)                         | Schema, constraints, operational notes                                      |
| [routes.md](routes.md)                             | Routes, SEO and indexing policy                                             |
| [README](../README.md)                             | Local development, scripts, testing                                         |

Who does what:

- **Developer**: technical setup, deployments, migrations, verification.
- **Owner**: the HeavyCards business owner; owns and pays for every account.
- **Together**: needs the owner's account/decision and the developer's setup.
- **Accountant/legal**: decisions that need professional review.

The ordered checklist is in [section 21](#21-ordered-launch-checklist); the
blocker report in [section 22](#22-launch-blocker-report).

---

## 1. Production architecture

| Part          | Choice                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Hosting       | Vercel **Pro**, customer-owned team. Node.js 24.x (`engines`), functions in `fra1` (Frankfurt, `vercel.json`).               |
| Database      | Neon PostgreSQL, AWS **eu-central-1** (Frankfurt), next to the functions. Pooled URL for the app, direct URL for migrations. |
| Images        | Vercel Blob, a **public** store for Production only.                                                                         |
| Payments      | Stripe Hosted Checkout, SEK, Sweden; cards, Swish and Klarna where the account is eligible.                                  |
| Email         | Resend, sending from the store's own verified domain.                                                                        |
| Scheduled job | Vercel Cron every 15 minutes: `/api/cron/reconcile-checkouts` (payments, emails, housekeeping).                              |
| Domain        | Customer-owned; one canonical host in `APP_URL`.                                                                             |

Why Frankfurt: a checkout makes several sequential database round trips
inside transactions that lock product rows. With the database in Frankfurt
and functions in Vercel's default US region, every round trip would cross
the Atlantic and hold those locks longer. Neon has no Stockholm region; the
Vercel region and the Neon region must always be changed together.

### Environments

| Environment       | Vercel scope               | Database                                    | Stripe                     | Email                                  | Images                      |
| ----------------- | -------------------------- | ------------------------------------------- | -------------------------- | -------------------------------------- | --------------------------- |
| Production        | Production (branch `main`) | Neon production branch                      | **live** key, live webhook | Resend, production key                 | Production Blob store       |
| Staging           | Preview, branch `staging`  | Neon staging (never production data)        | test key, test webhook     | console, or Resend with a separate key | Separate preview Blob store |
| Other previews    | Preview                    | Staging database (shared)                   | test key                   | console                                | Preview store or none       |
| Local development | none (`.env.local`)        | Docker (`docker compose up -d`)             | test key or none           | console                                | `.storage/`                 |
| Tests, E2E, CI    | none                       | Docker / CI service (`*_test` for DB tests) | fake gateway (no Stripe)   | file / in-memory                       | `.e2e-storage/`             |

Rules enforced by the code: live Stripe keys only in Vercel production, and
a live key required there; the fake gateway, file email and local storage
are refused on Vercel; Resend is refused when `NODE_ENV=test`; the seed,
`migrate dev`/`migrate reset`/`db push` and the E2E suite refuse non-local
databases (sections 5 and 18). What the code cannot know (which database or
Blob store is production's) is enforced by scoping in Vercel: **never tick
"Preview" or "Development" for a production value.**

---

## 2. Account ownership and access

| Service                  | Owner (pays, holds the account)                  | Developer access                                       |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------ |
| Vercel                   | HeavyCards team on Pro, owner's billing          | Invited team member (own Vercel login)                 |
| Neon                     | HeavyCards organisation, owner's billing         | Invited organisation member                            |
| Stripe                   | HeavyCards' company account, payouts to its bank | Team member with the Developer role (own Stripe login) |
| Resend                   | HeavyCards account                               | Invited team member                                    |
| Domain and DNS           | Owner, at their registrar/DNS host               | DNS changes by the owner, or a delegated DNS user      |
| GitHub                   | HeavyCards organisation owns the repository      | Member with write access; Vercel connects to the org   |
| Customer-service mailbox | Owner's mail provider                            | Not needed                                             |

- Every person has their own login; never share a password where the
  provider has members or roles (all of the above do).
- Two-factor authentication on every account (Vercel, Neon, Stripe, Resend,
  GitHub, registrar, mail provider), preferably an authenticator app or
  security key. Stripe requires 2FA.
- Secrets live in the providers' own configuration (Vercel environment
  variables, Stripe/Resend/Neon consoles) and in a password manager. Never
  in chat, email, tickets, documents or the repository.
- When the developer leaves the project: remove their member access
  everywhere and rotate the secrets they have seen (section 19).

---

## 3. Environment variables

The authoritative list. Validation: `src/lib/env/schema.ts`; the template
with comments: [`.env.example`](../.env.example). In Vercel, mark every
secret as **Sensitive** and scope each value to exactly one environment.
Leave Vercel's "Development" scope empty: local development uses
`.env.local`.

| Variable                                                         | Production (Vercel)                                                                                                  | Preview / staging (Vercel)                                                      | Local development                      | Tests / E2E / CI                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------- |
| `APP_URL`                                                        | **Required.** `https://<canonical-host>`; https, no path; localhost, `*.vercel.app` and example/test domains refused | `staging` branch: its stable branch URL; other previews: unset (deployment URL) | unset (`http://localhost:3000`)        | `http://localhost:3100` (CI, Playwright)       |
| `DATABASE_URL`                                                   | **Required.** Neon production, **pooled**, `sslmode=verify-full` (TLS required)                                      | Neon staging, pooled. Never the production database                             | Docker (`.env.example`)                | Docker / CI service                            |
| `TEST_DATABASE_URL`                                              | —                                                                                                                    | —                                                                               | Docker, name ends in `_test`           | CI service, `_test`                            |
| `AUTH_SECRET`                                                    | **Required.** ≥ 32 chars, unique                                                                                     | Required, different value                                                       | Required, own value                    | CI: random per run                             |
| `REVIEW_LINK_SECRET`                                             | **Required.** ≥ 32 chars, unique, ≠ `AUTH_SECRET`                                                                    | Recommended, different value                                                    | Optional (falls back to `AUTH_SECRET`) | unset                                          |
| `REVIEW_LINK_SECRET_PREVIOUS`                                    | Only during a rotation (section 19)                                                                                  | —                                                                               | —                                      | —                                              |
| `STRIPE_SECRET_KEY`                                              | **Required.** Live restricted key `rk_live_…` (section 9)                                                            | Test key `rk_test_…`/`sk_test_…`; live refused                                  | Test key or unset                      | unset (fake gateway)                           |
| `STRIPE_WEBHOOK_SECRET`                                          | **Required.** `whsec_…` of the **live** endpoint                                                                     | `whsec_…` of the staging test-mode endpoint                                     | From `stripe listen`                   | Fixed local value (Playwright)                 |
| `CRON_SECRET`                                                    | **Required.** ≥ 16 chars                                                                                             | Own value (to call the job by hand; cron does not run on previews)              | Optional                               | Tests pass their own                           |
| `RESEND_API_KEY`                                                 | **Required.** Production sending-only key                                                                            | Separate key, only with `EMAIL_TRANSPORT=resend`                                | Optional test key                      | —                                              |
| `EMAIL_FROM`                                                     | **Required.** `HeavyCards <order@<verified domain>>`; `resend.dev` and example/test domains refused                  | Verified domain (with Resend)                                                   | Optional                               | —                                              |
| `EMAIL_TRANSPORT`                                                | unset (= `resend`; anything else refused)                                                                            | unset (= `console`) or `resend` for email checks                                | unset (= `console`)                    | `file` (Playwright); `resend` refused in tests |
| `BLOB_READ_WRITE_TOKEN`                                          | **Required.** Set by connecting the production Blob store to Production only                                         | From a separate preview store, or unset (uploads then show an admin error)      | unset (local files)                    | —                                              |
| `STORAGE_PROVIDER`                                               | unset (= `vercel-blob`; `local` refused)                                                                             | unset                                                                           | unset (= `local`)                      | `local` (Playwright)                           |
| `PAYMENT_GATEWAY`                                                | unset (`fake` refused)                                                                                               | unset                                                                           | unset                                  | `fake` (Playwright)                            |
| `SEED_ADMIN_PASSWORD`                                            | **Never**                                                                                                            | Never                                                                           | Local only                             | CI: random per run                             |
| `SEED_ALLOW_REMOTE_DATABASE`                                     | **Never**                                                                                                            | Never in Vercel; an operator shell only, naming the staging host                | —                                      | —                                              |
| `EMAIL_OUTBOX_DIR`, `STORAGE_LOCAL_DIR`, `FAKE_STRIPE_STATE_DIR` | refused / unused                                                                                                     | unused                                                                          | optional                               | Playwright                                     |
| `NODE_ENV`, `VERCEL_ENV`, `VERCEL_URL`                           | Set by Vercel/Next.js                                                                                                | Set by Vercel                                                                   | —                                      | —                                              |

There is no `NEXT_PUBLIC_*` variable and no publishable Stripe key: nothing
configurable reaches the browser. No `DIRECT_DATABASE_URL` either: the
direct URL is used only for migration commands run by hand (section 4).

**Generating secrets** (on the developer's machine; paste straight into the
Vercel field, never into a file or message):

```bash
openssl rand -base64 32   # AUTH_SECRET, REVIEW_LINK_SECRET (one run each)
openssl rand -hex 32      # CRON_SECRET (hex is safe in headers and curl)
```

**What production refuses** (the build fails, a running server answers 500):
any variable marked required above missing; `APP_URL` not https or a
localhost/`*.vercel.app`/example host; `DATABASE_URL` local or without
`sslmode=require|verify-ca|verify-full`; a test Stripe key; a placeholder
sender; `REVIEW_LINK_SECRET` equal to `AUTH_SECRET`; local storage, file
email or the fake gateway. Error messages name the variable, never the value.

Because of these rules the **first successful production build needs every
production value**, including the live Stripe key and the verified Resend
sender. Store-opening is controlled separately (section 14 and step 35).

---

## 4. Neon PostgreSQL

### Create (Developer, in the owner's Neon organisation)

1. Plan: a paid plan that allows disabling scale-to-zero and a restore
   window of at least **7 days** (Neon's "Launch" or higher; check current
   plan limits). A longer window (14–30 days) is better for an
   e-commerce database; the owner decides the cost.
2. Project `heavycards`, region **AWS Europe (Frankfurt) eu-central-1**,
   the newest Postgres major Neon offers as generally available (≥ 16;
   local and CI use 18).
3. Production branch (the default branch): database `heavycards`, the
   default owner role. Compute: autoscaling with a small minimum, **scale to
   zero disabled** (avoids cold starts on webhooks and the first visitor;
   the app's connection timeout is 5 s).
4. Restore window (history retention): ≥ 7 days.
5. Billing: spend/usage alerts to the owner and developer.
6. Staging: a **separate Neon project** (simplest isolation), or a branch
   created from the production branch **before any real data exists**. Never
   branch from production once it holds customers: the copy contains their
   personal data and would be reachable from preview deployments. Do not use
   the Vercel–Neon integration's automatic preview branches for the same
   reason.

### Connection strings

From the Neon console ("Connect"), for the production branch and role:

- **Pooled** (host contains `-pooler`): Vercel Production `DATABASE_URL`.
  Replace `sslmode=require` with `sslmode=verify-full` (same security in
  node-postgres, which treats both as verify-full, but without its
  deprecation warning). Production refuses a URL without an encrypting
  `sslmode`.
- **Direct** (no `-pooler`): only for migration commands, never stored in
  Vercel. Take it from the console when needed.

Why this works with the pooler (PgBouncer, transaction mode): every lock and
setting HeavyCards uses is transaction-scoped (`SELECT … FOR UPDATE`,
`pg_advisory_xact_lock`, `SET LOCAL`), and node-postgres uses unnamed
prepared statements. Each function instance keeps a small `pg` pool
(default 10); the pooler multiplexes them onto the compute's connections.
Prisma Migrate takes a session-level advisory lock, so it needs the direct
URL.

Access control: the connection string's password is the only credential.
Neon's IP allow-list is not practical with Vercel's changing addresses.
One role for app and migrations is accepted for V1 (a DML-only app role is
listed as optional in section 22).

### First migration (Developer)

From a clean checkout of the commit to be deployed, on a trusted machine,
with `npm ci` done. The URL is read without echo, so it stays out of the
shell history; the subshell forgets it afterwards (bash / Git Bash):

```bash
(
  read -rsp "Neon DIRECT URL (production): " DATABASE_URL && export DATABASE_URL && echo
  npm run db:deploy                 # prisma migrate deploy: applies all migrations
  npx prisma migrate status         # "Database schema is up to date!"
  npm run db:check                  # schema valid, no drift (read-only)
)
```

A fresh database then has every table and **no rows** (tested:
`tests/db/production-bootstrap.test.ts`); the first order number is
HC-10001.

### Later migrations (every release that contains one)

1. The migration is reviewed in the pull request and passes CI (which
   migrates a fresh database and checks drift).
2. Migrations must be backward compatible with the code currently running
   (add columns/tables first, remove old ones in a later release), because
   they are applied before the new code is live and an instant rollback
   returns the old code against the new schema.
3. Note the time (for a point-in-time restore), then run the block above
   against production **before** merging to `main`.
4. Merge; Vercel deploys. Check `/api/health` and the admin overview.

Never against production: `npm run db:migrate` (`migrate dev`),
`npm run db:reset`, `prisma db push`, `npm run db:seed`. All four refuse
non-local hosts, but do not rely on that.

### If a migration fails halfway

1. Do not deploy the new code. The running code still works if the
   migration was backward compatible.
2. `npx prisma migrate status` (direct URL) names the failed migration;
   `_prisma_migrations` holds its log.
3. Check which of its statements took effect (the schema in the Neon
   console or `psql`). Then either:
   - revert those partial changes by hand, mark it rolled back with
     `npx prisma migrate resolve --rolled-back <migration>`, fix the
     migration in a new commit and deploy it again; or
   - apply the remaining statements by hand and mark it applied with
     `npx prisma migrate resolve --applied <migration>`.
4. Last resort: a point-in-time restore to the time noted in step 3 above,
   followed by the reconciliation in section 19 ("Restore warning").

There is no automatic down-migration. Rolling back a schema change means a
new forward migration.

---

## 5. Production data and bootstrap

A production database receives **no seed data**. The development seed
(`npm run db:seed`) creates demo products, fictional orders and customers,
reviews, a redirect and `.test` administrators; it refuses:

- `NODE_ENV=production` or `VERCEL_ENV=production`;
- any non-local host, unless `SEED_ALLOW_REMOTE_DATABASE` names exactly that
  host (a bare `true` is no longer accepted, so an opt-in left in a shell
  cannot carry over to production);
- a remote database that has any administrator outside `.test` (a
  bootstrapped production database has its real OWNER).

What a fresh production database needs, in this order:

| Data             | How                                                                                                                  | Who       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- | --------- |
| Schema           | `npm run db:deploy` (section 4)                                                                                      | Developer |
| First OWNER      | `npm run admin:create-owner` (below)                                                                                 | Together  |
| Store settings   | `/admin/settings` → Spara inställningar (first save creates them; checkout answers "payment unavailable" until then) | Owner     |
| Categories, sets | `/admin/categories`, `/admin/sets`                                                                                   | Owner     |
| Products, images | `/admin/products`                                                                                                    | Owner     |
| Legal page texts | Code change after review (section 16)                                                                                | Together  |

Nothing else is required: order numbers, redirects and reviews start empty.

### First OWNER (Together, once)

Prerequisites: the production database is migrated; the owner is present
to type their own password; the developer's machine has a clean checkout
of the deployed commit with `npm ci`.

```bash
(
  read -rsp "Neon URL (production): " DATABASE_URL && export DATABASE_URL && echo
  npm run admin:create-owner -- --email "<owner's email>" --name "<owner's full name>"
)
```

- The owner types the password twice in the hidden prompt (≥ 12
  characters; use a password manager). It never appears on screen, in an
  argument, the shell history or a log. There is no default password.
- The command refuses when an active OWNER exists or the email is taken,
  validates the input, and writes the audit entry `BOOTSTRAP_OWNER`
  (`method: cli`).
- Without `DATABASE_URL` in the environment the command uses `.env.local`
  (the local database), so the success line alone proves nothing: always
  sign in on production afterwards.
- **Verify:** `https://<canonical-host>/admin/login`, sign in, open
  Översikt and Administratörer. Further staff are invited from
  Administratörer (ADMIN role, 72-hour single-use link).

On Windows use Git Bash for this block (PowerShell 5.1 has no hidden
single-line read).

---

## 6. Vercel project

All in the owner's Vercel team (Developer, with the owner for billing).

1. **Team and plan**: the owner creates the team, chooses **Pro**, adds
   billing, enables 2FA, invites the developer. Pro bills per member seat.
2. **Spend management**: a budget with email notifications to owner and
   developer. Do not enable automatic pausing: it would take the store and
   its webhooks offline.
3. **Repository**: transfer the repository to the owner's GitHub
   organisation first (or keep it and transfer later; Vercel then needs to
   be reconnected). Import it into the team. Framework preset Next.js.
4. **Build settings** (from the repository; check that nothing overrides
   them in the dashboard): install `npm ci` and region `fra1` from
   `vercel.json`; build `npm run build` (default); Node.js **24.x** from
   `package.json` `engines`; Fluid compute (default).
5. **Production branch**: `main`. Create a long-lived `staging` branch for
   the staging preview.
6. **Environment variables**: section 3, Production values scoped to
   Production only; staging values scoped to Preview with the Git branch
   `staging`; shared preview values to Preview.
7. **Deployment protection**: Standard Protection (Vercel Authentication)
   on previews, so staging and other previews are only visible to team
   members. For Stripe test webhooks to reach staging, create a
   **Protection Bypass for Automation** secret and add it to the staging
   webhook URL (section 9). Production custom domains stay public.
8. **Domain**: section 7. **Blob**: section 8. **Cron**: section 11.
   **Firewall**: section 12. **Logs and notifications**: section 13.
9. The first deployment fails until all Production variables exist; that is
   the intended fail-closed behaviour. After setting them: Deployments →
   Redeploy. A production build also needs the migrated database (pages are
   prerendered from it), and every preview build needs the staging database.

Cron jobs run only for the production deployment. Previews are noindex
twice: the application sends `X-Robots-Tag: noindex, nofollow` and a
`Disallow: /` robots.txt on every non-production deployment, and Vercel
marks preview URLs itself.

---

## 7. Domain and canonical host

The final domain is not known yet; nothing in the repository names it.
`APP_URL` is the only place it is configured, and it drives canonical URLs,
the sitemap and robots.txt, Open Graph, Stripe return URLs, every email
link, review links, admin invitation/reset links and the admin login's
origin check.

Steps (Together; DNS by the owner):

1. Decide the canonical host: apex (`heavycards.se`-style) or `www`. Choose
   once; changing it later costs SEO.
2. Vercel → Domains: add both the apex and `www`. Set the non-canonical one
   to **redirect (308) to the canonical one**.
3. Add the DNS records Vercel shows at the registrar; wait for HTTPS
   certificates (Vercel issues them automatically).
4. Set `APP_URL=https://<canonical-host>` for Production and redeploy.
5. The `<project>.vercel.app` production alias and deployment URLs: the
   application answers there with `X-Robots-Tag: noindex, nofollow` (any
   host other than `APP_URL`'s, Milestone 15), and every page's canonical
   names the real domain, so they cannot become duplicates even without a
   redirect. A redirect of the `.vercel.app` alias in Vercel is optional;
   if configured, check afterwards that the cron job still returns 200
   (section 11).
6. Stripe's webhook URL and Search Console use the canonical host exactly
   (Stripe does not follow redirects).
7. Verify (pending): section 15 checks 1–6.

HSTS: Vercel sends `Strict-Transport-Security` on HTTPS domains (check in
section 15). Do not add `includeSubDomains`/`preload` until every subdomain
of the domain serves HTTPS.

---

## 8. Vercel Blob

The application stores product images through `src/lib/storage`; on Vercel
the provider is Vercel Blob (local storage is refused there). Uploads go
through the validated pipeline (authorization first, 4 MB, magic-byte
format check, full decode, 40 MP limit, re-encode without metadata,
server-generated keys); deleting an image or a product deletes its objects.
The token stays server-side; images reach browsers through `/_next/image`
on the store's own origin. No manual Blob administration is needed for
normal operation.

Setup (Developer):

1. Storage → Create → Blob, name `heavycards-production`, **public**
   access, region close to the functions (Frankfurt if offered).
2. Connect it to the project for **Production only** (untick Preview and
   Development). Vercel then sets `BLOB_READ_WRITE_TOKEN` for Production.
3. A second store `heavycards-preview` connected to Preview only (or no
   store: previews then show "Bildlagringen är inte konfigurerad" on
   upload). A preview must never hold the production token: deleting a
   product on staging would delete production's photos.
4. Verify (pending): upload, reorder and delete an image on a product in
   production admin (section 18 C); the image shows on the product page.

Only clean-up case: `[storage] product image objects could not be deleted`
in the logs (see production-readiness.md → Storage failures).

---

## 9. Stripe

### Account (Owner, start early)

1. Create the Stripe account for the HeavyCards company (Sweden), complete
   activation/verification (company details, representative, BankID-style
   identity checks as Stripe asks), and add the **company bank account** for
   SEK payouts. Payout schedule: owner's choice.
2. Public business details: statement descriptor (e.g. `HEAVYCARDS`),
   support email and phone, website `https://<canonical-host>`.
3. Team: invite the developer with the **Developer** role; every staff
   member who issues refunds gets their own login (never a shared one).
   2FA is mandatory.
4. Customer emails from Stripe (Settings → Customer emails): HeavyCards
   sends its own Swedish order confirmation; whether Stripe also sends its
   receipt is the owner's choice.

### Payment methods (Together; test mode first, then live)

Settings → Payment methods (the default payment method configuration):
enable **Cards**, **Swish** and **Klarna** if Stripe offers them to the
account. HeavyCards lists no methods in code: Checkout shows what is
enabled and eligible for each session (SEK, Swedish address). Wallets
(Apple Pay, Google Pay) are card payments and work in hosted Checkout;
turn off any method the owner does not want. Eligibility for Swish and
Klarna is decided by Stripe, not by this project.

Fixed in code: currency SEK; shipping country Sweden only; Swedish Checkout
locale; phone number collected; the flat shipping rate from store settings;
VAT-inclusive prices (no Stripe Tax); sessions expire after 40 minutes (`CHECKOUT_SESSION_TTL_MS`); return URLs `https://<canonical-host>/kassa/bekraftelse` and
`/kassa/avbruten` built from `APP_URL` (nothing to configure in Stripe).

### Keys (Developer)

Use a **restricted key** (Developers → API keys → Create restricted key),
named `heavycards-production`, with:

| Resource          | Permission | Used for                                        |
| ----------------- | ---------- | ----------------------------------------------- |
| Checkout Sessions | Write      | create, expire, retrieve, list by PaymentIntent |
| PaymentIntents    | Read       | payment state (expanded on the session)         |
| Charges           | Read       | payment time (expanded latest charge)           |
| Refunds           | Read       | refund synchronisation                          |

Create the same in test mode first and run section 18 B with it: if Stripe
needs another permission for inline prices or shipping rates, checkout
fails with a `[checkout] creating the Stripe session failed` log line whose
error type is `StripePermissionError`; add exactly that permission. If a
restricted key cannot be made to work, a standard secret key is acceptable
(it is still only in Vercel Production).

The live key goes into Vercel **Production** only. The test key goes into
Preview and local `.env.local`.

### Webhook endpoints (Developer)

| Mode | URL                                                                                          | Secret goes to                            |
| ---- | -------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Live | `https://<canonical-host>/api/stripe/webhook`                                                | Vercel Production `STRIPE_WEBHOOK_SECRET` |
| Test | `https://<staging-branch-url>/api/stripe/webhook?x-vercel-protection-bypass=<bypass secret>` | Vercel Preview (branch `staging`)         |

Developers → Webhooks → Add endpoint: events from **your account**,
**snapshot** payload, API version **`2026-09-30.endive`** (the version the
code pins in `src/server/checkout/stripe-gateway.ts`), and exactly these
events (`HANDLED_EVENT_TYPES` in `src/server/payments/webhook.ts`; a unit
test keeps this list in sync):

<!-- stripe-webhook-events:start -->

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `charge.refunded`
- `refund.created`
- `refund.updated`
- `refund.failed`

<!-- stripe-webhook-events:end -->

Copy the endpoint's signing secret (`whsec_…`) into the matching Vercel
scope and redeploy. The endpoint verifies the signature over the raw body
(5-minute tolerance), stores processed event IDs, and re-reads the session
from Stripe's API before changing anything. Stripe retries failed
deliveries for up to three days.

### Refunds

Refunds are made only in the Stripe Dashboard (no refund button in
HeavyCards). The `refund.*`/`charge.refunded` events update the order to
PARTIALLY_REFUNDED or REFUNDED within seconds; only refunds Stripe reports
as succeeded count; stock never changes automatically. Owner's procedure:
[store-operations.md](store-operations.md).

### Live activation

Live keys exist once the account is activated, and the first production
build needs them (section 3). Accepting real payments starts only when the
store opens: until then the Firewall rule of section 14 blocks new
checkouts. Never test with live cards outside the controlled live test
(section 18 D).

---

## 10. Resend

What the code sends: the order confirmation (after verified payment) and the
shipping email (on SHIPPED, with tracking and review link) through the
outbox (`email_deliveries`, retries with backoff, Resend idempotency keys
`order-confirmation/<order id>` and `order-shipped/<order id>`), plus admin
invitations and password resets. Sender: `EMAIL_FROM`. Reply-To: the store
settings' customer-service email. Swedish, text-based HeavyCards layout; no
images or tracking pixels are loaded from anywhere.

Setup (Together; DNS by the owner):

1. **Owner**: Resend account for HeavyCards, 2FA, developer invited. Check
   the plan's daily and monthly sending limits against the expected order
   volume (up to two emails per order plus admin emails).
2. **Dev**: Domains → Add domain. Either the store's domain or a sending
   subdomain such as `mail.<domain>` (keeps the store's main mail
   reputation separate; `EMAIL_FROM` must then use that subdomain). Choose
   the EU region if Resend offers one.
3. **Owner** at the DNS host: add exactly the records Resend shows: DKIM
   (TXT), SPF (TXT and MX on Resend's return-path subdomain, so an existing
   SPF record for the mailbox provider is not replaced). Recommended DMARC
   on the domain: `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:<owner's mailbox>`,
   tightened to `p=quarantine` after reviewing reports. Keep a single DMARC
   record if the mail provider already created one.
4. Wait until Resend shows the domain as **Verified**.
5. **Dev**: API Keys → Create, permission **Sending access**, restricted to
   that domain, name `heavycards-production` → Vercel Production
   `RESEND_API_KEY`. A separate key (or none) for staging.
6. **Dev**: `EMAIL_FROM` = `HeavyCards <order@<verified domain>>` in Vercel
   Production. The address needs no mailbox; replies go to the Reply-To.
7. **Owner**: Inställningar → Kundtjänstens e-post = the real, monitored
   customer-service mailbox. It is the Reply-To of order emails and is shown
   in the footer and in every email.
8. **Together**, on staging (section 18 B): a controlled order confirmation
   and shipping email to team mailboxes on Gmail (web and app), Outlook and
   Apple Mail. Check layout, Swedish text, totals, links to the canonical
   domain, inbox (not spam) placement, and in the message source
   `spf=pass`, `dkim=pass`, `dmarc=pass`.
9. Resend → Settings: the log/data retention the owner wants (emails
   contain names and addresses).

Still refused by the code: any transport other than Resend in production;
`resend.dev`, example and `.test`/`.invalid` senders in production; Resend
in test runs (`NODE_ENV=test`). Local development logs emails (console),
E2E writes them to files. No real email is sent from this repository's
tests.

Bounces after Resend accepted an email are visible only in Resend: when a
customer reports a missing email, look it up there (the order page shows
the Resend ID).

---

## 11. Cron and reconciliation

`vercel.json` schedules `GET /api/cron/reconcile-checkouts` at
`*/15 * * * *` (Vercel Pro; Hobby would only allow daily, which the
reconciliation design does not accept). Each run has three independent
steps in their own error boundaries: payment reconciliation (overdue Stripe
checkouts, lapsed provisional holds), the email outbox (pending and
retryable order emails), and housekeeping (expired rate-limit rows, raw
IPs, sessions). A failure in one never stops the others.

Protection: Vercel sends `Authorization: Bearer $CRON_SECRET`; the route
compares it in constant time and answers 401 to anything else, including
when no secret is configured. Tested in `tests/db/payments.test.ts` (no
header, wrong secret, missing Bearer, unconfigured) and
`tests/db/transactional-email.test.ts` (an email outage does not stop
payments and vice versa); `tests/unit/deployment-config.test.ts` pins the
schedule.

Verify after launch (pending):

1. Project → Settings → Cron Jobs: one job, every 15 minutes.
2. Its logs show `200` responses every 15 minutes with a JSON summary
   (`checked`, `outcomes`, `emails`, `housekeeping`).
3. `curl -s -o /dev/null -w "%{http_code}\n" https://<canonical-host>/api/cron/reconcile-checkouts`
   → `401`.
4. A `500` means one step failed (the others ran): search the runtime logs
   for `reconciliation run failed`, `scheduled email run failed` or
   `housekeeping failed`. A `503` means Stripe is not configured.

Staging has no cron; run the job by hand when testing:
`curl -H "Authorization: Bearer <staging CRON_SECRET>" -H "x-vercel-protection-bypass: <bypass secret>" https://<staging-branch-url>/api/cron/reconcile-checkouts`.

---

## 12. Vercel Firewall and abuse protection

**Already in the application** (production-readiness.md §1): per-IP
PostgreSQL-backed limits on admin sign-in (10/5 min), password reset,
checkout creation (15/10 min), open unpaid checkouts (3 per client, 30
units), review page/submission, image upload (authenticated, 4 MB);
bounded request bodies; Stripe signatures; cron secret. On Vercel the client
IP comes from `x-forwarded-for`, which Vercel sets itself.

**To configure in Vercel** (Developer; start every rule in **Log** mode for
a week, then enforce):

| Rule                                        | Condition                                                                                                         | Action                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| DDoS mitigation                             | automatic on every plan                                                                                           | keep                                                                                  |
| Exceptions (create first, highest priority) | path `/api/stripe/webhook` or `/api/cron/reconcile-checkouts` or `/api/health`                                    | **Bypass** later rules: Stripe, Vercel Cron and uptime checks cannot solve challenges |
| Checkout flood                              | `POST /api/checkout`, rate limit ~30 requests / 60 s per IP                                                       | 429 (deny)                                                                            |
| Login and reset probing                     | `POST /api/auth/sign-in/email`, `/api/auth/request-password-reset`, `/api/auth/reset-password`; ~20 / 60 s per IP | 429                                                                                   |
| Review token probing                        | path starts with `/review/`; ~60 / 60 s per IP                                                                    | 429                                                                                   |
| Expensive reads                             | `/api/cart`, `/sok`; ~120 / 60 s per IP                                                                           | 429                                                                                   |
| Obvious scanners (optional)                 | paths like `/wp-admin`, `/wp-login.php`, `/.env`, `/.git`                                                         | deny                                                                                  |
| Bot protection managed ruleset              | non-browser traffic; verified search bots stay allowed                                                            | Log first; challenge only if abuse appears                                            |
| Attack Challenge Mode                       | only during an active attack                                                                                      | temporary; check Stripe webhook deliveries while on                                   |

The thresholds are deliberately loose: Swedish mobile networks, offices and
households share IP addresses, and the application already enforces the
real limits. No CAPTCHA is added. Vercel BotID on `/api/checkout` is the
next step only if distributed hold abuse is actually seen
(production-readiness.md §3).

---

## 13. Monitoring and alerts

Lightweight by design: what already exists, plus provider notifications.

| Signal                   | Where it shows                                                                                                                                                    | Who / when                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Payment needs attention  | Admin Översikt → **Kräver åtgärd**; the order page                                                                                                                | Owner, daily                       |
| Order email failed       | Kräver åtgärd (`EMAIL_NEEDS_ATTENTION`); "E-post i kö"                                                                                                            | Owner, daily                       |
| Cron not running         | Översikt "E-post i kö – Väntar på nästa schemalagda körning" (> 30 min overdue); Vercel Cron Jobs logs                                                            | Owner daily; developer weekly      |
| Refunded but not closed  | Översikt "Återbetalda, ej avslutade"                                                                                                                              | Owner                              |
| Deployment/build failure | Vercel notifications (email) for failed production deployments                                                                                                    | Developer                          |
| Runtime errors, 5xx      | Vercel Logs (filter: level error; `[payments]`, `[email]`, `[checkout]`, `[security]`, `[storage]`, `[auth]`); Observability                                      | Developer, on alert and weekly     |
| Stripe webhook failures  | Stripe Dashboard → Webhooks → endpoint deliveries; Stripe emails the account when an endpoint keeps failing (keep the developer's address on those notifications) | Developer                          |
| Database outage          | `/api/health` → 503; uptime monitor; Neon console                                                                                                                 | Uptime monitor → developer + owner |
| Spend                    | Vercel spend management, Neon billing alerts, Resend usage                                                                                                        | Owner                              |

Required at launch: Vercel deployment notifications, Stripe webhook failure
notifications, an **uptime check** of `https://<canonical-host>/api/health`
every few minutes with email/SMS to the developer and owner (any free
uptime service is enough; it only needs the URL), and the owner's daily
look at Översikt.

Optional later: an error-monitoring service, a log drain for longer
retention (exclude `/review/`, `/admin/reset-password` and `/admin/invite`
paths, or keep the drain inside the same trust boundary), a cron heartbeat.

Do not alert on `Error: The destination stream closed early.` (digest
`3069055589`): a visitor leaving mid-navigation, logged by Next.js
(production-readiness.md §6).

---

## 14. Checkout emergency stop (and the pre-opening gate)

To stop **new** checkouts at once without touching payments in flight:

1. Vercel → Firewall → Custom rule "Kassan stängd": **Request path equals
   `/api/checkout`** and **method `POST`** → **Deny**. Publish. It applies
   within seconds, without a deployment.
2. Customers who press "Till kassan" see "Det gick inte att starta
   betalningen. Försök igen."; browsing, carts and admin keep working.
3. Unaffected on purpose: the Stripe webhook, the cron job, "Kontrollera
   med Stripe igen" and refunds. Checkouts already open at Stripe can still
   be paid until their session ends (40 minutes); their stock stays reserved and
   they finalize normally. If those must not complete (e.g. a wrong price),
   refund them afterwards in Stripe.
4. Resume: disable the rule.

Do **not** stop checkouts by removing Stripe keys or the webhook secret
(production then refuses to start: the whole store and its webhooks fail),
by deleting the webhook endpoint (paid orders would wait for the cron), by
archiving products, or by pausing the project.

The same rule keeps the store closed between the first production
deployment and opening day (products can be published and checked while
nobody can buy). For the controlled live test (section 18 D), add a
condition "and IP address is not `<tester's IP>`".

---

## 15. Production security verification

**Automated (run on every CI build, no deployment needed):** exact CSP,
COOP, Referrer-Policy, frame and nosniff headers on storefront pages, admin
nonce CSP (`e2e/security.spec.ts`); `no-store`, `noindex` and `no-referrer`
on admin, checkout-return and review pages; zero CSP violations while the
store and admin are used; generic error responses (broken JSON, client
totals, forged webhook signature, cron without secret, unauthenticated
upload, path traversal, sign-up); webhook signature tests and cron auth
(DB tests); environment rules (`tests/unit/lib/env/schema.test.ts`); robots
and deployment noindex rules, including the non-canonical host rule
(`tests/unit/lib/seo.test.ts`); **no server secret in the served build
output** (`e2e/build-output.spec.ts`).

**Live checks (pending until production exists):**

```bash
D=https://<canonical-host>
curl -sI "$D/" | grep -iE 'strict-transport|content-security|cross-origin-opener|referrer-policy|x-frame|x-robots'
```

1. `strict-transport-security` present; storefront CSP as in
   `src/lib/security/content-security-policy.ts`;
   `cross-origin-opener-policy: same-origin`;
   `referrer-policy: strict-origin-when-cross-origin`; **no**
   `x-robots-tag` on the canonical host.
2. `curl -sI http://<canonical-host>/` → redirect to https.
3. `curl -sI https://<non-canonical host>/` → 308 to the canonical host.
4. `curl -sI https://<project>.vercel.app/` → 308, 401 or
   `x-robots-tag: noindex, nofollow`.
5. `curl -sI "$D/admin/login"` → nonce CSP with `'strict-dynamic'`,
   `cache-control: no-store`, `x-robots-tag: noindex, nofollow`,
   `referrer-policy: no-referrer`.
6. `curl -sI "$D/review/invalid-token"` and `"$D/kassa/bekraftelse"` →
   `no-store`, `noindex`.
7. `curl -s "$D/robots.txt"` → `Allow: /`, `Disallow: /admin`,
   `Disallow: /api/`, `Sitemap: $D/sitemap.xml`. A staging URL →
   `Disallow: /` and `x-robots-tag: noindex`.
8. `curl -s -X POST "$D/api/stripe/webhook" -H "stripe-signature: t=1,v1=0" -d '{}'`
   → 400 `{"error":"invalid_signature"}`. The first signed live delivery
   is checked in the controlled live test (section 18 D): Stripe Dashboard
   → Webhooks → the endpoint → deliveries → 200.
9. Cron: section 11 check 3 (401) and the cron logs (200).
10. `curl -s "$D/api/does-not-exist"` and a broken checkout body →
    generic answers without stack traces or internals.
11. Browser: open the store and admin with DevTools → Console: no CSP
    violations; Network: no request to a third-party origin.

---

## 16. Business, legal and content (Owner; legal review)

The developer does not write legal claims. Every information page is a
`noindex` placeholder ("Den här sidan är under uppbyggnad") until reviewed
content replaces it; then `indexable: true` is set for it in
`src/lib/config/info-pages.ts` and it enters the sitemap.

The owner provides, and has reviewed where the law requires:

| Item                                                                         | Where it appears                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Legal company name, organisationsnummer                                      | Store settings (footer, emails, Organization structured data)            |
| Business/postal address                                                      | Kontakt and Köpvillkor texts (not a settings field)                      |
| Customer-service email (a real, monitored mailbox)                           | Store settings → Kundtjänstens e-post (footer, reply-to of order emails) |
| Phone (if offered)                                                           | Kontakt text                                                             |
| Köpvillkor (terms)                                                           | `/kopvillkor`                                                            |
| Integritetspolicy (privacy), incl. processors: Vercel, Neon, Stripe, Resend  | `/integritetspolicy`                                                     |
| Retur & ångerrätt (14-day right of withdrawal, return process, costs)        | `/retur-och-angerratt`                                                   |
| Leveransinformation (carrier, delivery times, shipping price, preorders)     | `/leveransinformation`                                                   |
| Payment information (methods, when the card is charged, Klarna terms)        | Köpvillkor                                                               |
| Om oss, Kontakt                                                              | `/om-oss`, `/kontakt`                                                    |
| Cookiepolicy                                                                 | `/cookiepolicy`                                                          |
| Statement that HeavyCards is not affiliated with Pokémon/Nintendo, if wanted | Om oss / footer text (owner decides)                                     |

Facts for the privacy and cookie texts (to be checked by the owner's
adviser, not legal conclusions): HeavyCards sets **no** cookies for
storefront visitors; the cart is kept in the browser's `localStorage`;
administrators get a session cookie; there is no analytics or tracking and
no third-party content on the site (enforced by the CSP); Stripe's hosted
Checkout page is Stripe's own site. Whether a consent banner is needed for
this is a legal decision; adding analytics later changes the answer.

Approval of all texts, and of what the law requires on the site, is the
owner's responsibility with an appropriate professional.

### VAT and accounting (Owner + accountant)

HeavyCards stores a configurable VAT rate (Inställningar → Momssats, 25 %
by default) and snapshots it onto every order line; prices and shipping are
VAT-inclusive; the order stores the VAT portion. Nothing in the code is tax
advice. The owner and accountant confirm:

- the VAT rate(s) for the products sold (and whether any product needs a
  different rate: today one rate applies to all new orders);
- the VAT and accounting treatment of shipping;
- Stripe fees, payouts and their bookkeeping (the Stripe Dashboard exports
  payouts and fees);
- refunds and partial refunds;
- sales made outside the store (stock is adjusted by hand in admin);
- receipt/invoice requirements and how long order and accounting records
  must be kept (affects section 17).

No accounting integration exists in V1; exports come from Stripe and the
admin order list.

---

## 17. Personal data and retention (Owner + accountant/legal)

The inventory of what is stored where is in production-readiness.md §5.
Nothing is deleted automatically except security data (raw IPs in auth
rate limits and expired sessions after a day). **Do not add automatic
deletion of business data without an approved retention policy.**

Decisions the owner must make (with the accountant/legal adviser):

| Data                                                                         | Decide                                                                                                            |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Customer name, email, phone, address on orders                               | Retention period (bookkeeping rules usually apply to order records) and a yearly anonymisation procedure after it |
| Order and payment records                                                    | Retention period per accounting law                                                                               |
| Reviews and display names                                                    | How long published; deletion on request (developer task in V1)                                                    |
| Admin accounts                                                               | Deactivate leavers at once; delete on request                                                                     |
| Audit log                                                                    | Retention period                                                                                                  |
| Email delivery records and Resend IDs                                        | Retention; Resend's own log retention setting                                                                     |
| Stripe data                                                                  | Stripe is controller/processor per its terms; listed in the privacy policy                                        |
| Vercel request logs (contain URL paths incl. review/reset/invitation tokens) | Who may read logs (team members only); log drain policy; Vercel's retention                                       |
| Neon backups/restore window                                                  | Backups contain personal data for the window's length                                                             |

Also: data processing agreements with Vercel, Neon, Stripe and Resend (each
offers one); a manual process for data-subject requests (find orders by
email in admin; changes to order data need the developer).

---

## 18. Smoke tests

Never run against production data: `npm run test:e2e`, `npm run test:db`,
`npm run db:seed`, `db:reset`, `db:migrate`. The E2E suite, the seed and the
destructive Prisma commands refuse non-local databases; DB tests require a
database name ending in `_test`. The fake payment gateway and file email are
refused on Vercel. Test cards only in test mode; live payments only in D.

### A. Automated (local or CI, every change)

```bash
npm run format:check && npm run lint && npm run typecheck && npm test
npm run test:db && npm run db:check
APP_URL=http://localhost:3100 npm run build && npm run test:e2e
```

Covers, against a production build with the fake gateway: browsing,
category/set/product pages, search, filters, images, cart (no auto-open,
"✓ TILLAGD", badge, persistence, authoritative refresh, stock limits),
checkout creation and holds, signed webhooks, PAID finalization and stock
decrement, the confirmation page, expiry and failure, refunds (full,
partial) without restock, order emails (outbox), admin login and roles,
products/categories/sets/images, order processing → SHIPPED with tracking
and the shipping email with review link, review submission and moderation,
public rating, store settings, sitemap, robots (non-production),
redirects, security headers and the build-output secret scan.

### B. Staging, Stripe test mode (before opening; Together)

On the `staging` preview (test keys, test webhook with bypass, Resend with
a separate key so real rendering can be checked, team addresses only):

1. `/api/health` → `{"status":"ok"}`.
2. Homepage, `/pokemon-tcg`, a category, a set, a product, `/sok?q=…`,
   filters and sorting; product images load.
3. Add to cart (drawer stays closed, "✓ TILLAGD", badge), reload (cart
   kept), open the drawer, change quantity.
4. Change the product's price in admin; the drawer shows the new price
   after refresh and checkout refuses the stale price.
5. "Till kassan" → Stripe Checkout (test) shows SEK, Swedish address, the
   shipping line, and the enabled methods.
6. Pay with `4242 4242 4242 4242`; return to the confirmation page.
7. Stripe test Dashboard → the event delivery to staging → 200. Admin: the
   order is PAID (Betald), stock decreased by the quantity.
8. Order confirmation email arrives; check it in Gmail (web and app),
   Outlook and Apple Mail (layout, Swedish text, totals, contact link).
9. Repeat with Klarna and Swish test flows where Stripe offers them in
   test mode; a declined card (`4000 0000 0000 0002`) leaves the order
   unpaid and stock released after expiry.
10. Admin: Markera som behandlas → Markera som skickad with carrier and
    tracking → the shipping email arrives with tracking and review link.
11. Open the review link, submit a review; it is pending; approve it in
    Recensioner; the rating shows on the product page.
12. Stripe test Dashboard: partial refund → PARTIALLY_REFUNDED; refund the
    rest → REFUNDED; stock unchanged; restock by editing Lagersaldo.
13. Run the cron job by hand (section 11) → 200.
14. Staging `robots.txt` → `Disallow: /`; responses carry
    `x-robots-tag: noindex`.

### C. Production before opening (no payments; Developer)

With the checkout gate of section 14 on: health; storefront pages and
images; admin sign-in; upload/reorder/delete an image (Blob); sitemap and
robots.txt (section 20); a redirect after renaming a test slug (then
rename back); cron logs 200; webhook unsigned → 400; section 15 live checks.

### D. Controlled live test (opening day; Together)

1. Firewall gate: add the tester's IP exception (section 14).
2. One real order of a real, cheap product with the owner's own card or
   Swish/Klarna, to the owner's own address.
3. Verify: PAID, stock decreased, confirmation email received.
4. Ship it (or mark processing → shipped with a real or placeholder
   tracking number): shipping email with review link.
5. Refund it in full in the Stripe **live** Dashboard: REFUNDED in admin
   within a minute; restock if the item is sellable; Avbryt beställningen
   if it was not shipped.
6. Stripe fees of the test are not returned (accepted cost).

---

## 19. Backup and disaster recovery

### Database (Neon)

- **Point-in-time restore** within the restore window: Neon console →
  the production branch → Restore (to a timestamp). Neon can restore in
  place or create a new branch from that point; restoring to a new branch
  first lets you inspect it, then point the app at it (a new pooled URL →
  update `DATABASE_URL` in Vercel Production → redeploy).
- **Verify the restored state** before reopening: `/api/health`; the latest
  orders in admin against the Stripe Dashboard's payments for the same
  period; Kräver åtgärd; product stock for recently sold products.
- **Independent copy** (required soon after launch, see section 22): a
  periodic `pg_dump` with the direct URL to storage the owner controls,
  encrypted, because a restore window inside the same Neon account does not
  protect against losing that account. It contains personal data.

### Restore warning

**Restoring PostgreSQL does not roll Stripe or Resend back in time.**
Payments, refunds and sent emails after the restore point still exist
there. After any restore, before normal operation:

1. Keep the checkout gate (section 14) on.
2. Run the cron job once (Vercel → Cron Jobs → Run, or the curl in section
   11): it reconciles every unresolved checkout with Stripe.
3. Compare Stripe payments and refunds since the restore point with admin;
   for a paid order missing in HeavyCards, Stripe still holds the payment
   and customer details: contact the developer before refunding or
   fulfilling by hand. Re-send Stripe events from the Dashboard where an
   order exists but its state is old (webhooks are idempotent).
4. Check Resend for emails already sent after the restore point; HeavyCards
   may send them again once (Resend's idempotency covers 24 hours only).
5. Then disable the gate.

### Application

- A bad deployment: Vercel → Deployments → the last good production
  deployment → **Instant Rollback** (no build). Then revert the commit on
  `main`.
- Rebuilding a known commit: redeploy that deployment or push a revert.
- If the bad deployment included a migration, the rollback runs the old code
  against the new schema; this is why migrations must be backward
  compatible (section 4).

### Secrets

All rotation procedures and their consequences (including the database
password, and what rotating `AUTH_SECRET` or `REVIEW_LINK_SECRET` breaks)
are in one place: [production-readiness.md → Rotating secrets](production-readiness.md#rotating-secrets).
Rotate everything a departing developer has seen.

### Provider outages

| Provider down | Effect                                                                                        | Action                                                   |
| ------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Stripe        | Checkout shows an error; no stock held; reconciliation waits; webhooks retried by Stripe      | Monitor status.stripe.com; nothing to do                 |
| Neon          | `/api/health` 503; checkout "payment unavailable"; webhooks 500 (retried 3 days); emails wait | Neon status; restore/branch if prolonged                 |
| Resend        | Emails retry ~10 h, then Kräver åtgärd; payments unaffected                                   | Afterwards: production-readiness.md → Failed order email |
| Vercel Blob   | Image uploads fail with a Swedish message; existing images may not load                       | Vercel status; nothing to repair afterwards              |
| Vercel        | Store offline                                                                                 | Vercel status; Stripe keeps retrying webhooks            |

---

## 20. SEO launch

In order (Together; nothing below has been done yet):

1. `APP_URL` = final canonical https origin (section 7), redeployed.
2. Alternate host redirects to the canonical host; `*.vercel.app` noindex
   or redirected (section 15 checks 3–4).
3. `https://<canonical-host>/robots.txt`: `Allow: /`, admin and API
   disallowed, sitemap line.
4. `/sitemap.xml`: canonical URLs only (products, categories and sets with
   listable products, published information pages); no admin, checkout,
   review or archived URLs.
5. View source of the homepage, a product, a category and a set:
   `<link rel="canonical">` on the canonical host, title and description,
   Open Graph image.
6. A staging URL: `Disallow: /` and `x-robots-tag: noindex`.
7. Google Search Console: add a **Domain property**, verify with the DNS TXT
   record (no token in the code), invite the developer as a user.
8. Submit `https://<canonical-host>/sitemap.xml` (on or just before opening
   day; the checkout gate does not stop indexing).
9. URL Inspection: homepage, one product, one category, one set; request
   indexing.
10. Rich Results Test: a product page and the homepage; a product with
    approved reviews shows a valid AggregateRating. Missing brand/GTIN/
    shipping/return-policy warnings are expected (not modelled).
11. PageSpeed Insights / Lighthouse (mobile) for homepage, a category and a
    product with real photos and content.
12. Content: Swedish descriptions (a few paragraphs) for the important
    categories and sets; product texts and alt texts.
13. Information pages: set `indexable: true` only when their reviewed
    content is published (section 16).

---

## 21. Ordered launch checklist

`[B]` = blocks opening. Roles: **Dev**, **Owner**, **Both**, **Acct/Legal**.

**Phase 1 — Accounts and decisions**

1. `[B]` **Owner**: legal company details, business address, customer-service mailbox (working).
2. `[B]` **Owner**: domain registered in the company's name; DNS access.
3. **Owner + Dev**: GitHub organisation; repository transferred or developer access granted.
4. `[B]` **Owner**: Vercel team on Pro with billing; developer invited.
5. `[B]` **Owner**: Neon organisation, paid plan, billing; developer invited.
6. `[B]` **Owner**: Stripe account created and activation submitted (company, representative, bank account); developer invited. Start early: verification can take days.
7. `[B]` **Owner**: Resend account; developer invited.
8. `[B]` **Both**: 2FA on every account above; passwords in a password manager.
9. `[B]` **Owner + Acct**: VAT rate, shipping price, free-shipping threshold, shipping VAT treatment.

**Phase 2 — Infrastructure**

10. `[B]` **Dev**: Neon project (Frankfurt), production branch settings, restore window, alerts; separate staging database (section 4).
11. `[B]` **Dev**: migrate production from zero and verify (section 4).
12. `[B]` **Dev**: Vercel project, build settings, production branch, `staging` branch, deployment protection (section 6).
13. `[B]` **Dev**: Blob stores (production → Production only; preview separate) (section 8).
14. `[B]` **Both**: Resend domain (EU region), SPF/DKIM/DMARC at the DNS host, verified; sending-only keys (section 10).
15. `[B]` **Both**: domain in Vercel, canonical host chosen, alternate redirected, HTTPS issued (section 7).
16. **Both**: Stripe test mode: payment methods, restricted test key, staging test webhook (section 9).
17. `[B]` **Dev**: Stripe live: restricted live key, live webhook endpoint with the eight events (after activation, step 6).
18. `[B]` **Dev**: all Production and staging environment variables (section 3).
19. `[B]` **Dev**: Firewall checkout gate on (section 14); webhook/cron/health exceptions (section 12).
20. `[B]` **Dev**: production deployment succeeds; `/api/health` 200.
21. `[B]` **Both**: first OWNER (section 5); sign in.
22. `[B]` **Owner**: Inställningar saved with real values (store name, customer-service email, company, organisationsnummer, shipping, VAT, low-stock threshold).
23. `[B]` **Dev**: cron runs every 15 minutes with 200 (section 11).
24. `[B]` **Dev**: monitoring minimum: deployment notifications, Stripe webhook failure emails, uptime check on `/api/health` (section 13).
25. **Dev**: Firewall rate-limit rules in Log mode (section 12).

**Phase 3 — Test-mode verification**

26. `[B]` **Both**: staging smoke test B, including email rendering in Gmail, Outlook and Apple Mail (section 18).

**Phase 4 — Content, legal, business**

27. `[B]` **Owner + Legal**: reviewed texts for all information pages; **Dev** publishes them and sets `indexable: true` (section 16).
28. `[B]` **Owner + Acct/Legal**: privacy policy with processors; retention decisions recorded (section 17).
29. `[B]` **Owner**: categories, sets and products with real photos, prices, stock and descriptions in production admin.
30. **Owner**: additional staff invited; each with their own account.

**Phase 5 — Production checks**

31. `[B]` **Dev**: production checks C and the security live checks (sections 15, 18).
32. `[B]` **Both**: SEO steps 1–6 (section 20); steps 7–11 may follow on opening day.

**Phase 6 — Opening**

33. `[B]` **Both**: go/no-go against PROJECT.md §128 (live Stripe, production webhook secret, production database, backups, verified sender, admin accounts, no demo data, legal pages, support email, shipping, free-shipping threshold, VAT/prices reviewed, robots, admin noindex, HTTPS, no secrets in Git history).
34. `[B]` **Both**: controlled live test D, with the tester's IP exception.
35. **Both**: open the store: disable the Firewall checkout gate; check one more checkout reaches Stripe.
36. **Both**: Search Console sitemap and inspection (section 20 steps 7–11); first-week daily check of Översikt, cron logs and Stripe webhooks.

---

## 22. Launch-blocker report

Repository/code level: **no remaining blockers.** Every item below needs a
provider account, a person or a decision.

### BLOCKER — cannot open without

- Provider accounts owned by HeavyCards: Vercel Pro, Neon, Stripe
  (activated, bank account), Resend, domain/DNS; developer access; 2FA.
- Neon production database migrated; restore window configured.
- Vercel project, environment variables, Blob store, domain with HTTPS,
  15-minute cron verified, checkout gate and webhook/cron exceptions.
- Resend domain verified (SPF, DKIM), production key and sender.
- Stripe live restricted key and live webhook endpoint with the eight
  events; payment methods enabled (Swish/Klarna as Stripe allows).
- First OWNER created and signed in; store settings saved with real values.
- Staging test-mode smoke test passed, including email rendering.
- Reviewed information/legal texts published (company details, terms,
  privacy, returns/withdrawal, delivery, cookies) and VAT/shipping
  confirmed by the owner/accountant.
- Real catalog content in production.
- Minimum monitoring (deployment notifications, webhook failure emails,
  uptime check, owner's daily Översikt routine).
- Production security/SEO checks and the controlled live test.

### REQUIRED SOON — operational, within weeks of opening

- Independent periodic `pg_dump` copy outside Neon (section 19).
- Retention periods and a yearly anonymisation procedure (section 17).
- Search Console verification, sitemap submission, URL inspection, Rich
  Results Test and mobile Lighthouse with real content (section 20).
- Firewall rules moved from Log to enforce after a week of data.
- Restore drill: restore the production branch to a new branch once and
  verify it (section 19), so the procedure is known before it is needed.
- Data processing agreements with the providers.

### OPTIONAL — post-launch improvements

- Error-monitoring service; log drain with longer retention; cron heartbeat.
- Separate DML-only database role for the app.
- Admin 2FA (the auth design allows it; not built in V1).
- Vercel BotID on checkout if distributed hold abuse appears.
- HSTS `includeSubDomains`/`preload` once every subdomain is HTTPS.
- Review links in the URL fragment instead of the path.
- Per-product purchase limits (business decision).
- Stripe Tax, accounting integration, PostNord integration (out of scope
  for V1).
