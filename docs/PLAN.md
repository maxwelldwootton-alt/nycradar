# ViolationRadar — Build Plan

**Status:** Spike complete, build not started · **Last updated:** 2026-08-03

This plan is grounded in [`spike/FINDINGS.md`](../spike/FINDINGS.md). Read that first — it changes several PRD assumptions.

---

## 0. What the spike changed

| PRD assumption | Spike finding | Consequence |
|---|---|---|
| ECB/OATH is one source | It is two datasets; `6bgk-3dad` (clean, BIN/BBL-keyed) is better than the named `jz4z-kudi` | Ingest both, dedup between them |
| Cross-source matching is the core risk | **Resolved.** BBL + BIN recovery joins at ~100% on the test set | Risk retires; geocoding takes its place |
| FDNY deferred to Phase 3 | 916k FDNY tickets already in OATH at 96.8% key coverage | Pull into MVP |
| — | ECB and OATH double-count 82.6% of DOB summonses | Dedup rule is **mandatory**, not an optimization |
| — | Condo billing lots (7501+) silently return zero DOB violations | Must be handled at ingest |
| — | 60s SLA is not close to binding (median 3.8s live) | Architect for correctness and freshness, not speed |

**The core technical risk is no longer the join — it is address→BBL geocoding.** GeoSearch could not be reached from the spike environment (network policy). Close that first.

---

## 1. Sequencing

The PRD's Phase 0 validation gate is explicit: *confirm willingness to pay before investing further engineering time.* The spike deliberately did not cross that line, and neither should the next step.

### Phase 0 — Validation (no product code)

**The spike script is already sufficient to run this gate.** It joins all four sources for any BBL today. Wrap it in a thin CLI that renders markdown, hand-run 10–15 reports for BoardFlow-pipeline contacts, and collect the pricing signal the PRD asks for.

- [ ] Validate GeoSearch coverage/rate limits from an unrestricted network (**blocks everything downstream**)
- [ ] Thin CLI over the spike script: address → markdown report
- [ ] 10–15 manual reports for brokers / attorneys / title contacts
- [ ] Spot-check 2–3 against a manual expediter lookup (accuracy metric, PRD §2)
- [ ] Confirm willingness to pay at $199–349/mo → **explicit go/no-go**
- [ ] Book the legal consult on disclaimer language (§10) — long lead time, start now

**Do not write product code until this gate passes.** If it fails, the sunk cost is one throwaway script.

### Phase 1 — MVP

Ingest → lookup → report → paywall. Detail in §2–§5.

### Phase 2 — Tiering
Pro/Premium split, shareable links, usage dashboard.

### Phase 3 — Expansion
API access for title companies, white-label reports, monitoring/alerts. (FDNY moves up to Phase 1.)

---

## 2. Architecture

```
NYC Open Data (Socrata)          Nightly ETL              App
┌──────────────────┐          ┌─────────────┐      ┌──────────────┐
│ DOB   3h2n-5cm9  │          │  normalize  │      │  Next.js     │
│ HPD   wvxf-dwi5  │──────────▶│  canonical  │─────▶│  on Vercel   │
│ ECB   6bgk-3dad  │  SODA    │  BBL + dedup│      │              │
│ OATH  jz4z-kudi  │          │  BIN resolve│      │  Supabase    │
│ PLUTO 64uk-42ks  │          └─────────────┘      │  Postgres    │
└──────────────────┘                               │  + Auth      │
                                                   │              │
        GeoSearch (address → BBL/BIN) ─────────────▶  Stripe      │
                                                   └──────────────┘
```

**Nightly ETL into Postgres, not live pass-through.** Live queries meet the 60s SLA today, but pass-through makes every report hostage to NYC Open Data's uptime, forfeits control of the `data_as_of` timestamp FR7 requires, and cannot support Phase 3 monitoring. Cache is not the point; provenance is.

**Stack** (per PRD §11, consistent with Slatewood Labs): Next.js (App Router) on Vercel · Supabase Postgres + Auth · Stripe · React-PDF or Puppeteer for export.

---

## 3. Data model

