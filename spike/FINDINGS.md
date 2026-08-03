# Technical Spike Findings: NYC Violation Data Cross-Reference Feasibility

**Run date:** 2026-08-03 · **Status:** Complete · **Verdict:** **Proceed with all three sources — plus a fourth.**

---

## 1. Headline answer

> *Can DOB, HPD, and ECB/OATH violation records for the same NYC property be reliably joined into one unified report?*

**Yes — by BBL, with a BIN-based recovery pass, with no paid or third-party address-normalization service.**

Against a 27-lot test set spanning all five boroughs and four building types:

| Join strategy | DOB | HPD | ECB | OATH | All four |
|---|---|---|---|---|---|
| BBL only | 92.6% | 100% | 92.6% | 100% | 85.2% |
| **BBL + BIN recovery** | **100%** | **100%** | **92.6%** | **100%** | **92.6%** |
| Address string (control) | 70.4% | 77.8% | — | — | — |

The residual 7.4% is **not a join failure**. The two lots that returned no ECB rows are small walk-ups (312 Water St, Brooklyn; 17 Central Ave, Staten Island) that have DOB BIS violations but have genuinely never been issued an OATH-adjudicated DOB summons. A BIN-keyed re-query on those lots also returns zero, confirming a true negative rather than a missed match.

**Effective join success on the test set is 27/27 (100%):** every source that holds data for a property returned it.

Address-string matching was measured only as a control and is clearly inferior — 22.2% of address queries returned more than one candidate BBL. **Do not build the product on address matching.**

---

## 2. Datasets confirmed

All four are live Socrata (SODA) endpoints on `data.cityofnewyork.us`, verified directly rather than assumed. Row counts and update timestamps read from the portal on the run date.

| Source | Dataset | ID | Rows | Portal `rowsUpdatedAt` |
|---|---|---|---|---|
| DOB | DOB Violations (BIS civil penalties) | `3h2n-5cm9` | 2,475,948 | 2026-08-02 17:39 UTC |
| HPD | Housing Maintenance Code Violations | `wvxf-dwi5` | 11,144,467 | 2026-08-03 15:00 UTC |
| ECB | DOB ECB Violations | `6bgk-3dad` | 1,827,603 | 2026-08-02 17:00 UTC |
| OATH | OATH Hearings Division Case Status | `jz4z-kudi` | 21,902,713 | 2026-08-03 04:13 UTC |
| *(ref)* | PLUTO tax-lot reference | `64uk-42ks` | — | used to build the test set |

Endpoint pattern: `https://data.cityofnewyork.us/resource/{id}.json?$where=...&$limit=...`

**Observed refresh cadence is daily** across all four (every dataset had updated within ~36h of the run). This is an observation from a single run, not a published SLA — the ETL should record `rowsUpdatedAt` per source per run and surface the oldest of the four as the report's "data as of" timestamp (PRD §7, FR7).

### A correction to an assumption in the PRD

The PRD scopes ECB/OATH as one source. It is **two datasets, and the more useful one is not the one named.**

- **`6bgk-3dad` (DOB ECB Violations)** carries native `bin`, `boro`, `block`, `lot`, plus `balance_due`, `penality_imposed` *(sic — the field is misspelled in the source)*, `hearing_status` and `certification_status`. This is the clean, property-keyed source for DOB summonses and should be the primary ECB feed.
- **`jz4z-kudi` (OATH Hearings)** is the citywide adjudication docket for *all* agencies. It is far messier, but it is the only source for non-DOB property violations.

Use both. See §5 for the mandatory dedup rule.

---

## 3. The core normalization finding: block/lot padding is inconsistent

This is the single most important implementation detail, and the trap most likely to produce silent wrong answers.

| Source | Borough form | Block | Lot | Native BBL? |
|---|---|---|---|---|
| DOB `3h2n-5cm9` | code `'1'`–`'5'` | text, **5-pad** `'00847'` | text, **5-pad** `'00038'` | no |
| ECB `6bgk-3dad` | code `'1'`–`'5'` | text, **5-pad** `'01588'` | text, **4-pad** `'0001'` | no |
| HPD `wvxf-dwi5` | `boroid` numeric | numeric, **unpadded** `3031` | numeric, **unpadded** `15` | **yes** — `bbl`, canonical 10-digit |
| OATH `jz4z-kudi` | **borough NAME** `'BROOKLYN'`, `'STATEN IS'` | text, **5-pad** `'04317'` | text, **4-pad** `'0043'` | no |
| PLUTO `64uk-42ks` | 2-letter `'BK'` | text | text | float-string `'2054800111.00000000'` |

DOB pads lot to **five** characters; ECB and OATH pad it to **four**. Concatenating source fields to build a BBL yields an 11-character key for DOB and a 10-character key for everything else — a join that returns zero rows with no error.

**Rule: never string-concatenate. Always cast block and lot to integers, then re-pad to the canonical form** — `boro(1) + block(5, zero-padded) + lot(4, zero-padded)`. OATH additionally needs a borough code→name map, and note the non-obvious `'STATEN IS'` (not `'STATEN ISLAND'`).

