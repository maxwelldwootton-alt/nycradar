# Pre-launch feature candidates

**Status:** Proposed, none started · **Last updated:** 2026-08-04

What we have *not* built and are considering building before launch. The
launch blockers are done and merged (#12); this is the layer above them —
things that change what the product is worth rather than whether it works.

Companion docs: [`LAUNCH-CHECKLIST.md`](LAUNCH-CHECKLIST.md) is the gate
(configuration, accuracy, walkthroughs). [`PLAN.md`](PLAN.md) is the original
build plan. [`../spike/FINDINGS.md`](../spike/FINDINGS.md) is why the data
layer is shaped the way it is.

**Every dataset ID below was verified against the live NYC Open Data portal on
2026-08-04** — name, key columns, row count and last-updated date. Sizing
estimates are not verified; they are judgement calls and should be treated as
such.

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

**Then, in order of signal per unit of work:** §4 → §5 → §7 → §6 → §8 → §9.

**Two things that are not features and gate several of these:** run
`npm run accuracy:search` (§8 is unwise without it) and get an answer to
[`LEGAL-REVIEW.md`](LEGAL-REVIEW.md) Q1 (§5 and §6 both broaden what the report
claims to cover).

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
Re-verify row counts and update dates before committing to any of these; two
of the datasets here are already months stale and that is exactly the kind of
thing that changes quietly.
