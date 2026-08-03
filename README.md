# nycradar

**ViolationRadar** (working name) — unified NYC property violation reports across DOB, HPD, and ECB/OATH.

> **Status: pre-build.** The technical spike is complete; no product code has been written. The PRD's Phase 0 validation gate has not yet been passed.

## Where to start

| Document | What it is |
|---|---|
| [`spike/FINDINGS.md`](spike/FINDINGS.md) | Technical spike results — **read this first** |
| [`docs/PLAN.md`](docs/PLAN.md) | Build plan, data model, ETL rules, setup steps |
| [`spike/nyc_violation_join_spike.py`](spike/nyc_violation_join_spike.py) | The disposable spike script (not for production reuse) |

## Spike verdict

**Proceed with all three sources.** DOB, HPD, and ECB/OATH violations join reliably by BBL with a BIN-based recovery pass — no paid address-normalization service required.

Against a 27-lot test set across all five boroughs:

- **100%** of properties returned every source that holds data for them
- **92.6%** joined across all four datasets (the remainder are true negatives, not match failures)
- Address-string matching, by contrast: 70–78% correct with 22% ambiguous — **do not build on it**
- Median **3.8s** per property against live APIs, well inside the 60s requirement

Three findings that change the build:

1. **Condo billing lots (7501+) silently return zero DOB violations** — DOB cites the underlying physical lot while HPD and ECB cite the billing lot. Renders as a clean building rather than an error. Fixed by BIN recovery.
2. **ECB and OATH double-count 82.6% of DOB summonses** — OATH's ticket number is the ECB number with a leading zero, so exact matching finds no overlap at all. Without dedup, violation counts and dollars owed roughly double.
3. **FDNY data is already available** — 916k tickets in the OATH dataset at 96.8% key coverage, joinable on the same key. The PRD defers this to Phase 3 on an assumption the spike disproves.

The core technical risk is no longer the join — it is **address→BBL geocoding**, which could not be validated from the spike environment. See [`docs/PLAN.md`](docs/PLAN.md) §6.

## Data sources

| Source | Dataset ID | Rows |
|---|---|---|
| DOB Violations | `3h2n-5cm9` | 2.5M |
| HPD Housing Maintenance Code Violations | `wvxf-dwi5` | 11.1M |
| DOB ECB Violations | `6bgk-3dad` | 1.8M |
| OATH Hearings Division Case Status | `jz4z-kudi` | 21.9M |
| PLUTO (tax-lot reference) | `64uk-42ks` | — |

All via the Socrata SODA API on `data.cityofnewyork.us`. Observed refresh cadence: daily.

## Running the spike

```bash
cd spike
python3 nyc_violation_join_spike.py --rebuild-testset   # full run (~3 min)
python3 nyc_violation_join_spike.py --dedup-check       # ECB/OATH overlap
```

Python 3.11+, stdlib only, no dependencies.