### Identifier quality

- **HPD `bbl` is populated on 99.9% of rows** (2,367,034 / 2,369,022 on 2024+ issuances; the same rate on a 2010–2015 window). HPD is the easiest source to join and a reliable BIN source for the other three.
- **DOB `bin` sentinel rate is 0.15%** (3,595 / 2,475,948). Treat `'0000000'` and any `X000000` borough-placeholder value as null — they are "unknown building in borough X", not a real BIN.
- OATH `violation_location_*` fields are sparse citywide but dense where it matters (§5).

---

## 4. Critical edge case: condominium billing lots break the DOB join

**This is the finding that most affects product correctness.**

Condos are assigned a *billing lot* numbered 7501+. HPD and ECB cite violations against the billing lot. **DOB cites them against the underlying physical tax lot.** A pure BBL join therefore returns **zero DOB violations for a condo** — which renders as a clean building rather than an error. For a product sold on pre-closing due diligence, silently reporting "no DOB violations" on a condo is the worst failure mode available.

Two of the seven condo billing lots in the test set hit this:

| Property | Queried BBL | DOB via BBL | DOB via BIN | Actually recorded under |
|---|---|---|---|---|
| 1 John Street, Brooklyn | `3000017501` | 0 | **14** | `3000010002` |
| 345 St Ann's Ave, Bronx | `2022687501` | 0 | **8** | `2022680027` |

**Mitigation (implemented in the spike, and it works):** collect every non-sentinel BIN returned by *any* source, then re-query DOB and ECB by BIN. This recovered both lots and took DOB coverage from 92.6% → 100%.

The production ETL should not do this at query time — it should resolve and store the BBL↔BIN↔underlying-lot relationship once, at ingest, so lookups stay a single indexed read.

### Multi-building lots

**51.9% of the test lots span more than one BIN**, and the tail is long: 2049 Bartow Ave (Co-op City) spans **249 BINs**; two Metropolitan Oval lots span 46 and 54. A BBL-keyed report on a campus-style property aggregates every building on the lot.

This is a *report design* decision, not a bug — but it must be deliberate. Recommendation: aggregate by BBL (that is the unit that transfers with the deed, which is what the buyer is exposed to) and offer a per-building breakdown when `distinct_bins > 1`.

---

## 5. OATH is usable — but only for the right slice, and it double-counts

The PRD predicted OATH would be the messiest source. **Confirmed, but the difficulty is not where expected.**

The problem is not formatting — the `violation_location_*` fields are cleanly padded. The problem is **composition**. `jz4z-kudi` is the citywide docket for every OATH-adjudicated summons, and the overwhelming majority are street- and vehicle-attached, not property-attached: sanitation (3.6M), DSNY enforcement agents (3.4M), TLC (2.9M). Those rows have no block/lot because there is no property to attach them to. Across a raw sample, only ~4% of OATH rows carry block+lot — which looks disqualifying until it is broken down by agency:

| Issuing agency | Tickets | With block+lot | Coverage |
|---|---|---|---|
| DEPT. OF BUILDINGS | 1,398,893 | 1,375,493 | **98.3%** |
| FIRE DEPARTMENT OF NYC | 945,989 | 915,783 | **96.8%** |

**Filter by issuing agency and OATH is a high-quality property-keyed source.** Do not filter, and it is noise.

### Mandatory deduplication rule

DOB summonses are adjudicated at OATH, so **the same summons appears in both `6bgk-3dad` and `jz4z-kudi`**. Measured across six lots: **376 / 455 = 82.6% of ECB summonses also appear in OATH** (per-lot range 79.7%–100%).

The join key is not obvious: **OATH `ticket_number` is the ECB violation number with a leading zero.** ECB `39523868K` ↔ OATH `039523868K`. Exact string match finds **zero** overlap; matching on `lstrip('0')` finds all of it.

Without this dedup, the product would roughly double both the open-violation count and the dollars-owed figure on any property with DOB summonses. Given that money owed is the headline number for the title-company persona, this would be a credibility-ending bug.

**Rule: normalize both identifiers with `lstrip('0')` and deduplicate ECB against OATH before any count or sum.**

### Bonus finding: FDNY is available *now*

PRD §14 asks whether FDNY violation data is available in structured form, and §4 defers it to v2/Phase 3. **916k FDNY tickets are already in `jz4z-kudi` with block/lot at 96.8% coverage**, joinable by the same BBL key as everything else. FDNY is close to free once the OATH pipeline exists — this is a scope decision worth revisiting, not a Phase 3 item.

`jz4z-kudi` also carries DEP (environmental), DSNY, Asbestos Control and DOHMH tickets against the same properties, all on the same key.

### What OATH gives you that nothing else does

`jz4z-kudi` carries `balance_due`, `penalty_imposed`, `paid_amount`, `additional_penalties_or_late_fees`, `date_judgment_docketed`, and `hearing_result` (including `Default/ No Appearance`). **`date_judgment_docketed` is the field that signals a docketed judgment — the lien risk the PRD's problem statement is built on.** This is the highest-value data in the entire product and it exists in structured form.

