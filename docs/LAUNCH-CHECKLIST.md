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
- [ ] Migrations applied to the production project: `supabase db push`. The two
      newest add rate limiting and the accuracy-sampling helper.
- [ ] PLUTO loaded — `select ingest_pluto_page(0, 5000);` until it returns 0.
      Address search returns nothing without it.

---

## 3. Accuracy — measure it, then write the numbers down

`spike/FINDINGS.md` established that the join mechanism works on 27 lots. It
explicitly does **not** establish a citywide rate, and it could not measure
address resolution at all. Both are now measurable:

```bash
npm run accuracy:join   -- --sample 1000 --out reports/join.json
npm run accuracy:search -- --sample 400  --out reports/search.json
```

- [ ] **Join, ≥1000 lots.** Record per-source coverage here:

      DOB ____%   HPD ____%   ECB ____%   OATH ____%   failures ____%

- [ ] **Dedup is non-zero.** A run reporting zero ECB/OATH duplicates means the
      leading-zero key has drifted, not that the data changed — and both the
      counts and the dollar totals are then close to doubled. The script warns
      about this explicitly.
- [ ] **Address resolution, ≥400 lots.** Record the headline figure:

      rank-1 ____%   confidently wrong ____%

      "Confidently wrong" — top hit labelled `exact` but the wrong lot — is the
      number that matters. A thin report from a join miss is visibly thin; a
      complete report about the wrong building is not.
- [ ] **Spot-check 5+ properties against a manual expediter lookup**
      (PLAN.md §8). The scripts measure internal consistency against PLUTO;
      this is the only check against outside ground truth.
- [ ] Decide whether the measured error rate gets published — see
      [`LEGAL-REVIEW.md`](LEGAL-REVIEW.md) Q3.

---

## 4. Paths that must be walked end-to-end on production

Not unit-tested, because the failure modes are in the integrations.

- [ ] **Anonymous → teaser.** Search an address, land on the teaser, confirm no
      violation detail, balances, or judgment counts leak into the HTML.
- [ ] **Magic-link sign-in from a different browser than the one that
      requested it** — open the link on a phone after requesting on a desktop.
      This is the case PKCE cannot serve and the token-hash flow exists for.
- [ ] **Free tier.** One full report, then confirm the second is paywalled.
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
      `guardPublicReportRender` allows 2000 uncached property renders per hour
      across the whole site. That is a circuit breaker, not a throttle; if
      launch traffic is expected to exceed it, raise it deliberately rather than
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
