# Legal review packet

**Status:** Not yet sent · **Owner:** _unassigned_ · **Blocking:** public launch

PLAN.md §6 and §8 both flag this as the one pre-launch item with external lead
time, which means it is the one worth starting before everything around it is
finished. This document exists so that starting it is a single email rather than
a week of assembling context.

> This packet frames questions for counsel. It is not itself legal analysis, and
> nothing in it should be treated as a substitute for the review it is
> requesting.

---

## 1. What the product does, in the terms a reviewer needs

ViolationRadar takes a New York City address, resolves it to a tax lot (BBL),
and returns a single report aggregating violation records that the City already
publishes on NYC Open Data across four datasets:

| Agency | What it covers |
|---|---|
| DOB (`3h2n-5cm9`) | Buildings Department civil penalties |
| HPD (`wvxf-dwi5`) | Housing maintenance code violations, classed A/B/C/I |
| ECB (`6bgk-3dad`) | DOB-issued summonses adjudicated at OATH |
| OATH (`jz4z-kudi`) | The citywide adjudication docket — DOB, FDNY, DEP, DSNY, DOHMH |

The report states, per property: counts of open and total violations, the
outstanding balance owed, and **whether a judgment has been docketed**. That
last figure is the commercially significant one — a docketed judgment can
attach as a lien — and it is the number buyers are relying on.

**Who buys it:** real-estate brokers, closing attorneys, title companies, and
individual buyers and sellers, at the point of pre-closing due diligence.

**Three delivery surfaces, all of which carry the same disclaimer component:**
the web report, a PDF export, and an unauthenticated share link that the
purchaser forwards to third parties (counterparties, clients, lenders).

**What it is not, and where the product already draws the line:** the report
classifies what kind of work a violation implies — "paperwork" vs. "physical
correction" — using the City's own categories. It does not recommend a course
of action, estimate cost, assess the likelihood of contesting a violation
successfully, or opine on whether a transaction should proceed. That boundary
is enforced in code and commented as such in `src/lib/nyc/classify.ts`.

---

## 2. The exact language currently shipped

Reviewers should mark up the real strings, not a paraphrase. All of these are
live in the codebase today.

### 2.1 The report disclaimer — `src/components/Disclaimer.tsx`

Rendered on the web report, in the PDF, and on every shared link. `{date}` is
the **oldest** of the four source datasets' publication timestamps.

> **Important information**
>
> This report is compiled from public New York City Open Data records published
> by the Department of Buildings, Housing Preservation & Development, and the
> Office of Administrative Trials and Hearings, as of **{date}**. City systems
> are updated on their own schedules and this report may not reflect very recent
> activity.
>
> This report is informational only. It does not constitute legal advice, is not
> a title search, and should not be the sole basis for a real estate transaction
> decision. Verify any finding that matters to your transaction independently or
> through a licensed professional before relying on it at closing.

### 2.2 The site-wide footer — `src/components/chrome/SiteFooter.tsx`

> Reports are compiled from public NYC Open Data records published by the
> Department of Buildings, Housing Preservation & Development, and the Office of
> Administrative Trials and Hearings. They are informational only: they do not
> constitute legal advice, are not a title search, and should not be the sole
> basis for a transaction decision.

### 2.3 Marketing copy that makes a factual claim

From the landing page (`src/app/page.tsx`) and the guides. These matter because
they are where an overstatement would live:

- "Every open violation on a NYC property, in one report"
- "Judgments surfaced first — Docketed OATH judgments accrue interest and can
  become liens."
- "Every report states which public records it drew on and the date the city
  published them."

The first is the one to look at hardest. See question **Q1**.

### 2.4 Terms of Service and Privacy Policy

**Drafted but not yet reviewed.** They live on a separate branch (PR #9) and
render behind a visible *"Draft — not valid for public launch"* banner until
the entity placeholders in `src/lib/legal.ts` are filled in. They describe the
actual data handling rather than boilerplate:

- Email address, for magic-link sign-in
- Lookup history, for the free-tier limit and the subscriber dashboard
- Stripe customer ID and subscription state (never card details — those never
  touch our servers)
- Report snapshots, retained to back share links

Send these for review in the same engagement.

---

## 3. Questions for counsel

Ordered by how much they could change the product.

**Q1 — Completeness claims.** The report aggregates four datasets. It does not
include FDNY inspection records outside OATH, DEP water arrears, property tax
arrears, lien-sale status, Certificates of Occupancy, or open complaints not yet
adjudicated. Marketing says "every open violation." Is the disclaimer's
"informational only… not a title search" sufficient to qualify that, or does the
headline claim itself need to change? *(We can change the copy cheaply; we would
rather know now than after a complaint.)*

**Q2 — Reliance by third parties on share links.** A purchaser forwards a link
to a counterparty who never visited the site, never accepted terms, and paid us
nothing. They see the full report and the disclaimer. What is our exposure to
that person if a number is wrong, and does the share page need its own
click-through acceptance rather than a rendered disclaimer?

**Q3 — Known and disclosed inaccuracy.** Two specific, measurable cases:
 - Address resolution can return the wrong tax lot. The UI labels uncertain
   matches "nearby", but a confident match can still be wrong. `npm run
   accuracy:search` measures the rate; the number will be in
   `docs/LAUNCH-CHECKLIST.md` before launch.
 - Reports are generated from live City APIs. When one is unreachable, the
   report names the agency it could not reach rather than rendering an empty
   section — so "we couldn't check" is never displayed as "nothing on file."

Does disclosing a known error rate help or hurt? Should the measured figure be
published?

**Q4 — "Not a title search."** Is that phrase sufficient to stay clear of any
licensing regime around title abstraction or property reports in New York? Title
companies are a target customer, which cuts both ways.

**Q5 — Data licensing.** NYC Open Data is public under the City's terms of use.
We ingest it, transform it (normalization, cross-source deduplication), and
resell the result. Any attribution or use restriction we are getting wrong?

**Q6 — Consumer-protection posture on the $49 tier.** One-time purchases require
no account and are delivered by email. Refund policy, cancellation rights, and
the required disclosures at checkout — what needs to be on the page before
payment rather than after?

**Q7 — Personal data in the underlying records.** HPD violation text can name
occupants and describe conditions inside specific apartments. We surface the
City's description verbatim. Should any of it be redacted, and does republishing
it carry obligations the City's own publication does not?

---

## 4. What we need back

1. Marked-up disclaimer language, or confirmation the current wording stands.
2. Reviewed ToS and Privacy Policy, with the entity details filled in.
3. A written answer to Q1 and Q2 specifically — those two can change what ships.
4. Any required checkout-flow disclosure for Q6.

---

## 5. Before sending

- [ ] Fill in the entity name, jurisdiction of formation, and contact addresses
      in `src/lib/legal.ts` (PR #9) — reviewers will ask immediately
- [ ] Stand up real, monitored mailboxes for the privacy and support contacts.
      A published privacy contact nobody reads is a commitment we are not meeting
- [ ] Attach a generated sample report (`npm run report -- 3000017501`) and a
      PDF export, so the reviewer sees the actual artifact
- [ ] Decide who owns this thread and put their name at the top of this file