---

## 6. Address → BBL resolution (the remaining open dependency)

The join works on BBL. Users type addresses. Something must bridge them, and **that resolver is now the product's main external dependency.**

Address-string matching directly against the violation datasets was measured as a control and is not good enough: 77.8% (HPD) and 70.4% (DOB) correct, with 22.2% ambiguous. Street-type conventions also differ across sources — HPD spells types out (`ROCKAWAY BEACH BOULEVARD`), DOB and ECB abbreviate (`ROCKAWAY AVE`) — so any address path needs bidirectional canonicalization before comparison.

The right tool is NYC's own geocoder, and both options are free:

1. **NYC Planning Labs GeoSearch** (`geosearch.planninglabs.nyc`) — keyless, returns BBL + BIN, and gives autocomplete for FR1 for free.
2. **NYC GeoClient API** — requires a free API key, official DCP/DoITT geocoder.

⚠️ **GeoSearch could not be tested from this environment** — outbound requests to `geosearch.planninglabs.nyc` are refused with a 403 by this session's network policy (confirmed via the agent proxy status endpoint; `data.cityofnewyork.us` is permitted). This is an environment restriction, not evidence about the service. **Validating GeoSearch's coverage and rate limits is the one open item this spike could not close**, and it should be the first task of the build. Budget for GeoClient as the fallback.

For the test set, PLUTO (`64uk-42ks`) served as the address↔BBL reference and worked, but it needs exact-string address matching — usable as a ground-truth reference table, not as a user-facing search.

---

## 7. Performance

Comfortably inside the 60-second requirement (FR2/NFR), even querying live with no cache and no app token:

- **Per-property, all four sources: median 3.8s, max 6.1s** (~6 SODA calls each)
- Whole 27-lot run: 166 calls, no rate-limiting

Live pass-through would technically satisfy the SLA, but **it should still not be the architecture** — it makes report generation hostage to NYC Open Data's uptime, forfeits the "data as of" timestamp control FR7 requires, and cannot support Phase 3 monitoring/alerts. Nightly ETL into Postgres, indexed on BBL. Register a free Socrata app token for the ETL to raise anonymous throttling limits.

---

## 8. Recommendation

**Proceed with all three PRD sources, restructured as four datasets, with no change to the MVP scope and no paid dependency.**

Matching strategy for the build:

1. **Resolve the user's address to BBL + BIN via GeoSearch** (GeoClient as fallback). Validate this first — it is the only unclosed dependency.
2. **Join on canonical BBL** — `boro(1) + block(5) + lot(4)`, always integer-cast then re-padded, never string-concatenated.
3. **Resolve BIN and the underlying physical lot at ingest** so condo billing lots (7501+) do not silently drop DOB violations.
4. **Query OATH filtered by issuing agency**, not raw.
5. **Deduplicate ECB against OATH on `lstrip('0')` ticket numbers** before any count or dollar total.
6. **Aggregate by BBL**, with a per-building breakdown when a lot spans multiple BINs.

Two scope items worth revisiting on the strength of the evidence:

- **Pull FDNY into the MVP.** It is already in the OATH pipeline at 96.8% key coverage. The PRD defers it to Phase 3 on an assumption this spike disproves.
- **Lead the report with docketed OATH judgments and `balance_due`.** That is the deal-blocking number the problem statement describes, it is available in structured form, and no competitor's 24-hour manual report surfaces it instantly.

### Confidence and limits

- 27 lots is enough to establish that the join mechanism works and to surface systematic failure modes; it is **not** enough to put a confidence interval on citywide match rates. Re-run against a few thousand lots during the ETL build, when it is cheap.
- The test set skews toward heavily-cited properties by design (stratum A). This exercises the join harder than a random sample, but it means the observed volumes are not representative of typical housing stock.
- Every rate here is measured against BBLs *known to be correct*, because the test set was built from PLUTO. Real end-to-end accuracy will be **this join's accuracy × the geocoder's accuracy**, and the second term is still unmeasured.

---

## 9. Reproducing

```bash
cd spike
python3 nyc_violation_join_spike.py --rebuild-testset   # full run (~3 min)
python3 nyc_violation_join_spike.py --dedup-check       # ECB/OATH overlap
python3 nyc_violation_join_spike.py --limit 5           # quick smoke run
```

Stdlib only, no dependencies. Optionally set `SOCRATA_APP_TOKEN` to raise rate limits.

| File | Contents |
|---|---|
| `nyc_violation_join_spike.py` | The disposable script. **Not intended for reuse in the production build.** |
| `test_addresses.json` | The 27-lot test set, with stratum labels |
| `results.json` | Full per-property results, including match method and samples |
| `summary.txt` | Generated summary table |
| `dedup_check.json` | ECB/OATH overlap measurements |

Because the test set is rebuilt from live queries, `--rebuild-testset` may select slightly different lots as the underlying data changes. The committed `test_addresses.json` is the set these findings were measured against.
