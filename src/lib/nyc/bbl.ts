/**
 * BBL / BIN canonicalization.
 *
 * This module encodes the single most important finding of the data spike:
 * every NYC source pads block and lot differently, so string-concatenating a
 * BBL from source fields produces a key that silently matches nothing.
 *
 *   DOB  3h2n-5cm9  block 5-pad, lot **5-pad**   ('00847', '00038')
 *   ECB  6bgk-3dad  block 5-pad, lot **4-pad**   ('01588', '0001')
 *   OATH jz4z-kudi  block 5-pad, lot **4-pad**, borough as a NAME
 *   HPD  wvxf-dwi5  unpadded integers, plus a native canonical `bbl`
 *
 * Always integer-cast, then re-pad to the canonical widths.
 * See spike/FINDINGS.md §3.
 */

export const BORO_CODE_TO_NAME: Record<string, string> = {
  "1": "MANHATTAN",
  "2": "BRONX",
  "3": "BROOKLYN",
  "4": "QUEENS",
  // Note: OATH uses the truncated form, not "STATEN ISLAND".
  "5": "STATEN IS",
};

export const BORO_CODE_TO_LABEL: Record<string, string> = {
  "1": "Manhattan",
  "2": "Bronx",
  "3": "Brooklyn",
  "4": "Queens",
  "5": "Staten Island",
};

export const BORO_CODE_TO_PLUTO: Record<string, string> = {
  "1": "MN",
  "2": "BX",
  "3": "BK",
  "4": "QN",
  "5": "SI",
};

export const BORO_NAME_TO_CODE: Record<string, string> = {
  MANHATTAN: "1",
  NEWYORK: "1",
  NY: "1",
  MN: "1",
  BRONX: "2",
  THEBRONX: "2",
  BX: "2",
  BROOKLYN: "3",
  KINGS: "3",
  BK: "3",
  BKLYN: "3",
  QUEENS: "4",
  QN: "4",
  QNS: "4",
  STATENISLAND: "5",
  STATENIS: "5",
  RICHMOND: "5",
  SI: "5",
};

/** Condominium billing lots start at 7501. See condo caveat in `report.ts`. */
export const CONDO_BILLING_LOT_MIN = 7501;

function toInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === "") return null;
  // Handles PLUTO's float-string BBLs ("2054800111.00000000") as well as
  // zero-padded text ("00038").
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/**
 * Canonical 10-character BBL: borough(1) + block(5, zero-padded) + lot(4,
 * zero-padded). Returns null when the inputs cannot form a valid BBL.
 */
export function canonicalBbl(
  boro: unknown,
  block: unknown,
  lot: unknown,
): string | null {
  const b = toInt(boro);
  const blk = toInt(block);
  const lt = toInt(lot);
  if (b === null || blk === null || lt === null) return null;
  const boroStr = String(b);
  if (!(boroStr in BORO_CODE_TO_NAME)) return null;
  if (blk <= 0 || blk > 99999) return null;
  if (lt < 0 || lt > 9999) return null;
  return `${boroStr}${String(blk).padStart(5, "0")}${String(lt).padStart(4, "0")}`;
}

/** Parse a canonical BBL (or a PLUTO float-string BBL) into its parts. */
export function splitBbl(
  bbl: string,
): { boro: string; block: number; lot: number } | null {
  const clean = String(bbl).trim().split(".")[0].padStart(10, "0");
  if (!/^\d{10}$/.test(clean)) return null;
  const boro = clean[0];
  if (!(boro in BORO_CODE_TO_NAME)) return null;
  return {
    boro,
    block: parseInt(clean.slice(1, 6), 10),
    lot: parseInt(clean.slice(6, 10), 10),
  };
}

/** Normalize any BBL-ish input (float string, unpadded) to canonical form. */
export function normalizeBbl(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  const parts = splitBbl(String(input));
  if (!parts) return null;
  return canonicalBbl(parts.boro, parts.block, parts.lot);
}

/**
 * Reject sentinel BINs. `0000000` means "unknown", and `X000000` is a borough
 * placeholder ("some building in borough X"), not a real building. Measured at
 * 0.15% of DOB rows — small, but they would join wildly if treated as real.
 */
export function cleanBin(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const b = String(raw).trim();
  if (!/^\d{7}$/.test(b)) return null;
  if (b === "0000000") return null;
  if (b.endsWith("000000")) return null;
  return b;
}

export function isCondoBillingLot(bbl: string): boolean {
  const parts = splitBbl(bbl);
  return parts !== null && parts.lot >= CONDO_BILLING_LOT_MIN;
}

/** Per-source padding. Getting the width wrong yields a silent zero-row join. */
export function padBlock(block: number): string {
  return String(block).padStart(5, "0");
}

export function padLot(lot: number, width: 4 | 5): string {
  return String(lot).padStart(width, "0");
}

/**
 * Strip leading zeros for cross-source identity comparison.
 *
 * OATH's `ticket_number` is the ECB violation number with a leading zero
 * (ECB `39523868K` ↔ OATH `039523868K`), so exact string matching finds *zero*
 * overlap between the two datasets while ~82.6% of records are in fact the
 * same summons. See spike/FINDINGS.md §5.
 */
export function dedupKey(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toUpperCase().replace(/^0+/, "");
  return s === "" ? null : s;
}

export function boroughCodeFromName(name: string): string | null {
  const key = name.toUpperCase().replace(/[^A-Z]/g, "");
  return BORO_NAME_TO_CODE[key] ?? null;
}