```sql
-- Canonical property, one row per tax lot
create table properties (
  bbl              char(10) primary key,      -- boro(1)+block(5)+lot(4)
  borough_code     char(1)  not null,
  block            int      not null,
  lot              int      not null,
  address          text,
  zip              text,
  bldg_class       text,
  units_res        int,
  is_condo_billing_lot boolean generated always as (lot >= 7501) stored,
  underlying_bbl   char(10) references properties(bbl),  -- condo → physical lot
  updated_at       timestamptz not null default now()
);

-- BBL ↔ BIN, resolved at ingest. Solves the condo-billing-lot failure mode.
create table property_bins (
  bbl  char(10) not null references properties(bbl),
  bin  char(7)  not null,
  primary key (bbl, bin)
);
create index on property_bins (bin);

-- Unified violations across all sources
create type violation_agency as enum ('DOB','HPD','ECB','OATH');

create table violations (
  id                bigserial primary key,
  agency            violation_agency not null,
  source_dataset    text not null,             -- e.g. '6bgk-3dad'
  source_id         text not null,             -- native key in that dataset
  dedup_key         text,                      -- ticket/violation no., lstrip('0')
  bbl               char(10) not null references properties(bbl),
  bin               char(7),
  issued_date       date,
  status            text not null,             -- normalized: open | closed
  raw_status        text,                      -- source's own wording
  severity          text,                      -- HPD class A/B/C/I, ECB class
  description       text,
  balance_due       numeric(12,2),
  penalty_imposed   numeric(12,2),
  judgment_docketed date,                      -- lien-risk signal
  issuing_agency    text,                      -- OATH: DOB / FDNY / DEP / DSNY
  correction_type   text,                      -- 'administrative' | 'physical'
  matched_by        text not null,             -- 'bbl' | 'bin' — provenance
  raw               jsonb,
  unique (source_dataset, source_id)
);
create index on violations (bbl, status);
create index on violations (dedup_key);

-- Freshness, surfaced on every report (FR7)
create table ingest_runs (
  id             bigserial primary key,
  dataset_id     text not null,
  rows_updated_at timestamptz,                 -- portal's own rowsUpdatedAt
  fetched_at     timestamptz not null default now(),
  row_count      int,
  status         text not null
);
```

Product tables — `accounts`, `lookups` (rate limiting + FR8 history), `reports` (shareable-link tokens), `stripe_customers` — are conventional; no findings bear on them.

**RLS:** on for everything user-facing. `violations`/`properties` are public reference data, readable by the service role and exposed only through server-side report generation, never queried directly from the client.

---

## 4. ETL rules (non-negotiable)

These encode the spike's findings. Each maps to a measured failure mode.

1. **Never string-concatenate a BBL.** Integer-cast block and lot, re-pad to `boro(1)+block(5)+lot(4)`. DOB pads lot to 5, ECB and OATH to 4 — concatenation produces a key that silently matches nothing.
2. **Null out sentinel BINs** — `'0000000'` and any `X000000` borough placeholder (0.15% of DOB rows).
3. **Resolve condo billing lots at ingest.** For every lot ≥ 7501, resolve BINs and store `underlying_bbl`. Reports for a condo must union violations from both the billing lot and the underlying physical lot, or DOB violations vanish.
4. **Map OATH borough names → codes.** Note `'STATEN IS'`, not `'STATEN ISLAND'`.
5. **Filter OATH by issuing agency.** Keep DOB, FDNY, DEP, DSNY, Asbestos, DOHMH. Citywide, only ~4% of OATH rows are property-attached; unfiltered ingest is mostly parking and TLC noise.
6. **Dedup ECB against OATH on `lstrip('0')`.** 82.6% of ECB summonses also appear in OATH. Exact match finds *zero* overlap — the leading zero hides it. Skipping this roughly doubles both violation counts and dollars owed.
7. **Record `rowsUpdatedAt` per dataset per run.** The report's "data as of" is the **oldest** of the four, not the newest.
8. **Store `matched_by`.** Knowing whether a violation was matched by BBL or recovered via BIN is the audit trail for accuracy complaints.

**Schedule:** nightly, all four datasets update daily. Incremental by issue/update date after the first full load; ~37M rows total, so the initial load should be a bulk CSV export rather than paginated SODA calls. Register a free Socrata app token.

---

## 5. Product notes worth deciding early

