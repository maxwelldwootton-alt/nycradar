# nycradar

**ViolationRadar** (working name) — unified NYC property violation reports across DOB, HPD, and ECB/OATH.

Next.js + Supabase. Reports are generated on demand from NYC Open Data; address search runs against a locally ingested PLUTO index.

## Documents

| Document | What it is |
|---|---|
| [`spike/FINDINGS.md`](spike/FINDINGS.md) | Data feasibility spike — **read this first**, it explains why the code is shaped the way it is |
| [`docs/PLAN.md`](docs/PLAN.md) | Build plan, data model, ETL rules |
| [`docs/LAUNCH-CHECKLIST.md`](docs/LAUNCH-CHECKLIST.md) | What has to be true before this is public |
| [`docs/LEGAL-REVIEW.md`](docs/LEGAL-REVIEW.md) | Packet for the disclaimer/ToS review — the longest external lead time |

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

It must be the origin that actually **serves**, not one that redirects to it. Production is `https://www.nycviolationhub.com`; the apex 308s to `www`. Pointing this at the apex makes every canonical tag, sitemap entry and og:image URL reference a redirect — crawlers discount those and most link unfurlers don't follow them. `src/lib/site.ts` is the single source for it, and its default is the real production host rather than a placeholder, because an unset variable otherwise fails silently and looks like working software.

`RESEND_API_KEY` and `EMAIL_FROM` are **required in production**. See "Email" below.

### Auth configuration

Magic-link sign-in requires **both** of these to be set correctly in the Supabase dashboard, under Authentication → URL Configuration, per environment:

- **Site URL** — the fallback Supabase uses whenever a `redirectTo` isn't recognized
- **Redirect URLs** — an allowlist; anything not on it is silently discarded

If a deployment's URL isn't on the allowlist, sign-in doesn't error — it silently redirects to whatever **Site URL** happens to be set to, which defaults to `http://localhost:3000`. This is easy to hit on a fresh environment or a new preview domain and looks identical to a broken app. `LoginForm.tsx` sends `NEXT_PUBLIC_SITE_URL` as the redirect precisely so it matches a stable, allowlisted value rather than whatever host the browser happened to load from.

Because of that, **Supabase's Site URL and `NEXT_PUBLIC_SITE_URL` must name the same origin**, down to the `www`. `https://nycviolationhub.com` and `https://www.nycviolationhub.com` are different entries as far as the allowlist is concerned, so changing one without the other reproduces exactly the silent-bounce failure above. Update Supabase first, then the environment variable.

#### Email templates are part of the auth contract

Sign-in uses the **token hash** flow, not PKCE, so the emailed link works when opened in a different browser from the one that requested it — iOS Mail's in-app browser, or a link forwarded to a desktop. PKCE cannot: its code verifier is a cookie belonging to the requesting browser, so the exchange fails client-side without ever reaching Supabase.

That means the email templates must point at `/auth/confirm` and pass a token hash. Under Authentication → Email Templates:

- **Magic Link** — `<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">Sign in</a>`
- **Confirm signup** — same, but `type=signup` (a first-time email uses this template, not Magic Link, and the wrong `type` fails verification)

`{{ .RedirectTo }}` already carries the `?next=…` the app set, so appending with `&` preserves the destination the user was heading to.

`/auth/confirm` also accepts a PKCE `?code=`, so the code deploy and the template edit are order-independent: an un-updated template still signs users in via the older path rather than breaking outright. `/auth/callback` likewise stays, because links minted before this switch remain valid for a while. Both fallbacks can go once no old links are in flight.

Also worth knowing: Supabase's built-in email sender is rate-limited to a handful of messages per hour and is not meant for production. Configure a real SMTP provider (Resend, Postmark, etc.) under Authentication → Emails before real users sign in.

### Email

Two separate senders, and both have to work:

- **Supabase** sends magic links, configured in the dashboard (above).
- **The app** sends purchased reports, via `src/lib/email/client.ts` and the Resend HTTP API, configured with `RESEND_API_KEY` and `EMAIL_FROM`.

The second is not a nicety. The $49 tier deliberately creates no account, so the emailed link is the *only* durable way that buyer reaches what they paid for. With mail unconfigured, checkout still succeeds and delivers nothing.

