#!/usr/bin/env python3
"""
ViolationRadar — Technical Spike: NYC violation data cross-reference feasibility.

DISPOSABLE. This script exists to answer one question:

    Can DOB, HPD, and ECB/OATH violation records for the same NYC property be
    reliably joined into a single unified per-property report?

It is deliberately dependency-free (stdlib only) and deliberately not
structured for reuse in the production build. Do not import from it.

Usage:
    python3 nyc_violation_join_spike.py                 # full run
    python3 nyc_violation_join_spike.py --rebuild-testset
    python3 nyc_violation_join_spike.py --limit 5       # quick smoke run

Set SOCRATA_APP_TOKEN to raise the anonymous rate limit (not required).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
DOMAIN = "https://data.cityofnewyork.us"
APP_TOKEN = os.environ.get("SOCRATA_APP_TOKEN", "")

# --- Dataset registry -------------------------------------------------------
# Confirmed live against the portal on the run date recorded in results.json.
DATASETS = {
    "dob": "3h2n-5cm9",   # DOB Violations (BIS civil penalties)
    "hpd": "wvxf-dwi5",   # HPD Housing Maintenance Code Violations
    "ecb": "6bgk-3dad",   # DOB ECB Violations (DOB summonses adjudicated at OATH)
    "oath": "jz4z-kudi",  # OATH Hearings Division Case Status (all agencies)
    "pluto": "64uk-42ks", # MapPLUTO / PLUTO tax-lot reference (test-set builder)
}

BORO_CODE_TO_NAME = {"1": "MANHATTAN", "2": "BRONX", "3": "BROOKLYN",
                     "4": "QUEENS", "5": "STATEN IS"}
BORO_CODE_TO_PLUTO = {"1": "MN", "2": "BX", "3": "BK", "4": "QN", "5": "SI"}

REQUEST_DELAY = 0.25
_call_count = 0


# --- SODA client ------------------------------------------------------------

def soda(dataset_key: str, params: dict, retries: int = 4) -> list:
    """GET rows from a Socrata dataset with backoff. Returns list of dicts."""
    global _call_count
    dsid = DATASETS[dataset_key]
    url = f"{DOMAIN}/resource/{dsid}.json?" + urllib.parse.urlencode(params)
    headers = {"Accept": "application/json", "User-Agent": "violationradar-spike/1.0"}
    if APP_TOKEN:
        headers["X-App-Token"] = APP_TOKEN

    delay = 2.0
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=90) as resp:
                _call_count += 1
                time.sleep(REQUEST_DELAY)
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            code = getattr(exc, "code", None)
            if code in (400, 404):  # malformed query — surface it, don't retry
                body = exc.read().decode("utf-8", "replace")[:400] if hasattr(exc, "read") else ""
                raise RuntimeError(f"SODA {code} on {dsid}: {body}\nURL: {url}") from exc
            if attempt == retries - 1:
                raise
            time.sleep(delay)
            delay *= 2
    return []


def soda_count(dataset_key: str, where: str) -> int:
    rows = soda(dataset_key, {"$select": "count(1) as n", "$where": where})
    return int(rows[0]["n"]) if rows and rows[0].get("n") is not None else 0


# --- Key normalization ------------------------------------------------------
# The core finding of this spike lives here. Every source pads block/lot
# differently, so string concatenation across sources silently produces
# mismatched keys. Always cast to int, then re-pad to the canonical widths.

def canonical_bbl(boro, block, lot) -> str | None:
    """Canonical 10-char BBL: boro(1) + block(5, zero-pad) + lot(4, zero-pad)."""
    try:
        b = str(int(str(boro).strip()))
        blk = int(str(block).strip())
        lt = int(str(lot).strip())
    except (ValueError, TypeError, AttributeError):
        return None
    if b not in BORO_CODE_TO_NAME or not (0 < blk <= 99999) or not (0 <= lt <= 9999):
        return None
    return f"{b}{blk:05d}{lt:04d}"


def split_bbl(bbl: str) -> tuple[str, int, int]:
    return bbl[0], int(bbl[1:6]), int(bbl[6:10])


def clean_bin(raw) -> str | None:
    """Drop sentinel BINs. `X000000` is a 'borough placeholder', not a building."""
    if not raw:
        return None
    b = str(raw).strip()
    if not b.isdigit() or len(b) != 7:
        return None
    if b == "0000000" or b.endswith("000000"):
        return None
    return b


# Street-type canonicalization. HPD spells types out ("BOULEVARD"), DOB and ECB
# abbreviate ("BLVD"). Any address-string join must collapse both to one form.
STREET_TYPES = {
    "STREET": "ST", "AVENUE": "AVE", "BOULEVARD": "BLVD", "PLACE": "PL",
    "ROAD": "RD", "DRIVE": "DR", "COURT": "CT", "LANE": "LN", "TERRACE": "TER",
    "PARKWAY": "PKWY", "PLAZA": "PLZ", "SQUARE": "SQ", "HIGHWAY": "HWY",
    "TURNPIKE": "TPKE", "EXPRESSWAY": "EXPY", "CIRCLE": "CIR", "WALK": "WALK",
    "NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W",
}
ORDINALS = re.compile(r"\b(\d+)(ST|ND|RD|TH)\b")


def normalize_street(name: str) -> str:
    """Aggressive canonical form for address-string matching."""
    if not name:
        return ""
    s = name.upper().strip()
    s = re.sub(r"[.,'#]", " ", s)
    s = ORDINALS.sub(r"\1", s)          # 5TH -> 5
    s = re.sub(r"\s+", " ", s).strip()
    parts = [STREET_TYPES.get(p, p) for p in s.split(" ")]
    return " ".join(parts).strip()


def normalize_house(num: str) -> str:
    """Normalize house numbers: strip REAR/FRONT suffixes, keep Queens hyphens."""
    if not num:
        return ""
    s = num.upper().strip()
    s = re.sub(r"\b(REAR|FRONT|GARAGE|STORE|BLDG|BUILDING)\b", "", s)
    s = re.sub(r"[.,']", "", s)
    return re.sub(r"\s+", " ", s).strip()


# --- Test-set construction --------------------------------------------------

TESTSET_PATH = HERE / "test_addresses.json"


def build_test_set() -> list[dict]:
    """
    Build a stratified test set of real NYC tax lots.

    Two strata, deliberately mixed so the test is not just clean records:
      A. 'High-violation' lots taken from the top of HPD's open-violation
         counts. Guarantees the join is exercised against messy, heavily
         cited properties (and pulls in condo/co-op billing lots).
      B. 'Ordinary' lots stratified by borough and PLUTO building class:
         small multifamily (C-class walkups), elevator rentals (D-class),
         condo (R-class) and co-op (C6/C8). Guarantees the test covers
         normal housing stock, not just distressed buildings.
    """
    print("Building test set from live data...", file=sys.stderr)
    lots: dict[str, dict] = {}

    # --- Stratum A: heavily-cited properties (HPD open violations)
    rows = soda("hpd", {
        "$select": "bbl, count(1) as n",
        "$where": "violationstatus='Open' AND bbl IS NOT NULL",
        "$group": "bbl", "$order": "n DESC", "$limit": "12",
    })
    for r in rows:
        bbl = str(r["bbl"]).strip()
        if len(bbl) == 10 and bbl.isdigit():
            lots[bbl] = {"bbl": bbl, "stratum": "high_violation",
                         "hpd_open_hint": int(r["n"])}

    # --- Stratum B: ordinary stock, stratified borough x building class
    class_specs = [
        ("C%", "small multifamily / walkup", "unitsres > 5 AND unitsres < 30"),
        ("D%", "elevator rental", "unitsres > 40"),
        ("R%", "condo", "unitsres > 10"),
    ]
    for boro_code in ("1", "2", "3", "4", "5"):
        for cls, label, unit_clause in class_specs:
            if len(lots) >= 30:
                break
            where = (f"borough='{BORO_CODE_TO_PLUTO[boro_code]}' "
                     f"AND bldgclass like '{cls}' AND {unit_clause} "
                     f"AND address IS NOT NULL")
            try:
                found = soda("pluto", {
                    "$select": "bbl, address, borough, block, lot, zipcode, "
                               "bldgclass, unitsres, yearbuilt, ownername",
                    "$where": where, "$order": "bbl", "$limit": "1",
                })
            except RuntimeError as exc:
                print(f"  PLUTO query failed ({label}, {boro_code}): {exc}", file=sys.stderr)
                continue
            for r in found:
                bbl = canonical_bbl(boro_code, r.get("block"), r.get("lot"))
                if bbl and bbl not in lots:
                    lots[bbl] = {"bbl": bbl, "stratum": f"ordinary/{label}",
                                 "bldgclass": r.get("bldgclass"),
                                 "unitsres": r.get("unitsres")}

    # --- Enrich every lot with its PLUTO address (the 'user-typed' address)
    out = []
    for bbl, meta in lots.items():
        boro, blk, lt = split_bbl(bbl)
        try:
            p = soda("pluto", {
                "$select": "address, zipcode, bldgclass, unitsres, ownername, borough",
                "$where": (f"borough='{BORO_CODE_TO_PLUTO[boro]}' "
                           f"AND block={blk} AND lot={lt}"),
                "$limit": "1",
            })
        except RuntimeError:
            p = []
        if p:
            meta.update({
                "address": p[0].get("address"),
                "zip": p[0].get("zipcode"),
                "bldgclass": meta.get("bldgclass") or p[0].get("bldgclass"),
                "unitsres": meta.get("unitsres") or p[0].get("unitsres"),
                "owner": p[0].get("ownername"),
            })
        else:
            meta["address"] = None
            meta["pluto_miss"] = True
        meta["borough"] = BORO_CODE_TO_NAME[bbl[0]]
        out.append(meta)

    out.sort(key=lambda x: x["bbl"])
    TESTSET_PATH.write_text(json.dumps(out, indent=2))
    print(f"  built {len(out)} test lots -> {TESTSET_PATH.name}", file=sys.stderr)
    return out


def load_test_set(rebuild: bool) -> list[dict]:
    if rebuild or not TESTSET_PATH.exists():
        return build_test_set()
    return json.loads(TESTSET_PATH.read_text())


# --- Per-source queries, keyed by BBL ---------------------------------------
# Each source needs its own padding convention. This is the whole ballgame.

MAX_ROWS = "5000"

DOB_SELECT = ("isn_dob_bis_viol, bin, boro, block, lot, issue_date, "
              "violation_type, violation_category, violation_number, "
              "ecb_number, description, disposition_date, house_number, street")
ECB_SELECT = ("ecb_violation_number, dob_violation_number, bin, boro, block, lot, "
              "ecb_violation_status, issue_date, severity, violation_type, "
              "violation_description, penality_imposed, amount_paid, balance_due, "
              "hearing_status, certification_status")


def _dob_pack(rows, where, key) -> dict:
    open_n = sum(1 for r in rows
                 if "ACTIVE" in (r.get("violation_category") or "").upper())
    return {"total": len(rows), "open": open_n, "rows": rows,
            "where": where, "matched_by": key}


def _ecb_pack(rows, where, key) -> dict:
    open_n = sum(1 for r in rows
                 if (r.get("ecb_violation_status") or "").upper() == "ACTIVE")
    owed = sum(float(r.get("balance_due") or 0) for r in rows)
    return {"total": len(rows), "open": open_n, "balance_due": round(owed, 2),
            "rows": rows, "where": where, "matched_by": key}


def q_dob(bbl: str) -> dict:
    """DOB Violations: boro code, block zero-padded to 5, lot zero-padded to 5."""
    boro, blk, lt = split_bbl(bbl)
    where = f"boro='{boro}' AND block='{blk:05d}' AND lot='{lt:05d}'"
    return _dob_pack(soda("dob", {"$where": where, "$limit": MAX_ROWS,
                                  "$select": DOB_SELECT}), where, "bbl")


def q_dob_by_bin(bin_: str) -> dict:
    where = f"bin='{bin_}'"
    return _dob_pack(soda("dob", {"$where": where, "$limit": MAX_ROWS,
                                  "$select": DOB_SELECT}), where, "bin")


def q_hpd(bbl: str) -> dict:
    """HPD: has a native canonical 10-digit `bbl` column. Cleanest of the four."""
    where = f"bbl='{bbl}'"
    rows = soda("hpd", {"$where": where, "$limit": MAX_ROWS,
                        "$select": "violationid, bin, bbl, class, novissueddate, "
                                   "violationstatus, currentstatus, novdescription, "
                                   "housenumber, streetname, apartment, rentimpairing"})
    open_n = sum(1 for r in rows
                 if (r.get("violationstatus") or "").upper() == "OPEN")
    return {"total": len(rows), "open": open_n, "rows": rows,
            "where": where, "matched_by": "bbl"}


def q_ecb(bbl: str) -> dict:
    """DOB ECB Violations: block padded to 5, lot padded to *4* (not 5, unlike DOB)."""
    boro, blk, lt = split_bbl(bbl)
    where = f"boro='{boro}' AND block='{blk:05d}' AND lot='{lt:04d}'"
    return _ecb_pack(soda("ecb", {"$where": where, "$limit": MAX_ROWS,
                                  "$select": ECB_SELECT}), where, "bbl")


def q_ecb_by_bin(bin_: str) -> dict:
    where = f"bin='{bin_}'"
    return _ecb_pack(soda("ecb", {"$where": where, "$limit": MAX_ROWS,
                                  "$select": ECB_SELECT}), where, "bin")


def q_oath(bbl: str) -> dict:
    """
    OATH Hearings Division: keyed by violation_location_* with borough as a
    NAME string, block padded to 5, lot padded to 4. Only property-attached
    agencies populate these fields at all.
    """
    boro, blk, lt = split_bbl(bbl)
    boro_name = BORO_CODE_TO_NAME[boro]
    where = (f"violation_location_borough='{boro_name}' "
             f"AND violation_location_block_no='{blk:05d}' "
             f"AND violation_location_lot_no='{lt:04d}'")
    rows = soda("oath", {"$where": where, "$limit": MAX_ROWS,
                         "$select": "ticket_number, issuing_agency, violation_date, "
                                    "hearing_status, hearing_result, compliance_status, "
                                    "balance_due, penalty_imposed, paid_amount, "
                                    "date_judgment_docketed, violation_details, "
                                    "violation_location_house, violation_location_street_name"})
    owed = sum(float(r.get("balance_due") or 0) for r in rows)
    judgments = sum(1 for r in rows if r.get("date_judgment_docketed"))
    defaults = sum(1 for r in rows
                   if "DEFAULT" in (r.get("hearing_result") or "").upper())
    agencies = Counter((r.get("issuing_agency") or "?").strip() for r in rows)
    return {"total": len(rows), "open": defaults, "balance_due": round(owed, 2),
            "docketed_judgments": judgments, "agencies": dict(agencies),
            "rows": rows, "where": where, "matched_by": "bbl"}


# --- Address-string fallback join (the "if BBL fails" path) ------------------

def q_hpd_by_address(house: str, street: str, boro_code: str) -> set[str]:
    """Resolve BBLs from HPD using a normalized address string."""
    h = normalize_house(house).replace("'", "")
    s = normalize_street(street).replace("'", "")
    if not h or not s:
        return set()
    # HPD stores spelled-out street types; query on the leading token(s) and
    # filter locally after normalizing both sides.
    stem = s.split(" ")[0]
    try:
        rows = soda("hpd", {
            "$select": "bbl, housenumber, streetname",
            "$where": (f"boroid='{boro_code}' AND housenumber='{h}' "
                       f"AND starts_with(streetname, '{stem}')"),
            "$limit": "200",
        })
    except RuntimeError:
        return set()
    hits = set()
    for r in rows:
        if normalize_street(r.get("streetname") or "") == s and r.get("bbl"):
            hits.add(str(r["bbl"]).strip())
    return hits


def q_dob_by_address(house: str, street: str, boro_code: str) -> set[str]:
    """Resolve BBLs from DOB Violations using a normalized address string."""
    h = normalize_house(house).replace("'", "")
    s = normalize_street(street).replace("'", "")
    if not h or not s:
        return set()
    stem = s.split(" ")[0]
    try:
        rows = soda("dob", {
            "$select": "boro, block, lot, house_number, street",
            "$where": (f"boro='{boro_code}' AND house_number='{h}' "
                       f"AND starts_with(street, '{stem}')"),
            "$limit": "200",
        })
    except RuntimeError:
        return set()
    hits = set()
    for r in rows:
        if normalize_street(r.get("street") or "") == s:
            b = canonical_bbl(r.get("boro"), r.get("block"), r.get("lot"))
            if b:
                hits.add(b)
    return hits


# --- Main -------------------------------------------------------------------

def run(test_set: list[dict], limit: int | None) -> dict:
    lots = test_set[:limit] if limit else test_set
    results = []

    for i, lot in enumerate(lots, 1):
        bbl = lot["bbl"]
        label = f"{lot.get('address') or '(no PLUTO address)'} [{lot['borough']}]"
        print(f"[{i}/{len(lots)}] {bbl}  {label}", file=sys.stderr)

        t0 = time.time()
        rec = {"bbl": bbl, "address": lot.get("address"),
               "borough": lot["borough"], "stratum": lot.get("stratum"),
               "bldgclass": lot.get("bldgclass"), "unitsres": lot.get("unitsres")}
        try:
            rec["dob"] = q_dob(bbl)
            rec["hpd"] = q_hpd(bbl)
            rec["ecb"] = q_ecb(bbl)
            rec["oath"] = q_oath(bbl)
        except Exception as exc:  # keep the run alive; record the failure
            rec["error"] = f"{type(exc).__name__}: {exc}"
            results.append(rec)
            continue
        # Record the BBL-only outcome before any recovery, so the findings can
        # report a clean before/after for the recommended strategy.
        rec["bbl_only"] = {s: rec[s]["total"] for s in ("dob", "hpd", "ecb", "oath")}

        # BIN cardinality: multi-building lots are a known ambiguity source.
        bins = set()
        for src in ("dob", "hpd", "ecb"):
            for r in rec[src]["rows"]:
                cb = clean_bin(r.get("bin"))
                if cb:
                    bins.add(cb)
        rec["distinct_bins"] = sorted(bins)

        # --- Pass 2: BIN recovery.
        # Condominium billing lots (lot >= 7501) are the known failure mode:
        # HPD/ECB cite the billing lot, DOB cites the underlying physical lot,
        # so a pure BBL join returns zero DOB rows for a condo. Recover by
        # re-querying on any BIN the other sources revealed.
        rec["is_condo_billing_lot"] = int(bbl[6:10]) >= 7501
        rec["recovered"] = {}
        if bins:
            for src, fn in (("dob", q_dob_by_bin), ("ecb", q_ecb_by_bin)):
                if rec[src]["total"] > 0:
                    continue
                merged, seen_lots = [], set()
                for b in sorted(bins):
                    try:
                        got = fn(b)
                    except Exception:
                        continue
                    merged.extend(got["rows"])
                    for r in got["rows"]:
                        lot_key = canonical_bbl(r.get("boro"), r.get("block"), r.get("lot"))
                        if lot_key:
                            seen_lots.add(lot_key)
                if merged:
                    packer = _dob_pack if src == "dob" else _ecb_pack
                    rec[src] = packer(merged, f"bin IN {sorted(bins)}", "bin")
                    rec["recovered"][src] = {"rows": len(merged),
                                             "underlying_bbls": sorted(seen_lots)}

        rec["elapsed_sec"] = round(time.time() - t0, 2)

        # Address-string fallback, scored against the known-true BBL.
        if lot.get("address"):
            parts = (lot["address"] or "").strip().split(" ", 1)
            if len(parts) == 2:
                house, street = parts
                t1 = time.time()
                hpd_hits = q_hpd_by_address(house, street, bbl[0])
                dob_hits = q_dob_by_address(house, street, bbl[0])
                rec["addr_join"] = {
                    "query": lot["address"],
                    "normalized": f"{normalize_house(house)} {normalize_street(street)}",
                    "hpd_bbls": sorted(hpd_hits), "dob_bbls": sorted(dob_hits),
                    "hpd_correct": bbl in hpd_hits,
                    "dob_correct": bbl in dob_hits,
                    "hpd_ambiguous": len(hpd_hits) > 1,
                    "dob_ambiguous": len(dob_hits) > 1,
                    "elapsed_sec": round(time.time() - t1, 2),
                }

        # Trim raw rows; keep a small sample for manual inspection.
        for src in ("dob", "hpd", "ecb", "oath"):
            rec[src]["sample"] = rec[src].pop("rows")[:2]

        results.append(rec)

    return {"run_at": datetime.now(timezone.utc).isoformat(),
            "datasets": DATASETS, "api_calls": _call_count, "results": results}


def dedup_check(test_set: list[dict], sample: int = 6) -> dict:
    """
    Measure overlap between DOB ECB Violations and OATH Hearings.

    DOB summonses are adjudicated at OATH, so the same summons appears in BOTH
    datasets. OATH's ticket_number is the ECB violation number with a leading
    zero. Reporting both sources naively double-counts open violations and
    double-counts money owed.
    """
    out = {"per_lot": [], "ecb_total": 0, "ecb_also_in_oath": 0}
    for lot in test_set[:sample]:
        bbl = lot["bbl"]
        boro, blk, lt = split_bbl(bbl)
        ecb = soda("ecb", {"$select": "ecb_violation_number",
                           "$where": f"boro='{boro}' AND block='{blk:05d}' AND lot='{lt:04d}'",
                           "$limit": "1000"})
        nums = [str(r["ecb_violation_number"]).strip()
                for r in ecb if r.get("ecb_violation_number")]
        oath = soda("oath", {"$select": "ticket_number",
                             "$where": (f"violation_location_borough='{BORO_CODE_TO_NAME[boro]}' "
                                        f"AND violation_location_block_no='{blk:05d}' "
                                        f"AND violation_location_lot_no='{lt:04d}'"),
                             "$limit": "5000"})
        tix = {str(r["ticket_number"]).strip().lstrip("0")
               for r in oath if r.get("ticket_number")}
        hits = sum(1 for n in nums if n.lstrip("0") in tix)
        out["ecb_total"] += len(nums)
        out["ecb_also_in_oath"] += hits
        out["per_lot"].append({"bbl": bbl, "address": lot.get("address"),
                               "ecb": len(nums), "oath": len(tix), "overlap": hits,
                               "pct": round(100 * hits / len(nums), 1) if nums else None})
    t = out["ecb_total"]
    out["overall_pct"] = round(100 * out["ecb_also_in_oath"] / t, 1) if t else None
    return out


def summarize(payload: dict) -> str:
    """Produce the headline numbers the spike is supposed to answer."""
    res = [r for r in payload["results"] if "error" not in r]
    n = len(res)
    if not n:
        return "No successful results."

    def has(r, src):
        return r[src]["total"] > 0

    SRCS = ("dob", "hpd", "ecb", "oath")
    counts = {s: sum(1 for r in res if has(r, s)) for s in SRCS}
    b_counts = {s: sum(1 for r in res if r.get("bbl_only", {}).get(s, 0) > 0) for s in SRCS}
    all3 = sum(1 for r in res if has(r, "dob") and has(r, "hpd") and has(r, "ecb"))
    b_all3 = sum(1 for r in res
                 if all(r.get("bbl_only", {}).get(s, 0) > 0 for s in ("dob", "hpd", "ecb")))
    all4 = sum(1 for r in res if all(has(r, s) for s in SRCS))
    b_all4 = sum(1 for r in res if all(r.get("bbl_only", {}).get(s, 0) > 0 for s in SRCS))
    any_src = sum(1 for r in res if any(has(r, s) for s in SRCS))
    condos = [r for r in res if r.get("is_condo_billing_lot")]
    condo_bbl_dob = sum(1 for r in condos if r.get("bbl_only", {}).get("dob", 0) > 0)
    recovered = [r for r in res if r.get("recovered")]

    aj = [r["addr_join"] for r in res if r.get("addr_join")]
    hpd_ok = sum(1 for a in aj if a["hpd_correct"])
    dob_ok = sum(1 for a in aj if a["dob_correct"])
    ambig = sum(1 for a in aj if a["hpd_ambiguous"] or a["dob_ambiguous"])

    times = [r["elapsed_sec"] for r in res if "elapsed_sec" in r]
    multibin = sum(1 for r in res if len(r.get("distinct_bins", [])) > 1)
    oath_agencies = Counter()
    for r in res:
        for a, c in (r["oath"].get("agencies") or {}).items():
            oath_agencies[a] += c

    L = []
    L.append(f"Test lots resolved:            {n}")
    L.append("")
    L.append("Lots returning >=1 record per source     BBL only  ->  BBL+BIN recovery")
    for s in SRCS:
        L.append(f"  {s.upper():5s}   {b_counts[s]:3d}/{n} ({100*b_counts[s]/n:5.1f}%)"
                 f"   ->   {counts[s]:3d}/{n} ({100*counts[s]/n:5.1f}%)")
    L.append("")
    L.append(f"  DOB+HPD+ECB joined:   {b_all3}/{n} ({100*b_all3/n:5.1f}%)"
             f"   ->   {all3}/{n} ({100*all3/n:5.1f}%)")
    L.append(f"  All four joined:      {b_all4}/{n} ({100*b_all4/n:5.1f}%)"
             f"   ->   {all4}/{n} ({100*all4/n:5.1f}%)")
    L.append(f"  Data in >=1 source:   {any_src}/{n} ({100*any_src/n:.1f}%)")
    L.append("")
    L.append(f"Condo billing lots (lot>=7501) in set: {len(condos)}")
    if condos:
        L.append(f"  ...of which BBL-only found DOB rows:  {condo_bbl_dob}/{len(condos)}")
    L.append(f"Lots needing BIN recovery:            {len(recovered)}")
    for r in recovered:
        for src, info in r["recovered"].items():
            L.append(f"  {r['bbl']} {(r.get('address') or '')[:26]:26s} {src.upper()}: "
                     f"+{info['rows']} rows under {info['underlying_bbls']}")
    L.append("")
    L.append("Address-string fallback join (scored against known-true BBL):")
    if aj:
        L.append(f"  HPD resolved correct BBL:  {hpd_ok}/{len(aj)} ({100*hpd_ok/len(aj):.1f}%)")
        L.append(f"  DOB resolved correct BBL:  {dob_ok}/{len(aj)} ({100*dob_ok/len(aj):.1f}%)")
        L.append(f"  Ambiguous (>1 BBL back):   {ambig}/{len(aj)} ({100*ambig/len(aj):.1f}%)")
    L.append("")
    L.append(f"Lots spanning multiple BINs:   {multibin}/{n} ({100*multibin/n:.1f}%)")
    if times:
        times_sorted = sorted(times)
        L.append(f"Per-property fetch time:       min {min(times):.1f}s  "
                 f"median {times_sorted[len(times)//2]:.1f}s  max {max(times):.1f}s")
    L.append(f"Total SODA calls:              {payload['api_calls']}")
    if oath_agencies:
        L.append("")
        L.append("OATH tickets matched, by issuing agency:")
        for a, c in oath_agencies.most_common(10):
            L.append(f"  {c:6d}  {a}")
    return "\n".join(L)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rebuild-testset", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--out", default=str(HERE / "results.json"))
    ap.add_argument("--dedup-check", action="store_true",
                    help="only run the ECB/OATH double-count check")
    args = ap.parse_args()

    test_set = load_test_set(args.rebuild_testset)

    if args.dedup_check:
        d = dedup_check(test_set)
        print("ECB <-> OATH overlap (same summons in both datasets)")
        for r in d["per_lot"]:
            print(f"  {r['bbl']}  {(r['address'] or '')[:28]:28s} "
                  f"ecb={r['ecb']:5d} oath={r['oath']:5d} overlap={r['overlap']:5d} "
                  f"({r['pct']}%)")
        print(f"\nOVERALL: {d['ecb_also_in_oath']}/{d['ecb_total']} "
              f"= {d['overall_pct']}% of ECB summonses also appear in OATH")
        (HERE / "dedup_check.json").write_text(json.dumps(d, indent=2))
        return 0

    payload = run(test_set, args.limit)
    Path(args.out).write_text(json.dumps(payload, indent=2, default=str))

    summary = summarize(payload)
    payload_summary = HERE / "summary.txt"
    payload_summary.write_text(summary)
    print("\n" + "=" * 68)
    print("SPIKE SUMMARY")
    print("=" * 68)
    print(summary)
    print(f"\nFull results -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
