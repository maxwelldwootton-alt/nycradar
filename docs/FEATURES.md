# Pre-launch feature candidates

**Status:** Proposed, none started · **Last updated:** 2026-08-05

What we have *not* built and are considering building before launch. The
launch blockers are done and merged (#12); this is the layer above them —
things that change what the product is worth rather than whether it works.

> **Before any of this: the revenue model has to actually work.** A review on
> 2026-08-05 found the free-tier limit had never enforced in production —
> `claim_free_lookup` was merged but never applied, so every claim errored,
> `recordLookup` failed open, and every email got unlimited free reports. Fixed
> the same day (migration applied, fail-closed on a missing RPC,
> `npm run check:db` added to catch the class).
>
> It is worth stating the lesson plainly, because it reorders this list: **every
> item below assumes people convert from free to paid, and none of them matter
> if they don't.** Ship a working paywall before shipping anything that depends
> on one. The same instinct applies to §1 — verify the subscription tier is
> priced right *before* building the feature meant to justify it.

Companion docs: [`LAUNCH-CHECKLIST.md`](LAUNCH-CHECKLIST.md) is the gate
(configuration, accuracy, walkthroughs). [`PLAN.md`](PLAN.md) is the original
build plan. [`../spike/FINDINGS.md`](../spike/FINDINGS.md) is why the data
layer is shaped the way it is.

**Every dataset ID below was verified against the live NYC Open Data portal**
— name, key columns, row count and last-updated date. §1–§9 on 2026-08-04;
§10, §11 and the dead-ends table on 2026-08-05. Sizing estimates are not
verified; they are judgement calls and should be treated as such.

---

## 0. The decision that shapes this list

The product today is a one-shot lookup. At **$199/mo against $49 one-off, a
subscriber needs four reports a month to break even**, and a broker or closing
attorney does one to three deals a month. They will rationally buy the $49
report every time and never subscribe.

The only persona for whom $199 pencils is an owner or manager with a
portfolio — and for them the value is not *lookup* (they know their addresses),
it is *being told when something changes*.

That is why **§1 is monitoring and everything else is second**. If only one
thing on this list gets built, build that one. If the answer is instead "the
subscription tier is wrong," that is a pricing decision and it should be made
deliberately before launch rather than discovered at the first renewal cycle.

### What already exists to build on

| Piece | State | Why it matters here |
|---|---|---|
| `src/lib/nyc/persistence.ts` | Writes `violations` rows, nothing reads them | Alerts are a diff against history, and history has to start accumulating before it can be diffed |
| `src/lib/email/` | Sending works, used for purchase delivery | Alerts need a channel; it exists |
| `property_seo_summaries` + `npm run seo:refresh` | Nightly, populated | A nightly job pattern is already established and scheduled |
| `src/lib/rate-limit.ts` | Live | Any new fan-out to city APIs has a budget to draw on |
| Rules 1–5 in `src/lib/nyc/` | Live, tested | New sources reuse BBL normalization, BIN recovery and dedup rather than re-deriving them |

Monitoring is closer than it looks because of the first two rows.

---

## 1. Watchlist + change alerts

**The one that makes the subscription defensible.**

Let a user watch a property (or all properties they've looked up). A nightly
job re-runs the report for each watched BBL, diffs it against the last
persisted snapshot, and emails on:

- a new violation issued
- a **new judgment docketed** — the highest-value event in the product
- a status change (open → closed), which is what a seller wants evidence of
- a material change in balance owed

**Why it matters.** It is the only thing here a 24-hour manual expediter report
structurally cannot do. It converts a transaction into a subscription, and it
converts the product from something you buy once per closing into something
you keep.

**Depends on.** `persistence.ts` (exists), `src/lib/email/` (exists), a nightly
job (pattern exists in `seo:refresh`). New: a `watchlists` table, a diff
function, an alert-email template, an unsubscribe path.

**Size.** Medium — roughly a week. Most of the cost is in the diff's edge
cases, not the plumbing.

**Risks worth naming up front.**
- **A diff against an incomplete report is a false alarm generator.**
  `persistence.ts` already refuses to write reports that are missing a source,
  and the alert diff has to honour the same rule — otherwise a DOB outage one
  night reads as "all your violations were cleared" and its recovery the next
  night reads as a burst of new ones. This is the single biggest correctness
  risk in the feature.
- **Alert fatigue.** A large portfolio generates constant noise. Alerts should
  default to the deal-blocking subset (§2), not to everything.
- **Cost.** Nightly re-generation for every watched property is a real Socrata
  fan-out. Budget it, and consider that this is the point where the nightly
  ETL from PLAN.md §2 stops being optional.

---

## 2. Deal-blocker panel

Promote the handful of findings that actually block or complicate a
transaction above the fold: docketed judgments, open HPD Class C and ECB
Class 1 (both "immediately hazardous"), large accruing balances. Everything
else collapses beneath.

**Why it matters.** A heavily-cited building currently renders as four tables
of hundreds of rows, and the reader does the triage. The sorting logic exists
(`buildSection` orders open → severity → date) but the report makes no
*judgment*. This is what makes it read as professional work product rather
than a data dump, and it is the cheapest perceived-value increase available.

**Depends on.** Nothing new. It is a presentation change over data already
fetched and already classified by `src/lib/nyc/classify.ts`.

**Size.** Small — a couple of days.

**Watch the advice boundary.** `classify.ts` deliberately describes what the
city recorded and never recommends action. A panel headed "what will block
your closing" edges toward advice in a way the current wording does not.
Ranking by the city's own severity classes stays on the right side of it;
"you should do X about this" does not. Worth including in the legal review
([`LEGAL-REVIEW.md`](LEGAL-REVIEW.md) Q1) rather than deciding alone.

---

## 3. Source deep links

Link every violation row to the city's own record — BISWEB, HPD Online, the
OATH portal — built from identifiers already carried on each row.

**Why it matters.** For a document sold to attorneys and title companies,
every line should be independently verifiable in one click. It is the
strongest credibility signal available for the effort, and it reinforces
exactly the legal posture the disclaimer takes: *here is what the city
published, verify it at source*.

**Depends on.** Nothing. URL construction from `sourceId` / `dedupKey`.

**Size.** Small — a day, plus link-rot verification per agency.

**Risk.** City URL formats change without notice and a dead link is worse
than no link. Verify each pattern against live records before shipping, and
prefer a search URL over a deep record URL where the deep form looks fragile.

---

## 4. Vacate orders + AEP

Two small datasets, disproportionate signal.

| Dataset | ID | Rows | Keys | Updated |
|---|---|---|---|---|
| Order to Repair / Vacate Orders | `tb8q-a3ar` | 8,811 | `bbl`, `bin` | 2026-08-02 |
| Buildings in the Alternative Enforcement Program | `hcir-3275` | 4,387 | `bbl`, `bin`, `boro` | 2026-08-01 |
| NYC Fire Department Building Vacate List | `n5xc-7jfa` | 357 | `bbl`, `bin` | **2026-01-05** |

**Why it matters.** An active vacate order is categorically different from
forty stale violations — it is a yes/no answer that changes the transaction.
AEP is HPD's distressed-building list and is a similarly blunt signal. Both are
tiny, both are BBL-keyed, and both join with the machinery already built.

**This is the best effort-to-value ratio on the list after §1–§3.** Under ten
thousand rows apiece against a report engine that already handles 37M.

**Size.** Small — a day or two per source once the first one establishes the
pattern.

**Caveat, and take it seriously.** The FDNY vacate list was last updated
**2026-01-05, seven months stale**. Surfacing it as current would be
misleading. Either exclude it or label it with its own last-updated date
rather than the report's — the `perSourceUpdatedAt` machinery from rule 7
already supports exactly this, and this is what it is for.

---

## 5. FISP / facade compliance

`xubg-57si` — DOB NOW: Safety – Facades Compliance Filings · 86,807 rows ·
keyed `bin`, `block`, `lot`, `borough` · updated 2026-08-03.

**Why it matters.** An "Unsafe" facade filing under Local Law 11 is often a
mandatory six-figure repair — plausibly the largest single dollar liability in
NYC building compliance. And because it is **not a violation**, no
violation-aggregation competitor surfaces it. This is probably the sharpest
single differentiator on the list after alerts.

**Size.** Small-to-medium. No `bbl` column, but `block` + `lot` + `borough` is
exactly what rule 1 exists to normalize, so it is a known quantity.

**Open question.** The report is currently "violations". Adding compliance
filings broadens what it claims to be, which feeds directly into
[`LEGAL-REVIEW.md`](LEGAL-REVIEW.md) Q1 — the "every open violation" headline
gets *more* accurate as coverage grows, not less, but the framing needs to keep
up.

---

## 6. Open complaints

| Dataset | ID | Rows | Keys | Updated |
|---|---|---|---|---|
| DOB Complaints Received | `eabe-havv` | 3,116,979 | **`bin` only** | 2026-08-04 |
| Housing Maintenance Code Complaints and Problems | `ygpa-z7cr` | 16,222,481 | `bbl`, `bin`, `block`, `lot` | 2026-08-04 |

**Why it matters.** Complaints are a leading indicator — violations that have
not been issued yet. Nothing on the market answers "what is *coming* at this
building," and for a buyer mid-diligence that is a different and better
question than "what happened."

**Size.** Medium. `ygpa-z7cr` is 16.2M rows, larger than the HPD violations
feed already in use, so the existing pagination and truncation handling gets
exercised harder than anywhere else in the product.

**The engineering catch, and it is not cosmetic.** `eabe-havv` carries **only
`bin`** — no BBL at all. Every lookup must go through BIN, which means the
condo billing-lot problem from rule 3 applies with full force and there is no
BBL fallback when BIN recovery fails. Do not add this source without
confirming the BIN path holds on condos specifically.

**Product risk.** A complaint is an allegation, not a finding. Presenting
unsubstantiated complaints beside adjudicated violations without a clear visual
distinction would be the most misleading thing in the report. If this ships, it
ships in its own clearly-labelled section.

---

## 7. Benchmarking

PLUTO already gives `units_res`, `bldg_class` and `year_built`. Violations per
unit, against comparable buildings, turns a raw count into meaning: *"3× the
typical rate for a 40-unit prewar in Brooklyn."*

**Why it matters.** It answers the question the numbers imply but never state —
*is this bad?* One query, large perceived value, no new data source.

**Size.** Small. It becomes cheap once §1's history is accumulating, and can be
computed from the existing nightly summary job before then.

**Risk.** A percentile is a claim. It needs a stated denominator ("compared to
1,240 Brooklyn buildings of 20–60 units built before 1940") or it is just a
number with an implication attached.

---

## 8. Portfolio / bulk upload

Upload a CSV of addresses, get a portfolio table plus one-click watchlist
enrollment.

**Why it matters.** This is the $199 tier's actual product surface for the one
persona the pricing fits. It is also the natural upsell path from a single
report and the obvious companion to §1.

**Size.** Medium. Address resolution at bulk makes §7 of the launch checklist
load-bearing — a 5% resolver error rate is invisible on one lookup and glaring
across 200 rows, which is another reason to run `npm run accuracy:search`
before committing to this.

---

## 9. Cyclical compliance calendar

| Dataset | ID | Rows | Keys | Updated |
|---|---|---|---|---|
| DOB NOW Elevator Safety Compliance | `e5aq-a4j2` | 120,241 | `bbl`, `bin`, `block`, `lot` | 2026-08-03 |
| DOB NOW: Safety Boiler | `52dp-yji6` | 875,117 | **`bin_number` only** | 2026-08-01 |
| DOB Certificate of Occupancy | `bs8b-p36w` | 143,050 | `bbl`, `bin`, `block`, `lot` | 2026-08-01 |
| Housing Litigations | `59kj-x8nc` | 240,163 | `bbl`, `bin`, `block`, `lot` | 2026-08-01 |
| Multiple Dwelling Registrations | `tesw-yqqr` | 203,236 | `bin`, `block`, `lot`, `boro` | **2026-06-01** |

Recurring deadlines — elevator, boiler, LL152 gas, facade cycles — plus the
adjacent status checks (no valid C of O, expired HPD registration, active
housing-court litigation).

**Why it matters.** Deadlines are a *retention* feature rather than an
acquisition one: they give a subscriber a reason to still be paying in month
four. Pairs naturally with §1.

**Size.** Medium, and it is really five small integrations rather than one.

**Two caveats.** `52dp-yji6` is BIN-only, with the same condo exposure as §6.
`tesw-yqqr` was last updated **2026-06-01, two months stale** — usable for
"is this building registered" but not for anything time-sensitive, and it
needs its own freshness label.

---

## 10. Money the city has already assessed against the property

**Verified 2026-08-05.** Sources covering money the city has assessed against a
property, and liens arising from it. Read the correction box below before
scoping any of this — the first version of this section overclaimed what these
datasets contain.

| Dataset | ID | Rows | Keys | Updated |
|---|---|---|---|---|
| HPD Open Market Order (OMO) Charges | `mdbu-nrqn` | 510,765 | `bbl`, `bin`, `block`, `lot` | 2026-08-04 |
| HPD Handyman Work Order (HWO) Charges | `sbnd-xujn` | 99,197 | `bbl`, `bin`, `block`, `lot` | 2026-08-04 |
| Tax Lien Sale Lists | `9rz4-mjek` | 264,142 | `block`, `lot`, `borough` | **2025-12-01** |

In the portal's own words, OMO/HWO are *"fees assessed against properties by
HPD"* for emergency repair work done when an owner failed to fix a hazardous
condition themselves. HPD does the work and bills the property. Both are BBL
*and* BIN keyed and updated daily, so they join with the existing machinery and
need no new rules.

> ### ⚠️ Correction — do not add these to "Outstanding balance"
>
> An earlier version of this section claimed these charges should be summed
> into the report's existing **"Outstanding balance"** stat, and that the
> figure was therefore "silently understated." **That was wrong**, and it was
> asserted from the dataset descriptions without checking the columns. Checked
> properly on 2026-08-05:
>
> **Neither dataset has any payment, balance, or outstanding field.**
> `omoawardamount` and `chargeamount` are amounts *assessed*, with nothing
> recording what was subsequently paid. `lifecycle` describes the *building*
> (Standing / Demolished / Vacant Land), not the charge.
>
> Worse, the amounts are present on work orders that never produced a
> chargeable repair. Of 491,001 OMO rows carrying an amount above zero,
> **26,272 are `Landlord Complied`** — the owner fixed it themselves — and 945
> are `Duplicate OMO`. Summing the column naively would *overstate* what a
> property owes, on a figure a buyer may act on. That is a worse failure than
> the understatement it was meant to fix.
>
> So: **these are an intervention signal, not a balance.** HPD having to do
> emergency work at a building, repeatedly, is genuinely transaction-relevant —
> as a count and a history. If any dollar figure is shown it must be labelled
> *charges assessed* rather than *outstanding*, and it must exclude the
> statuses above. It does not belong in the existing balance card.
>
> The question that card actually implies — *is there unpaid money attached to
> this property?* — is answered by the Tax Lien Sale List below, not by these.
> `datetransferdof` is the closest thing here: 78,983 of 99,197 HWO charges
> (79.6%) have been transferred to the Department of Finance for collection,
> which is a step toward collection but still not a balance.

**Tax Lien Sale Lists** is the most direct answer to the question the product
is built around: *"Properties with tax, water liens and other charges that are
potentially eligible to be included in the next lien sale."* It also quietly
closes a gap — **water arrears are not published as a standalone dataset**, but
surface here as water liens.

Two caveats on it. It has no `bbl` column (`block`/`lot`/`borough` — rule 1
handles that). And it was last updated **2025-12-01**. The lien sale is a
periodic event, so that may be normal cadence rather than abandonment —
**confirm the publication schedule before relying on it**, because from the
outside "annual list" and "abandoned dataset" look identical.

**Size.** Small for OMO/HWO — same shape as any existing source module — but
note it needs a status filter and its own presentation, *not* a line into the
existing balance card. Medium for the lien list, mostly in deciding how to
present a periodic snapshot next to daily-refreshed data without implying they
are equally current.

**Of the two, the lien list is the more interesting** for the question the
product is built around, because it is the one that actually describes money
still owed. It is also the one with the freshness caveat, which is an awkward
combination and worth resolving before either is scoped.

---

## 11. Smaller verified additions

| Dataset | ID | Rows | Keys | Updated |
|---|---|---|---|---|
| Asbestos Control Program (ACP7) | `vq35-j9qm` | 395,278 | `bbl`, `bin`, `block`, `lot` | 2026-08-01 |
| Landmarks Violations | `wycc-5aqt` | 5,772 | `bin`, `block`, `lot` | 2026-06-22 |
| CONH Pilot Building List | `bzxi-2tsw` | 1,580 | `bbl`, `bin`, `block`, `lot` | 2026-07-13 |

Landmarks is tiny but high-signal: a landmarked building carries real
restrictions on what a buyer can subsequently do, which is transaction-relevant
in a way a violation count is not.

---

## Dead ends — checked, and not available

Recorded so nobody spends an afternoon re-hunting them. All checked against the
live portal on 2026-08-05.

| Looked for | Finding |
|---|---|
| **DOB stop-work orders** | **No dataset exists.** Searched several ways; nothing property-keyed. SWOs would have to be inferred from ECB violation types or DOB complaint dispositions — a different and far less reliable job than a join. Any doc implying SWO data is straightforwardly available is wrong. |
| **Local Law 97 building emissions** | Not published. Only *municipal* building benchmarking (`vvj6-d5qx`). Given LL97 penalties are a major forward liability on large buildings, this is a gap in the city's publishing, not in ours. |
| **LL33 energy grades** | `355w-xvp2` exists but was last updated **2022-03-07** — four years stale. Not usable. |
| **Sidewalk violations** | `6kbp-uz6m` — 313k rows, updated daily, and **no property key at all**. Unjoinable by BBL or BIN. |
| **DEP water arrears** | No standalone dataset. Partially covered via water liens in `9rz4-mjek` above. |
| **HPD 7A administrator** | No dataset. |

---

## Not now, and why

| Candidate | Why not yet |
|---|---|
| Title-company API | No demand signal, and the report format is not stable enough to version publicly |
| White-label reports | Enterprise-shaped work before there is an enterprise customer |
| Team seats | Solve after there is a team-sized account to solve it for |
| $49 → $199 upgrade credit | PLAN.md §5 already flags this as optional branching; add it when a user asks |
| Nightly ETL (PLAN.md §2) | Genuinely the right architecture, and genuinely not launch-blocking. §1 is what forces the decision — revisit it there rather than as a standalone project |

---

## Suggested sequencing

**Before launch, if anything:** §2 and §3. Both are small, neither needs a new
data source, and together they make the existing report feel worth $49.

**Immediately after, and the real priority:** §1. It is what makes $199
defensible, and it should not slip behind a queue of data-source additions that
are individually cheaper.

**Then, in order of signal per unit of work:** §4 → §5 → §10 → §7 → §6 → §8 →
§11 → §9.

§10 briefly led this list on the claim that it fixed a wrong number already on
screen. That claim did not survive checking the columns — see the correction
box in §10 — so it sits back among the other data-source additions, ahead of
§7 on the strength of the lien list rather than the HPD charges.

(Section numbers are identity, not rank — this line is the rank. §10 and §11
were appended after the original nine rather than renumbered, so that
references elsewhere in this doc stay valid.)

**Two things that are not features and gate several of these:** run
`npm run accuracy:search` (§8 is unwise without it) and get an answer to
[`LEGAL-REVIEW.md`](LEGAL-REVIEW.md) Q1 (§5, §6 and §10 all broaden what the
report claims to cover — §10 especially, since presenting assessed charges as
though they were amounts owed is precisely the kind of overstatement Q1 asks
about).

---

## Reproducing the dataset verification

The table data above came from the live portal, not from memory. The
domain-local catalog endpoint is reachable and searchable:

```bash
curl -s "https://data.cityofnewyork.us/api/catalog/v1?q=vacate+order&limit=5"
curl -s "https://data.cityofnewyork.us/api/views/tb8q-a3ar.json"    # name, columns, rowsUpdatedAt
curl -s "https://data.cityofnewyork.us/resource/tb8q-a3ar.json?\$select=count(*)"
```

Note that `api.us.socrata.com` (the cross-domain catalog) is **not** reachable
from the build environment — use the `data.cityofnewyork.us` endpoints above.
Re-verify row counts and update dates before committing to any of these;
several datasets here are already months or years stale and that is exactly the
kind of thing that changes quietly.

**The catalog endpoint federates.** Searching it returns hits from other
Socrata domains — a search for "lien sale" comes back with an Illinois county
treasurer's tax sale, and "local law 97" with New York *State* school aid.
Filter on `metadata.domain` containing `cityofnewyork`, or you will end up
profiling a dataset that has nothing to do with NYC:

```bash
curl -s "https://data.cityofnewyork.us/api/catalog/v1?q=lien+sale&limit=6" \
  | python3 -c "import json,sys; [print(r['resource']['id'], r['resource']['name']) \
      for r in json.load(sys.stdin)['results'] \
      if 'cityofnewyork' in r.get('metadata',{}).get('domain','')]"
```

**Check `rowsUpdatedAt` before anything else.** Of the datasets profiled on
2026-08-05, one was four years stale (`355w-xvp2`) and one had no property key
at all despite daily updates (`6kbp-uz6m`). Both look perfectly healthy from a
search-results list.
