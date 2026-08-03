# nycradar

**ViolationRadar** (working name) — unified NYC property violation reports across DOB, HPD, and ECB/OATH.

Next.js + Supabase. Reports are generated on demand from NYC Open Data; address search runs against a locally ingested PLUTO index.

## Documents

| Document | What it is |
|---|---|
| [`spike/FINDINGS.md`](spike/FINDINGS.md) | Data feasibility spike — **read this first**, it explains why the code is shaped the way it is |
| [`docs/PLAN.md`](docs/PLAN.md) | Build plan, data model, ETL rules |

## The five rules

Every one of these encodes a measured finding from the spike, and each guards a failure mode that produces a report that is *wrong but plausible*. They live in `src/lib/nyc/` and are covered by tests.

1. **Never string-concatenate a BBL.** DOB pads lot to 5 characters, ECB and OATH to 4, HPD not at all. Integer-cast and re-pad to `boro(1)+block(5)+lot(4)`.
2. **Reject sentinel BINs** — `0000000` and `X000000` borough placeholders.
3. **Recover condo billing lots via BIN.** DOB files against the underlying physical lot while HPD and ECB file against the billing lot (7501+), so a pure BBL join reports a condo as a clean building.
4. **Filter OATH by issuing agency.** Only ~4% of its 21.9M rows are property-attached; the rest are parking and TLC.
5. **Deduplicate ECB against OATH on leading-zero-stripped identifiers.** 82.6% overlap, and exact matching finds *none* of it.

## Layout

```
src/lib/nyc/          report engine — sources, join, dedup, classification
src/lib/nyc/report.ts orchestration (the five rules)
src/lib/auth/         entitlement resolution
src/lib/pdf/          PDF report document
src/app/              Next.js routes
supabase/migrations/  schema, address search, PLUTO ingest
spike/                the disposable feasibility spike
```

## Setup

```bash
npm install
cp .env.example .env.local     # fill in Supabase, Stripe, Socrata values
npm run dev
```

### Environment

See `.env.example`. `SUPABASE_SERVICE_ROLE_KEY` is server-only — never prefix it with `NEXT_PUBLIC_`. Without it, entitlement resolution deliberately fails closed to the teaser rather than serving full reports.

`SOCRATA_APP_TOKEN` is optional but strongly recommended in production; anonymous SODA requests are throttled aggressively.

`NEXT_PUBLIC_SITE_URL` is load-bearing for magic-link auth, not just Stripe redirects and share links — see below.

### Auth configuration

Magic-link sign-in requires **both** of these to be set correctly in the Supabase dashboard, under Authentication → URL Configuration, per environment:

- **Site URL** — the fallback Supabase uses whenever a `redirectTo` isn't recognized
- **Redirect URLs** — an allowlist; anything not on it is silently discarded

If a deployment's URL isn't on the allowlist, sign-in doesn't error — it silently redirects to whatever **Site URL** happens to be set to, which defaults to `http://localhost:3000`. This is easy to hit on a fresh environment or a new preview domain and looks identical to a broken app. `LoginForm.tsx` sends `NEXT_PUBLIC_SITE_URL` as the redirect precisely so it matches a stable, allowlisted value rather than whatever host the browser happened to load from.

Also worth knowing: Supabase's built-in email sender is rate-limited to a handful of messages per hour and is not meant for production. Configure a real SMTP provider (Resend, Postmark, etc.) under Authentication → Emails before real users sign in.

### Database

Migrations in `supabase/migrations/` are already applied to the hosted project. For a fresh environment:

```bash
supabase link --project-ref <ref>
supabase db push
```

Then load PLUTO (~858k tax lots, runs in-database, no external worker):

```sql
-- Repeat until it returns 0; ~172 pages of 5,000.
select ingest_pluto_page(0, 5000);
```

## Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run test         # unit tests (offline)
npm run test:live    # integration tests against live city APIs
npm run report -- 3000017501   # CLI report for a BBL
```

`npm run report` is also the tool for running the PRD's Phase 0 validation reports by hand.

## Testing

Unit tests cover the normalization and dedup rules using fixtures recorded by the spike. The live suite asserts the spike's specific measurements against the real APIs and doubles as a **schema-drift alarm** — if the city renames a column or changes a padding convention, it fails loudly instead of the product quietly reporting zero violations.

Worth knowing: `1 John Street, Brooklyn` (BBL `3000017501`) is the canonical regression case. It must show non-zero DOB violations; a naive BBL join returns zero and renders it as a clean building.

## Status

MVP built and deployed to `https://nycradar.vercel.app` (Vercel, connected to `main`).

**Verified live:** homepage, address search (Supabase-backed, including the condo-billing-lot case), report generation against live NYC Open Data, the anonymous paywall/teaser, and PDF-export gating (402 when not entitled).

**Not yet verified:**

- **Stripe flows** — need test keys
- **Magic-link auth end to end** — the redirect misconfiguration that sent links to `localhost` is fixed (see Auth configuration above), but a full click-through hasn't completed yet
- **Phase 0 validation gate** — the PRD's willingness-to-pay check is still open
- **Disclaimer language** — needs the legal review called for in PRD §12 before public launch
- **Deployment protection** — Vercel's SSO gate is currently on, so the site isn't publicly reachable yet; intentional until the above are closer to done