- **Correction complexity flag (PRD §4.3).** Derivable from violation type codes — HPD class I and DOB administrative categories map to "paperwork"; HPD class B/C and most ECB construction/elevator types map to "requires physical correction". Keep it a two-value flag. Anything more prescriptive drifts toward the advice boundary in §5/§12.
- **Lead with docketed judgments and `balance_due`.** That is the deal-blocking number in the problem statement, it is available structured, and no 24-hour manual competitor surfaces it instantly. It is the product's sharpest differentiator.
- **Multi-building lots.** 51.9% of test lots span >1 BIN; Co-op City spans 249. Aggregate by BBL (that is what transfers with the deed), with a per-building breakdown when `distinct_bins > 1`.
- **Disclaimer is a component, not a footer string.** FR7 + §10 require it on screen, in PDF, and on shared links. Build it once with `data_as_of` injected.
- **$49 → $199 credit (FR5b).** Stripe supports this via a one-off coupon or customer balance credit, but it adds real branching. Ship without it; add if users ask. The PRD already flags this as optional.

---

## 6. Setup steps

Nothing below should start until the Phase 0 gate passes — except step 1, which *is* Phase 0.

### 1. Close the geocoding dependency (blocking)

```bash
curl "https://geosearch.planninglabs.nyc/v2/search?text=350+5th+Ave+Manhattan&size=1"
# expect properties.addendum.pad.bbl and .bin
```

Run from an unrestricted network. Confirm BBL/BIN presence, rate limits, and autocomplete quality (FR1). If unusable, request a free GeoClient key from NYC DoITT — allow lead time.

### 2. Accounts

Supabase project (region `us-east-1`) · Vercel project · Stripe account · Socrata app token (free, raises ETL rate limits) · domain.

### 3. Scaffold

```bash
npx create-next-app@latest violationradar --typescript --app --tailwind
cd violationradar
npm i @supabase/supabase-js @supabase/ssr stripe @stripe/stripe-js zod
npm i -D supabase
npx supabase init && npx supabase link --project-ref <ref>
```

### 4. Environment

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # server-only, never NEXT_PUBLIC_
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
SOCRATA_APP_TOKEN=
GEOCLIENT_KEY=                  # only if GeoSearch is unusable
```

### 5. Schema and ETL

Migrations from §3 via `supabase migration new`. ETL as a standalone Node/Python worker — **not** a Vercel serverless function; the initial ~37M-row load will exceed any serverless timeout. Run it on a small box or a scheduled container, with a Vercel cron only for the nightly incremental trigger.

Order: PLUTO → `properties`; DOB + HPD + ECB → `property_bins` + `violations`; resolve condo `underlying_bbl`; OATH filtered by agency; dedup pass; write `ingest_runs`.

### 6. Stripe

Products: **Single Report** $49 one-time · **Pro** $199/mo · **Premium** $349/mo (Phase 2). Enable the customer portal. Webhook → `/api/stripe/webhook` on `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`. Verify signatures; treat the webhook as the source of truth for entitlement, never client state.

### 7. Build order

Report generation first, behind a dev-only route — it is the product, and everything else is packaging. Then geocode/search (FR1) → free-tier rate limit (FR4) → Stripe paths (FR5/5a) → PDF + share links (FR6) → dashboard (FR8).

### 8. Pre-launch

- [ ] Legal review of disclaimer language completed (§12 — the one item with external lead time)
- [ ] Accuracy spot-check vs. manual expediter on 5+ properties
- [ ] Re-run the join against a few thousand lots to tighten the match-rate estimate
- [ ] Verify no report path can render without `data_as_of` and disclaimer
- [ ] Confirm no copy implies certification, guarantee, or completeness (§10)

---

## 7. Open risks

| Risk | State | Mitigation |
|---|---|---|
| Address→BBL geocoding | **Open — blocking** | Validate GeoSearch; GeoClient fallback |
| Cross-source join | **Closed** by spike | BBL + BIN recovery, ~100% on test set |
| ECB/OATH double-count | **Closed** — rule defined | Dedup on `lstrip('0')`, enforced at ingest |
| Condo billing lots | **Closed** — mechanism understood | Resolve `underlying_bbl` at ingest |
| Match rate at scale | Partially open | 27 lots proves the mechanism, not the citywide rate; re-measure during ETL build |
| Disclaimer adequacy | Open | Legal consult — start early, long lead time |
| Free-tier conversion (1/email/30d) | Open | Instrument from day one; $49 tier already hedges it |
| NYC Open Data schema drift | Open | Assert expected columns per ETL run; fail loudly |
| Willingness to pay | **Open — gates everything** | Phase 0 |
