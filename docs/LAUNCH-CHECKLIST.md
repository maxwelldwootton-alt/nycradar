# Launch checklist

Everything here is a gate, not a nice-to-have: each item is either something a
user hits on day one, or something whose absence is only discovered by a
customer. Items are grouped by who has to do them, because the long pole is
external.

Related: [`docs/LEGAL-REVIEW.md`](LEGAL-REVIEW.md) · [`docs/PLAN.md`](PLAN.md) §8

---

## 1. External — start these first

They have lead times measured in days or weeks and nothing else depends on our
own progress.

- [ ] **Send the legal review packet.** [`docs/LEGAL-REVIEW.md`](LEGAL-REVIEW.md)
      is ready to send once §5 of it is filled in. Q1 and Q2 can change what
      ships, so a late answer is a late launch.
- [ ] **Verify the sending domain** with the email provider (SPF, DKIM, DMARC).
      Unverified, mail is accepted and then filed as spam — which for the $49
      tier means the buyer receives nothing.
- [ ] **Replace Supabase's built-in email sender.** It is rate-limited to a
      handful of messages per hour and is explicitly not for production. Every
      magic-link sign-in goes through it. Authentication → Emails → SMTP.
- [ ] **Register a Socrata app token** and set `SOCRATA_APP_TOKEN`. Anonymous
      SODA requests are throttled aggressively and each report is ~6 of them.

---

## 2. Configuration

- [ ] `NEXT_PUBLIC_SITE_URL` set to the production origin, and that exact URL
      added to Supabase → Authentication → URL Configuration → **both** Site URL
      and the Redirect URLs allowlist. A mismatch does not error — sign-in
      silently redirects to `http://localhost:3000`. See README → Auth.
- [ ] Supabase email templates point at `/auth/confirm` with a token hash, with
      the **Confirm signup** template using `type=signup` (a first-time email
      uses that template, not Magic Link, and the wrong `type` fails
      verification). See README.
- [ ] `RESEND_API_KEY` and `EMAIL_FROM` set. Without them purchases complete and
      deliver nothing.
- [ ] `ERROR_WEBHOOK_URL` set, and someone is actually watching wherever it
      points.
- [ ] Stripe: products and prices created, customer portal enabled, webhook
      pointed at `/api/stripe/webhook` for `checkout.session.completed` and
      `customer.subscription.{created,updated,deleted}`, and
      `STRIPE_WEBHOOK_SECRET` set from the live endpoint (not the test one).
- [ ] **`npm run check:db` passes against production.** This replaces the old
      "migrations applied" checkbox, which was wrong twice — see below. It asks
      the database whether every object the app calls is actually there, rather
      than trusting that a merge reached it.
- [ ] Migrations applied to the production project: `supabase db push`.

> **"Merged" has not meant "deployed" on this project, twice.** Both times the
> gap was silent, because both affected systems fail open:
>
> * `rate_limits` / `sample_properties` were merged and never applied. The rate
>   limiter had no table, so it simply stopped limiting. *(Found and fixed
>   2026-08-05.)*
> * `claim_free_lookup` was merged and never applied. Every free-tier claim
>   errored, `recordLookup` failed open, nothing was ever written to `lookups`,
>   and `free_lookups_remaining` answered 1 forever — **the free tier was
>   effectively unlimited, and nothing anywhere reported an error.** *(Found and
>   fixed 2026-08-05; the free tier had never actually enforced in production.)*
>
> Neither was catchable by tests, typecheck, or build: RPC names are string
> literals, so nothing upstream of the live database knows they are wrong. That
> is what `npm run check:db` and `assert_db_contract()` now cover. When you add
> a table or RPC the app depends on, add it to the contract too.
- [ ] PLUTO loaded — `select ingest_pluto_page(0, 5000);` until it returns 0.
      Address search returns nothing without it.
- [ ] **`npm run seo:refresh` has run at least once, and is scheduled.** The
      public `/p/{borough}/{slug}` pages read only `property_seo_summaries`; an
      empty table means every landing page 404s and the whole indexable surface
      is missing. Unscheduled, it silently goes stale instead.

---

## 3. Accuracy — measure it, then write the numbers down

`spike/FINDINGS.md` established that the join mechanism works on 27 lots. It
explicitly does **not** establish a citywide rate, and it could not measure
address resolution at all.

```bash
npm run accuracy:join   -- --sample 1000 --out reports/join.json
npm run accuracy:search -- --sample 400  --out reports/search.json
```

