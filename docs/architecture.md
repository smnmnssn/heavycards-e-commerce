# Architecture decisions

Concise record of decisions not fully prescribed by [PROJECT.md](../PROJECT.md).
Newest milestone last. Each entry says what was decided and why.

## Milestone 1 — Repository foundation (2026-09-30)

### Toolchain versions

All versions were verified against the npm registry and each other's `engines`
and `peerDependencies` on 2026-09-30. Where the newest release was not
compatible, the newest compatible release was chosen:

| Package    | Pinned | Newest available | Why not newest                                                                                                                                                                    |
| ---------- | ------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js    | 24.x   | 26.x (Current)   | 24 is the active LTS line and Vercel's default. Vercel deprecates Node 20 on 2026-10-01. Vitest 5 requires Node ≥ 22.12.                                                          |
| TypeScript | 6.0.3  | 7.0.2            | `typescript-eslint` 8.71 (used by `eslint-config-next`) supports `<6.1.0`. Next.js itself builds with 6.0.                                                                        |
| ESLint     | 9.39.5 | 10.11.0          | `eslint-config-next` 16.3.8 depends on `eslint-plugin-react`, `-import` and `-jsx-a11y`, which support ESLint ≤ 9. Verified: ESLint 10 crashes (`getFilename is not a function`). |
| React      | 19.3.0 | 19.3.0           | —                                                                                                                                                                                 |

**Known risk:** ESLint 9 reached end-of-life on 2026-08-06. It is a development-only
tool and never ships to production. Upgrade to ESLint 10 as soon as
`eslint-config-next` supports it.

`vite` is a direct dev dependency because Vitest 5 declares it as a peer
dependency. Pinning it keeps the version explicit.

### Environment validation

- `src/lib/env/schema.ts` holds a pure Zod parser. It is testable and has no framework imports.
- `src/lib/env/server.ts` exposes the parsed `env`. It is marked `server-only`, so it cannot be bundled into client code.
- Validation runs at build time (root layout prerender) and at server boot (`instrumentation.ts`). With an invalid configuration, the build fails. A started server logs the error and answers every request, including `/api/health`, with HTTP 500, so it fails closed.
- Error messages name variables but never echo values, so secrets cannot leak into logs.
- Variables join the schema in the milestone that first reads them. `.env.example` already lists them all.
- `APP_URL` resolution order:
  1. explicit `APP_URL`, which must be https in Vercel production;
  2. the Vercel preview deployment URL;
  3. `http://localhost:3000` outside production.

  Production never silently falls back, because a wrong canonical origin damages SEO and email links.

### shadcn/ui setup

`components.json` uses the current CLI defaults (`radix-nova`, neutral, CSS
variables). Two things differ from `shadcn init`:

- `cn()` is implemented locally with `clsx` + `tailwind-merge` instead of the newer `cn` npm package, which is pre-1.0 and ships a build-time compiler. Components import `@/lib/utils` either way, so the CLI is unaffected.
- `radix-ui`, `lucide-react`, `class-variance-authority`, `tw-animate-css` and the `shadcn` runtime stylesheet are not installed until a component actually needs them (Milestone 3 onward).

### Security baseline

`next.config.ts` sends these on every response:

- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `X-Frame-Options: DENY` plus CSP `frame-ancestors 'none'`

It also disables `X-Powered-By`, and sends `X-Robots-Tag: noindex, nofollow` on `/admin/**` and `/api/**`.

A full CSP is deferred until the Stripe, storage and analytics origins are known. HSTS is provided by Vercel.

### Testing layout

- Vitest runs in a Node environment and covers `tests/**/*.test.ts`. `server-only` is aliased to a stub, so server modules can be unit tested.
- Playwright runs against the production build (`next start`), not the dev server, so tests see real rendering and caching. It uses desktop and mobile Chromium profiles, with locale `sv-SE` and timezone `Europe/Stockholm`.

### Install policy

`.npmrc` sets:

- `save-exact=true`, so no `^`/`~` ranges get added by accident;
- `engine-strict=true`, so installs on the wrong Node major fail.

npm 11 warns that `unrs-resolver`'s postinstall script (a native-binding fallback installer pulled in by `eslint-import-resolver-typescript`) is not in `allowScripts`. The platform binding installs as a normal optional dependency, so the script is intentionally left unapproved.
