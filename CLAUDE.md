# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**ViolationRadar** (working name `nycradar`) — a Next.js + Supabase app that generates unified NYC property violation reports by joining four NYC Open Data sources (DOB, HPD, ECB, OATH) on a canonicalized BBL/BIN. Address search runs against a locally ingested PLUTO index in Supabase; violation data itself is fetched live from Socrata on report generation and cached for an hour.

Read `spike/FINDINGS.md` before touching anything under `src/lib/nyc/` — it's the feasibility study that explains *why* the join/dedup code is shaped the way it is, with the measurements behind each rule. `README.md` also has substantial operational detail (env vars, auth email-template configuration, rate limiting rationale) that is not repeated here.

## Commands

```bash
npm run dev                    # dev server
npm run build                  # production build
npm run typecheck              # tsc --noEmit
npm run lint                   # eslint

npm run test                   # unit tests, offline, fixtures only
npm run test:integration       # against real Supabase + fake-signed Stripe webhooks
npm run test:live              # against live NYC Open Data (slow, serial, rate-sensitive)

npm run report -- 3000017501   # CLI: generate a report for a BBL (also the Phase 0 validation tool)
npm run seo:refresh            # rebuild property_seo_summaries (also runs nightly via GH Actions)
npm run screenshots            # Playwright visual sweep, light+dark, mobile+desktop
```