- [x] **Join, 400 lots — 2026-08-05.** Sampled live via `sample_properties(400)`
      against the hosted project, run against live NYC Open Data (no
      `SOCRATA_APP_TOKEN`):

      ```
      400/400 succeeded, 0 failures
      condo billing lots: 5   ·   multi-building lots: 17 (4.3%)

      agency   lots with data   share    recovered by BIN
      DOB      115              28.7%    4
      HPD      120              30.0%    0
      ECB      149              37.3%    1
      OATH     285              71.3%    0

      BIN recovery fired on 5 lots — 4 DOB lots and 1 ECB lot would have shown
      zero violations without it. (Cleanly consistent with the sample's 5
      condo billing lots — see the note on the discarded first run, below.)

      ECB/OATH duplicates removed: 606 across 129 lots (32.3%)
      Latency: median 0.5s · p95 1.2s · max 4.4s
      ```

      **This run superseded a first one from the same session, and the reason
      why is worth keeping on the record.** The first 400-lot run measured
      142 lots with ECB data and 8 needing BIN recovery to get there. Before
      writing those numbers down, `main` was found to have moved: issue/PR #17
      landed the same day, fixing `fetchByBbl` in `dob.ts`/`ecb.ts`/`oath.ts`,
      which had filtered lot with a single exact-padded string and silently
      dropped rows recorded at the *other* valid width — up to ~23% of ECB
      rows in #17's own spot check. The first run had been measured against
      the pre-fix code without that being known at the time. Re-running the
      *identical* 400-lot sample against the fix moved ECB coverage from
      142→149 lots and — tellingly — dropped ECB's BIN-recovery count from
      8→1: most of what looked like rule 3 (condo BIN recovery) "saving" those
      8 ECB lots was actually rule 3 compensating for the padding bug, not
      genuine condo billing lots. The corrected run's BIN-recovery count (5
      lots) lines up exactly with the sample's 5 condo billing lots, which is
      the number rule 3 was designed to explain. The discarded run's
      `reports/join.json` was not committed; this entry and the JSON now in
      the repo are the corrected numbers only.

      **Read the "share" column as prevalence, not the spike's match rate —
      this is not an apples-to-apples number and writing it up as one would be
      a false-precision mistake.** The spike measured *recall*: of lots
      independently verified to hold a record, how often the join found it,
      against a hand-curated known-positive set. This run has no such ground
      truth for a random sample — a true zero and a missed record both read as
      "0 rows back, no error." (I mislabeled this in the script's own
      docstring when I first wrote it — "this is the headline match rate" —
      and only caught it once I had a real run to check the claim against.
      Fixed in `scripts/accuracy-join.ts`, along with a printed reminder on
      every future run.)

      What this run *does* establish, and is worth exactly as much as a match
      rate for different reasons: **zero technical failures across 400 live
      lots** (nothing thrown, nothing timed out); **rules 3 and 6 are not dead
      code** — BIN recovery and the ECB/OATH dedup both fired on unremarkable
      real traffic, not just the spike's hand-picked edge cases, and now that
      the padding bug is fixed, rule 3's count reflects condo billing lots
      specifically rather than a mix of that and a masked bug; and
      **multi-building lots are far rarer in reality (4.3%) than the spike's
      sample suggested (51.9%)** — direct, first-hand confirmation of what
      `spike/FINDINGS.md` §9 already said in words: the spike's test set was
      deliberately skewed toward heavily-cited properties and its volumes are
      not representative of typical housing stock.

      **True recall is still open** and needs the item below, scaled up from 5
      to a real number before this checkbox means what the spike's numbers
      meant. Re-run at ≥1000 with `SOCRATA_APP_TOKEN` set for a second data
      point; full per-lot results from this run are in
      `reports/join-2026-08-05.json`.

- [ ] **Dedup is non-zero.** ✅ as of the run above (606 removed, 129/400 lots
      affected) — re-check this box on every future run. A run reporting zero
      ECB/OATH duplicates means the leading-zero key has drifted, not that the
      data changed, and both the counts and the dollar totals are then close
      to doubled.
- [ ] **Address resolution, ≥400 lots — not yet run.** `searchProperties()`
      calls the project's Supabase PostgREST API directly (not just NYC Open
      Data, unlike the join measurement), so this cannot run from a
      network-restricted sandbox — confirmed via a `403` on the `CONNECT`
      tunnel to `*.supabase.co`, not attempted and guessed at. Run it from a
      machine with real network access to the Supabase project, with
      `.env.local` populated per `.env.example`:

      ```bash
      npm run accuracy:search -- --sample 400 --out reports/search.json
      ```

      Record the headline figure:

      rank-1 ____%   confidently wrong ____%

      "Confidently wrong" — top hit labelled `exact` but the wrong lot — is the
      number that matters. A thin report from a join miss is visibly thin; a
      complete report about the wrong building is not.
