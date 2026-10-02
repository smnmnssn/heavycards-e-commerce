# Production readiness and runbooks

Milestone 14 baseline (2026-10-02). It separates what the application already
enforces from what must still be set up by hand before launch (Milestone 15),
lists accepted limitations, and gives operators step-by-step procedures. The
reasoning behind each decision is in
[architecture.md → Milestone 14](architecture.md#milestone-14--security-reliability-and-production-hardening-2026-10-02).

## 1. Protections implemented in the application

### Payments and inventory

| Risk                                              | Protection                                                                                                                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser-controlled prices or totals               | Strict request schema (only IDs, quantities, displayed price, attempt ID); totals computed from the database; a changed price refuses the checkout.                               |
| Overselling                                       | Product rows locked in id order inside the reservation transaction; holds attached to a Stripe session end only on Stripe's answer (never by time).                               |
| Forged or replayed webhooks                       | Signature over the raw body, 5-minute timestamp tolerance, 512 KB body cap; the event only names the session, whose state is re-read from Stripe's API.                           |
| Duplicate, reordered or contradictory events      | Event IDs stored in the effect's transaction; every effect requires PENDING/ACTIVE under the order lock; the current Stripe state decides, not the event type (tested sequences). |
| Unpaid order marked paid; paid order unpaid again | Transition table; PAID only after amount, currency and customer data checks; DB invariants for refund state and fulfillment.                                                      |
| Stock decremented twice / refund restocking       | Decrement only when ACTIVE reservations become CONSUMED in the same transaction; refunds never touch inventory.                                                                   |
| Holding stock without paying                      | Per client (HMAC of the IP): at most 3 open unpaid checkouts and 30 held units; 15 checkout requests per 10 minutes; superseding releases a browser's previous attempt.           |
| Crashed or abandoned checkouts                    | 5-minute provisional holds; expiry webhooks; reconciliation (cron and after checkouts) asks Stripe once a hold is due.                                                            |
| Staff cancelling a checkout that is still payable | Refused (service and `orders_pending_unfulfilled_check`).                                                                                                                         |

### Access control

- Every admin page, server action, route handler and service checks the
  session server-side; services re-read the actor's role and `isActive`
  inside their transaction (`FOR SHARE`), so a demotion or deactivation takes
  effect on the next request (tested with a live session).
- OWNER-only operations (administrators, store settings, operator commands)
  are refused for ADMIN by the server, not only hidden.
- Only seven Better Auth endpoints are reachable; sign-up does not exist.
- Customer-facing records are reached only through unguessable values (Stripe
  session ID, 256-bit review token, 122-bit checkout attempt ID); order
  numbers never authorize anything. The confirmation page shows no personal
  data.

### Abuse limits (PostgreSQL-backed, shared by all instances)

| Endpoint                     | Limit                                        |
| ---------------------------- | -------------------------------------------- |
| Admin sign-in                | 10 per 5 minutes per IP                      |
| Password-reset request/reset | 5 / 10 per 15 minutes per IP                 |
| Other auth endpoints         | 60 per minute per IP                         |
| Checkout creation            | 15 per 10 minutes per client                 |
| Open unpaid checkouts        | 3 per client, 30 units in total              |
| Review page / submission     | 60 / 20 per 10 minutes per client            |
| Image upload                 | authenticated, 4 MB body, 12 images/product  |
| Request bodies               | checkout 16 KB, webhook 512 KB, actions 1 MB |

The first refusal per client and window is logged (`[security] rate limit
reached`, scope only). Read-only public endpoints (`/api/cart`, search) are
bounded (50 IDs, 5 terms of ≤ 100 characters, 24 rows, page ≤ 500) but not
rate limited in the application; volumetric floods are the platform's job
(Vercel Firewall, see section 2).

### Browser hardening

- **CSP.** Storefront: own origin only, inline scripts allowed (static/ISR
  pages cannot carry a nonce), no objects, frames, foreign connections or
  form targets. Admin: a fresh nonce per response with `'strict-dynamic'`,
  so an injected inline script cannot run where prices, stock and orders are
  edited. Both verified in E2E with zero violations while the pages are used.
- `X-Frame-Options: DENY` and `frame-ancestors 'none'`, `nosniff`,
  `Referrer-Policy` (`no-referrer` on admin, checkout return and review
  pages), `Cross-Origin-Opener-Policy: same-origin`, a restrictive
  `Permissions-Policy`, no `X-Powered-By`.
- Admin, checkout-return and review pages render per request with
  `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`; non-
  production deployments are noindex as a whole.
- CSRF: Better Auth checks `Origin` against `APP_URL`; checkout and image
  upload require `Origin == APP_URL`; server actions use Next.js's origin
  check; the session cookie is `SameSite=Lax`. Webhooks use the Stripe
  signature and the cron route a bearer secret instead.

### Uploads

Authorization before the body is read; 4 MB hard limit while streaming;
format from magic bytes (JPEG/PNG/WebP; SVG, GIF, HEIC refused); declared
type and extension must agree; full decode with a 40-megapixel limit;
animations refused; 300–8 000 px; re-encoded with metadata (GPS, camera)
stripped; server-generated keys only.

### Secrets and configuration

Production (`VERCEL_ENV=production`) refuses to build or start without:
`APP_URL` (https, not a local host), `DATABASE_URL` (not a local host),
`AUTH_SECRET` (≥ 32), `REVIEW_LINK_SECRET` (≥ 32, different from
`AUTH_SECRET`), a live Stripe key, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`
(≥ 16), Resend key and a non-placeholder sender, `BLOB_READ_WRITE_TOKEN`.
Live Stripe keys are refused outside production; test runs can never use
Resend. Error messages name variables, never values. No secret reaches a
browser bundle (checked on the build output).

### Logging

Structured prefixes, identifiers only:

| Prefix       | Fields                                                                 |
| ------------ | ---------------------------------------------------------------------- |
| `[payments]` | Stripe event ID/type, order ID, outcome/problem, error name/code       |
| `[checkout]` | order ID, Stripe error type/code/request ID; hold-limit kind           |
| `[email]`    | delivery/order ID, kind, attempt, outcome, error code, Resend email ID |
| `[security]` | rate-limit scope; housekeeping failures                                |
| `[storage]`  | storage keys of objects that could not be deleted, error name          |
| `[auth]`     | admin user ID, error name                                              |

Never logged: passwords, cookies, tokens (review, reset, invitation), keys,
request bodies, customer names, emails, phone numbers or addresses, email
content, raw IPs or client keys. Errors are reduced to name/type/code
(`logSafe`), because messages can echo data (e.g. PostgreSQL's "Failing row
contains …").

## 2. Manual production setup (Milestone 15)

1. **Vercel**: production domain over HTTPS; redirect `*.vercel.app` and
   `www` to the canonical host; Node 24. Check `curl -sI https://<domain>`
   shows `strict-transport-security` (Vercel default); decide on
   `includeSubDomains`/`preload` only once every subdomain serves HTTPS.
2. **Environment variables** (production scope only, separate values for
   preview): all of section 1 → Secrets. Generate secrets with
   `openssl rand -base64 32`; never reuse a value between environments or
   between `AUTH_SECRET` and `REVIEW_LINK_SECRET`.
3. **Vercel Firewall**: enable the managed DDoS protection; add a rate-limit
   rule for `/api/cart`, `/sok` and `/api/checkout` if abuse is seen; consider
   Vercel BotID on `/api/checkout` if distributed hold abuse appears.
4. **Logs**: limit who can read runtime logs (they contain URL paths, which
   include review and reset tokens); if a log drain is added, exclude
   `/review/` and `/admin/reset-password` and `/admin/invite` paths or keep
   the drain inside the same trust boundary. Set retention.
5. **PostgreSQL**: provider with PITR backups and a tested restore; a pooled
   connection URL for the app (everything uses transaction-scoped locks and
   settings, so transaction pooling works) and a direct URL for migrations;
   restrict network access; run `npm run db:deploy`.
6. **Stripe**: live webhook endpoint with the eight events in
   architecture.md (Milestone 9); restricted key with the listed
   permissions; payment methods enabled; team access per person.
7. **Resend**: verified domain (SPF/DKIM/DMARC), sending-only key.
8. **Vercel Blob**: production store connected (sets the token).
9. **Cron**: `CRON_SECRET`; on a Pro plan run the job every 15 minutes.
10. **Monitoring**: uptime check on `/api/health`; alerts on `[payments]`
    and `[email]` error lines and on 5xx rates; someone owns the dashboard's
    "Kräver åtgärd" list daily.
11. **People**: first OWNER via `npm run admin:create-owner`; remove seed
    administrators and demo data; each staff member has their own account.
12. **Legal/privacy**: retention periods and the manual data-request process
    (section 5) approved by the owner and their accountant.

## 3. Accepted limitations

- **Distributed hold abuse.** Holds are capped per client IP. An attacker
  with many addresses can still reserve stock for up to ~55 minutes per
  checkout (Stripe's minimum session life is 30 minutes). Mitigations if
  seen: Vercel BotID/Firewall, or an owner decision on per-product purchase
  limits. Shared networks (households, offices, mobile NAT) share one
  allowance of 3 checkouts / 30 units.
- **Admin sign-in brute force** is limited per IP only; there is no per-
  account lockout (it would let anyone lock the owner out). Passwords are
  ≥ 12 characters; 2FA is the next step (the auth design allows it).
- **Tokens in URLs.** Review links (path) and admin reset/invitation links
  (query) can appear in hosting access logs. They are not logged by the
  application, never sent as a Referer, and pages load nothing from third
  parties (enforced by the CSP). A review token only allows submitting a
  moderated review for that order's products and shows no customer data;
  reset/invitation tokens are single-use and expire in 1 h / 72 h. Moving
  review tokens into the URL fragment would remove them from logs but needs
  JavaScript and a second link format; not worth it for V1.
- **Storefront CSP allows inline scripts** (static rendering); admin does not.
- **Orphaned images.** A failed storage deletion leaves an unreferenced,
  unguessable public file (product photo, no personal data). It is logged
  with its key; cleanup is manual (section 4).
- **Next.js log noise**, see section 6.

## 4. Runbooks

All commands that change data run on a trusted machine with the production
variables; never paste values into tickets or chats.

### Payment needs attention (dashboard "Kräver åtgärd")

1. Open the order; read the problem text.
2. Press **Kontrollera med Stripe igen**. Stripe's answer is applied: paid
   and consistent → finalized; expired/failed → stock released; otherwise
   nothing changes.
3. If the order no longer holds stock, decide with the customer (ship or
   refund in Stripe), then **Markera som hanterat**.

### Stock held by a checkout Stripe and HeavyCards cannot reconcile

Typical cause: Stripe charged an amount that differs from the order, or a
paid session lacks the address. The hold never ends by itself, by design.

1. In the Stripe Dashboard, refund the payment in full (or confirm the
   PaymentIntent was canceled).
2. Run, as an OWNER:
   ```
   npm run ops -- release-payment-hold --order HC-10001 --owner <owner email> --note "Refunded in full in Stripe <date>"
   ```
   It asks for the OWNER's password and for the order number, checks Stripe
   again (refuses while any money is kept, the session can still be paid, or
   it already expired), then releases the stock, closes the order as FAILED
   and audits the action with the OWNER. Product pages update within 60 s.
3. Mark the attention item handled in admin. A later refund event changes
   nothing.

There is deliberately no admin button for this.

### Failed order email (EMAIL_NEEDS_ATTENTION)

1. In Resend, search for the order's email (the Resend ID is on the order
   page when known). If it **was delivered**, mark the item handled.
2. If it was **not** delivered (bounced, never accepted):
   ```
   npm run ops -- requeue-email --order HC-10001 --kind confirmation|shipped --owner <owner email>
   ```
   This resets the delivery (attempts, unknown-outcome clock) so the outbox
   sends it on the next scheduled run or checkout; it is audited. Do not edit
   the row by hand: the earlier "set it to PENDING" advice failed again
   immediately for unknown outcomes.
3. If the address itself is wrong, contact the customer from the support
   mailbox instead.

### Webhook processing failures (`[payments] webhook processing failed`)

Stripe retries for three days; nothing is released meanwhile. Check the
error code, database health and the Stripe API status. After fixing,
"Resend" the event from the Stripe Dashboard or wait for the retry. Holds
due in the meantime are reconciled by the cron job.

### Reconciliation stuck (holds not clearing)

Check that the cron job runs (`GET /api/cron/reconcile-checkouts` in the
Vercel cron log, 200) and that `STRIPE_SECRET_KEY` works. Unresolved orders
are re-checked every 15 minutes; open the order and use **Kontrollera med
Stripe igen** to see Stripe's answer for a single order.

### Storage failures

- Upload errors show a Swedish message; nothing is stored or recorded.
- `[storage] product image objects could not be deleted` lists the keys:
  delete them in the Vercel Blob dashboard after checking that no
  `product_images.storage_key` refers to them.

### Database unavailable

`/api/health` answers 503; checkout answers "payment unavailable"; webhooks
answer 500 (Stripe retries); emails stay pending. Restore the database (or
fail over), then verify `/api/health`, run the cron route once, and watch the
dashboard. Restoring a backup older than recent payments: reconcile paid
orders against the Stripe Dashboard before reopening the store.

### Stripe unavailable

Checkout shows a Swedish error; no stock is held for failed attempts;
reconciliation postpones and keeps holds. Nothing to do but monitor.

### Resend unavailable

Emails retry with backoff for about 10 hours and then go to "needs
attention"; payments and fulfilment are unaffected. Afterwards follow
"Failed order email".

### Rotating secrets

| Secret                  | Effect and procedure                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`           | Signs every administrator out; resets rate-limit and hold-cap counters. Review links are unaffected.                                                                                                                                                          |
| `REVIEW_LINK_SECRET`    | Delivered links keep working (lookup by hash). Move the old value to `REVIEW_LINK_SECRET_PREVIOUS`, set the new one, redeploy; remove the previous value after a week (pending shipping emails are sent by then). Without that step they go without the link. |
| `CRON_SECRET`           | Update in Vercel; the next cron call uses it.                                                                                                                                                                                                                 |
| `STRIPE_WEBHOOK_SECRET` | Roll in the Stripe Dashboard (it allows both for a period), update Vercel, redeploy.                                                                                                                                                                          |
| Stripe/Resend/Blob keys | Create the new key, update Vercel, redeploy, revoke the old key.                                                                                                                                                                                              |

### Suspected admin account compromise

An OWNER deactivates the account (sessions are deleted at once); rotate
`AUTH_SECRET` if session theft is suspected; review the audit log (product,
price, stock and settings changes are all recorded with the actor).

## 5. Personal data and retention

| Data                                                                              | Where                                           | Retention today                                                    | Needed before launch                                                                                                                     |
| --------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Customer name, email, phone, delivery address                                     | `orders` (paid orders only)                     | Kept indefinitely                                                  | Owner/accountant decide the period (Swedish bookkeeping rules usually require 7 years for records) and a yearly anonymisation procedure. |
| Order lines, amounts                                                              | `orders`, `order_items`                         | Kept (accounting)                                                  | As above.                                                                                                                                |
| Pseudonymous client key (HMAC of IP)                                              | `orders.checkout_client_key`, rate-limit tables | Cleared when the order leaves PENDING; buckets deleted after a day | —                                                                                                                                        |
| Admin name, email; sign-in IP and user agent                                      | `admin_users`, `admin_sessions`                 | Expired sessions deleted daily                                     | Remove former staff (deactivate; delete on request).                                                                                     |
| Raw IP in auth rate limits                                                        | `auth_rate_limits`                              | Deleted after a day                                                | —                                                                                                                                        |
| Review display name, title, text                                                  | `reviews` (linked to an order line)             | Kept; rejecting unpublishes                                        | Deleting a review on request is a developer task in V1 (it re-opens the line for that customer's link).                                  |
| Audit log (admin IDs; admin emails on invitations; never customer data)           | `audit_logs`                                    | Kept                                                               | Decide a retention period.                                                                                                               |
| Resend email IDs                                                                  | `email_deliveries`                              | Kept                                                               | Resend keeps content per its plan; set its retention.                                                                                    |
| Payment and customer data at Stripe; email logs at Resend; request logs at Vercel | Providers                                       | Provider settings                                                  | Data processing agreements; list them in the privacy policy.                                                                             |

Data requests (access, rectification, erasure) are handled manually in V1:
find the customer's orders by email in admin; rectification and erasure of
order data need a developer, within the bookkeeping constraints.

## 6. Investigated warnings

### `⨯ Error: The destination stream closed early.`

Seen a few times per E2E run (5 and 6 times in two full runs of 265 tests), always with digest
`3069055589`. It is React's message when the stream it renders into closes
before it finishes; Next.js 16.3 renders RSC payloads with
`renderToPipeableStream` into a PassThrough
(`next/dist/server/app-render/stream-ops.node.js`) and logs the abort.

Reproduced with a production build: a browser starts a client-side
navigation, and the page is closed while the RSC response for the target
page is still rendering (made deterministic by briefly holding a lock on
`products`). One entry with the same digest. Controls without the close
(with and without the lock) and dozens of completed or cancelled document
and prefetch requests produce none. In E2E it happens when a test ends while
a prefetch or navigation is still streaming.

Conclusion: expected client cancellation logged by the framework; not a
HeavyCards stream bug and not a reliability problem (page renders are
read-only). It is not suppressed. In production it will appear when visitors
leave mid-navigation; alerting should ignore this message/digest.

### Duplicate `Location` header on the first uncached redirect

Reproduced on the production build: the first request to an old product
slug (`x-nextjs-cache: MISS`) returns 308 with two identical `location`
headers; the next request (`HIT`) has one. Cause, in Next.js 16.3.8: the
renderer sets `location` on the response and records it in the cache
entry's metadata (`app-render.js`, `setHeader`), and
`build/templates/app-page-runtime.js` then appends every metadata header
again. HeavyCards calls `permanentRedirect` once (pages only; metadata
returns `{}`). Identical repeated values are accepted by browsers (Chromium
rejects only differing values) and crawlers; status and target are correct.
Kept as is; `e2e/seo.spec.ts` asserts 308 and that every value is the
canonical target. Re-check on the next Next.js upgrade.

## 7. Dependencies

`npm audit`: 4 high, 0 critical, all inside the `prisma` CLI (`mysql2`,
`deepmerge-ts`, `@prisma/config`): not deployed (Next.js file tracing ships
only `@prisma/client`), MySQL code unused, deepmerge only on our own config.
No fixed Prisma 7 release exists (7.10.0 is the newest stable; npm's
suggested "fix" is a major downgrade to 6.x). Accepted; CI fails on any
critical advisory. Next.js 16.3.8, Stripe 23.0.0, Better Auth 1.7.7, sharp
0.35.5 and @vercel/blob 2.8.0 are the latest releases; no upgrade was needed.