Run a single test file with vitest directly, e.g. `npx vitest run tests/bbl.test.ts`. To run a single test within a file, use `-t` (e.g. `npx vitest run tests/bbl.test.ts -t "condo"`). `test:integration` and `test:live` need real credentials in `.env.local` (see README's "Environment" section) and are excluded from the default `npm test` run — see the `include`/`exclude` globs in `vitest.config.mts`, `vitest.integration.config.mts`, and `vitest.live.config.mts`.

`1 John Street, Brooklyn` (BBL `3000017501`) is the canonical regression case for the condo billing-lot join bug — it must show non-zero DOB violations.

## Architecture

### The report pipeline (`src/lib/nyc/`)

This is the core of the product. `report.ts`'s `generateReport(bbl)` runs a fixed three-pass sequence, and each pass exists to prevent a specific silent-wrong-answer failure mode measured in the spike:

1. **Query every source by canonical BBL, in parallel** (`Promise.allSettled` — one dead agency must not take down the whole report; failures are tracked in `unavailableSources` rather than rendered as an empty/clean section).
2. **BIN recovery.** Condo billing lots (lot ≥ 7501) are cited by HPD/ECB against the billing lot but by DOB against the *underlying physical lot*. If DOB/ECB/HPD come back empty, every BIN seen from the other sources is collected and re-queried by BIN.
3. **Dedup ECB against OATH** (`dedupeEcbAgainstOath`) — ~82.6% of ECB summonses also appear in OATH's citywide docket under a zero-prefixed ticket number; skipping this roughly doubles violation counts and dollars owed.

Per-source modules live in `src/lib/nyc/sources/{dob,hpd,ecb,oath}.ts`, each exporting the same shape: `fetchByBbl`, `fetchByBin` (except HPD, which also exports `countsByBbl`/`countsByBin` for authoritative aggregate counts on capped sections), and `normalize(rows, bbl, matchedBy) -> NormalizedViolation[]`. Each source has its own field names, its own padding convention, and its own status/severity vocabulary — normalize is where that gets flattened into the common `NormalizedViolation` shape (`types.ts`).

Supporting modules:
- **`bbl.ts`** — the single most load-bearing file in the codebase. Canonicalizes BBLs (`boro(1)+block(5)+lot(4)`, always integer-cast then re-padded, never string-concatenated — DOB pads lot to 5, ECB/OATH to 4, HPD not at all), rejects sentinel BINs (`0000000`, `X000000`), and defines `dedupKey` (leading-zero-stripped identifier match for ECB↔OATH).
- **`socrata.ts`** — the SODA client. `soda()` does retries/timeouts/concurrency-throttling; `sodaAll()` pages until exhausted (a bare `$limit` silently truncates — some properties exceed 5,000 HPD violations); `sodaPages()` is the streaming variant used by the citywide SEO sweep so peak memory doesn't scale with dataset size; `datasetUpdatedAt()` reads the portal's own `rowsUpdatedAt` metadata, which is the authoritative "data as of" timestamp (deliberately the *oldest* of the four sources' timestamps, not the fetch time).
- **`classify.ts`** — severity ranking and correction-type classification, used for sort order within a section.
- **`persistence.ts` / `property.ts`** — PLUTO-backed address search and property metadata, read from Supabase (not live Socrata).
- **`seo-summary.ts` / `seo-slug.ts`** — feed the indexable `/p/{borough}/{slug}` landing pages, built nightly from `property_seo_summaries` rather than live queries.

`getCachedReport(bbl)` is the front door for read-only surfaces (report page, PDF export, teaser) — it wraps `generateReport` in `unstable_cache` (1hr) but **only caches complete reports**. A report generated during a partial outage is served but never cached (see `PartialReportError` / `partialReportOf` in `report.ts`), because a stale "clean building" result for a genuinely-down agency would be indistinguishable from a real answer once cached. `withProperty()` merges PLUTO metadata in separately — `generateReport` itself never imports `./property`, keeping it a pure function safe for the offline unit tests in `tests/dedupe.test.ts` and free of the `server-only` guard.

### Entitlement / paywall (`src/lib/auth/entitlement.ts`)

`resolveAccess(bbl)` is called server-side on every report request and decides one of four tiers — `anonymous` (teaser only), `free` (one full report per email per rolling 30 days, tracked in Postgres), `subscription` (unlimited), `single_purchase` (one specific BBL, no account). It derives entirely from Stripe-driven state in Supabase, never from anything the client sends, and **fails closed to the teaser** if the service-role key isn't configured. `recordLookup()` is what actually enforces the free-tier cap; it must be called exactly once per full report view and never for a teaser — the free-tier path uses a Postgres RPC (`claim_free_lookup`) rather than a plain insert specifically to close a race between two concurrent first-views of the same email.

### Routing (`src/app/`)

Standard Next.js App Router. Notable routes:
- `report/[bbl]` — the main report page; `report/[bbl]/pdf` renders the same data via `src/lib/pdf/ReportDocument.tsx` (`@react-pdf/renderer`).
- `property/[bbl]` — route handler, not a page (redirect/lookup helper).
- `p/[borough]/[slug]` — indexable landing pages, served from `property_seo_summaries`, never touch Socrata.
- `r/[token]` — share links (see `src/lib/nyc/share.ts`).
- `api/checkout/*`, `api/stripe/webhook` — Stripe integration; webhook is the only writer of subscription/purchase state.
- `api/search` — address search backed by Supabase PLUTO index, guarded by `src/lib/rate-limit.ts`.
- `auth/confirm`, `auth/callback` — magic-link verification (token-hash flow primary, PKCE fallback; see README "Auth configuration" for why both exist and how the Supabase dashboard must be configured in lockstep with `NEXT_PUBLIC_SITE_URL`).

`src/middleware.ts` refreshes the Supabase session cookie on every request (Server Components can't write cookies themselves) and no-ops if Supabase env vars are absent rather than hard-failing.

### Other cross-cutting pieces

- **`src/lib/site.ts`** — single source of truth for the app's own origin (`NEXT_PUBLIC_SITE_URL`); must be the origin that *serves*, not one that redirects (production is `www`, the apex 308s).
- **`src/lib/rate-limit.ts`** — Postgres-backed (not in-memory, because the quota is shared across Vercel instances) rate limiting for search, purchase recovery, and uncached anonymous report renders. Fails **open** on Supabase outage by design (protects a quota, not a security boundary).
- **`src/lib/observability/capture.ts`** — `captureError` is the only error-reporting call site convention in this codebase; writes structured JSON to stderr always, optionally also POSTs to `ERROR_WEBHOOK_URL`. Prefer it over bare `console.error` in new code so a future vendor SDK swap is one file.
- **`src/lib/email/`** — two independent senders: Supabase sends magic links (dashboard-configured), the app sends purchased-report delivery emails via Resend (`client.ts`/`templates.ts`). The $49 single-purchase tier creates no account, so that email is the only durable way the buyer reaches what they paid for.
- **`supabase/migrations/`** — applied in filename (timestamp) order; already applied to the hosted project. PLUTO is loaded post-migration via repeated calls to the `ingest_pluto_page` SQL function (see README "Database"), not an external ETL worker.
- **`.github/workflows/refresh-seo-summaries.yml`** — the nightly citywide SEO sweep; runs in GH Actions rather than as a Vercel cron because it reads millions of rows and exceeds serverless execution limits. Has an explicit secrets-vs-vars preflight check because a value under the wrong tab silently resolves to empty in Actions.

## Conventions worth knowing before editing

- **Never string-concatenate a BBL or BIN.** Always go through `canonicalBbl`/`splitBbl`/`padBlock`/`padLot` in `bbl.ts`.
- **Server-only modules are marked with the `server-only` import** (e.g. `entitlement.ts`, `socrata.ts` callers) — vitest configs alias `server-only` to a no-op build (`node_modules/server-only/empty.js`) since Vite doesn't set Next's `react-server` condition; don't "fix" that alias away.
- Path alias `@/*` → `src/*` (see `tsconfig.json`).
- Tests are organized by config, not just filename convention: `*.test.ts` (offline unit, default `npm test`), `*.integration.test.ts` (real Supabase + signed-fake Stripe webhooks), `*.live.test.ts` (real NYC Open Data, doubles as a schema-drift alarm — if the city renames a column or changes padding, these fail loudly instead of the product silently reporting zero violations).