- [ ] **Spot-check 5+ properties against a manual expediter lookup**
      (PLAN.md §8). Neither script has independent ground truth — see the
      recall caveat above — so this manual check is what actually measures
      accuracy in the spike's sense, just at a larger scale than 27 lots.
- [ ] Decide whether the measured error rate gets published — see
      [`LEGAL-REVIEW.md`](LEGAL-REVIEW.md) Q3.

**Also fixed while running this:** `rate_limits` and `sample_properties`
(both from the merged launch-blockers PR) had never been pushed to the hosted
Supabase project — `supabase db push` was never run against it after merge.
Applied directly 2026-08-05; both are additive-only. Rate limiting was
therefore silently inert in production (fails open by design, so nothing broke
visibly) until this fix. If you deploy this repo to a *different* Supabase
project, confirm `supabase db push` — or the equivalent — actually ran; don't
assume "merged" means "applied."

---

## 4. Paths that must be walked end-to-end on production

Not unit-tested, because the failure modes are in the integrations.

- [ ] **Anonymous → teaser.** Search an address, land on the teaser at
      `/report/{bbl}`, confirm no violation detail, balances, or judgment counts
      leak into the HTML.
- [ ] **Indexable landing page.** `/p/{borough}/{slug}` renders from the nightly
      summary, and `/property/{bbl}` 301s to it.
- [ ] **Magic-link sign-in from a different browser than the one that
      requested it** — open the link on a phone after requesting on a desktop.
      This is the case PKCE cannot serve and the token-hash flow exists for.
- [ ] **Free tier.** One full report, then confirm the second is paywalled.
      Do this with a **fresh** email — one with an existing `lookups` row is
      already paywalled and will pass whether or not the limit works. This is
      the check that would have caught the unlimited-free-tier bug above, and
      only on a first-time address.
- [ ] **$49 purchase, in full, with a real card.** Complete checkout →
      confirm the delivery email arrives → open the link from the email in a
      browser with no session → confirm the full report renders.
- [ ] **Purchase recovery.** `/purchase/recover` with the buying address
      re-sends the link; with an address that never purchased, confirm the
      response is identical and no email is sent.
- [ ] **Subscription.** Subscribe, confirm unlimited lookups, open the billing
      portal, cancel, confirm access ends at period end.
- [ ] **Share link.** Create one, open it signed-out, confirm it shows the
      sender's data-as-of date rather than regenerating.
- [ ] **PDF export** renders with the disclaimer and the data-as-of date.

---

## 5. Guardrails

- [ ] **Rate limiting is live.** Confirm `/api/search` returns 429 under a
      burst, and that `rate_limits` is accumulating rows. Fail-open is
      deliberate — if Supabase is unreachable the limiter allows rather than
      blocks — so a limiter that has quietly stopped working looks exactly like
      one that is working. Check the table, not the behaviour.
- [ ] **The global render budget is sized for expected traffic.**
      `guardPublicReportRender` allows 2000 uncached *anonymous* report renders
      per hour across the whole site. It does not touch the `/p/` landing pages
      (they read the nightly summary table, never Socrata) and never throttles
      an entitled user. That is a circuit breaker, not a throttle; if launch
      traffic is expected to exceed it, raise it deliberately rather than
      discovering it as an outage.
- [ ] **No report surface can render without `data_as_of` and the disclaimer**
      (PLAN.md §8). Check the web report, the PDF, and a share link.
- [ ] **A failing city API degrades visibly.** "We couldn't reach this agency"
      must never render as "nothing on file" — on a due-diligence product those
      are opposite answers.
- [ ] Confirm `SUPABASE_SERVICE_ROLE_KEY` is set. Without it entitlement fails
      closed to the teaser, which looks like a broken paywall rather than an
      unconfigured deployment.

---

## 6. Known gaps at launch — decide, don't discover

These are deliberate. Listed so they are choices on the record rather than
surprises.

- **No monitoring or alerts.** The subscription tier's value proposition is
  weakest here: at $199/mo against $49 one-off, a subscriber needs four reports
  a month to break even, and brokers close fewer deals than that. Whoever owns
  pricing should know this before launch, not after the first renewal cycle.
- **Reports are generated live, not from a nightly ETL.** PLAN.md §2 argues for
  the ETL; the app currently caches instead. This is workable for launch and it
  is what blocks monitoring, trend history, and provenance control.
- **No FISP/facade, stop-work-order, vacate-order, or open-complaint data.**
  Each is deal-blocking and none is in the report.