`/purchase/recover` is the backstop: enter the buying email, get the links re-sent. It answers identically whether or not the address has purchases — anything else would make it an oracle for who is a customer, on a product whose customers are mid-transaction on identifiable properties.

`EMAIL_FROM` must be on a domain verified with the provider (SPF/DKIM/DMARC), or the mail is accepted and then filed as spam.

### Rate limiting

The indexable `/p/{borough}/{slug}` pages read the nightly summary table and never touch Socrata, so crawl traffic isn't the exposure. `/report/[bbl]` is: it answers for any of NYC's ~858k tax lots, each uncached render is roughly six SODA calls, and an anonymous visitor's teaser is rendered *from a full report* — so an unentitled view costs exactly what a paid one does. Someone enumerating BBLs there can spend the app's entire Socrata quota, and a throttled app serves degraded reports to paying customers.

`src/lib/rate-limit.ts` guards address search, purchase recovery, and uncached anonymous report renders, counting in Postgres rather than in memory because the quota is shared across every Vercel instance. Entitled users are never throttled — they have paid for the lookup, or are inside a subscription that promises unlimited ones.

Two things to know about it:

- **It fails open.** If Supabase is unreachable the limiter allows the request. Its job is protecting a quota under abnormal load, not being a security control, and letting its own outage take down search would trade a cost problem for an availability one.
- **A limiter that has silently stopped working looks exactly like one that is working.** Check that `rate_limits` is accumulating rows rather than inferring it from behaviour.

### Errors

`captureError` in `src/lib/observability/capture.ts` writes one structured JSON line per error to stderr, always — that is what a log drain consumes, and it needs no configuration. Set `ERROR_WEBHOOK_URL` as well and errors are also POSTed somewhere a human will see them; the payload works as-is with a Slack incoming webhook. Repeats of the same failure are collapsed for a minute so one failing dependency can't flood the channel.

Call sites use `captureError` rather than `console.error` so that swapping in a vendor SDK later is one file rather than a sweep through every catch block.

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

# Pre-launch accuracy measurement (docs/LAUNCH-CHECKLIST.md §3).
# Both need SUPABASE_SERVICE_ROLE_KEY, and in practice SOCRATA_APP_TOKEN.
npm run accuracy:join   -- --sample 1000 --out reports/join.json
npm run accuracy:search -- --sample 400  --out reports/search.json
npm run screenshots            # visual sweep, light + dark, mobile + desktop
```

`npm run report` is also the tool for running the PRD's Phase 0 validation reports by hand.

`npm run screenshots` drives a running dev server with Playwright and writes PNGs to `screenshots/`. Because there is deliberately no theme toggle — the app follows `prefers-color-scheme` — Playwright's `colorScheme` context option is the only practical way to check the dark palette. Add `REPORT_BBL=3000017501` to include a report page, and `CHROMIUM_PATH=…` if the environment already has a Chromium that doesn't match the installed Playwright's expected build.

## Testing

Unit tests cover the normalization and dedup rules using fixtures recorded by the spike. The live suite asserts the spike's specific measurements against the real APIs and doubles as a **schema-drift alarm** — if the city renames a column or changes a padding convention, it fails loudly instead of the product quietly reporting zero violations.

Worth knowing: `1 John Street, Brooklyn` (BBL `3000017501`) is the canonical regression case. It must show non-zero DOB violations; a naive BBL join returns zero and renders it as a clean building.

## Status

MVP built and deployed to `https://www.nycviolationhub.com` (Vercel, connected to `main`).

**Verified live:** homepage, address search (Supabase-backed, including the condo-billing-lot case), report generation against live NYC Open Data, the anonymous paywall/teaser, and PDF-export gating (402 when not entitled).

**Not yet verified:**

- **Stripe flows** — need test keys
- **Magic-link auth end to end** — the redirect misconfiguration that sent links to `localhost` is fixed (see Auth configuration above), but a full click-through hasn't completed yet
- **Phase 0 validation gate** — the PRD's willingness-to-pay check is still open
- **Disclaimer language** — needs the legal review called for in PRD §12 before public launch
- **Deployment protection** — Vercel's SSO gate is currently on, so the site isn't publicly reachable yet; intentional until the above are closer to done
