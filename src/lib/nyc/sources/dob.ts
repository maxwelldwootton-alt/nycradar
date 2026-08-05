/**
 * DOB Violations (`3h2n-5cm9`) — civil penalties issued in DOB's Buildings
 * Information System.
 *
 * Padding: block 5-wide, **lot 5-wide** is the documented convention — this
 * is the outlier, since every other source pads lot to 4. But a meaningful
 * fraction of live rows use 4-wide lot instead (see issue #17), so the fetch
 * below matches both widths rather than trusting a single exact string. See
 * spike/FINDINGS.md §3.
 */

import { sodaAll, soqlString } from "../socrata";
import {
  canonicalBbl,
  cleanBin,
  dedupKey,
  padBlock,
  padLotVariants,
  splitBbl,
} from "../bbl";
import { cleanText, parseCityDate } from "../parse";
import { correctionType } from "../classify";
import type { MatchedBy, NormalizedViolation } from "../types";

const DATASET = "3h2n-5cm9";
const MAX_ROWS = 20_000;

const SELECT = [
  "isn_dob_bis_viol",
  "bin",
  "boro",
  "block",
  "lot",
  "issue_date",
  "violation_type",
  "violation_type_code",
  "violation_category",
  "violation_number",
  "ecb_number",
  "description",
  "disposition_date",
  "disposition_comments",
  "house_number",
  "street",
].join(", ");

export interface DobRow {
  isn_dob_bis_viol?: string;
  bin?: string;
  boro?: string;
  block?: string;
  lot?: string;
  issue_date?: string;
  violation_type?: string;
  violation_type_code?: string;
  violation_category?: string;
  violation_number?: string;
  ecb_number?: string;
  description?: string;
  disposition_date?: string;
  disposition_comments?: string;
  house_number?: string;
  street?: string;
}

export async function fetchByBbl(
  bbl: string,
): Promise<{ rows: DobRow[]; truncated: boolean }> {
  const parts = splitBbl(bbl);
  if (!parts) return { rows: [], truncated: false };
  const where = [
    `boro=${soqlString(parts.boro)}`,
    `block=${soqlString(padBlock(parts.block))}`,
    // Match both 4- and 5-wide lot — a single exact-padded string misses a
    // meaningful fraction of rows recorded at the other width (issue #17).
    `lot in(${padLotVariants(parts.lot).map(soqlString).join(", ")})`,
  ].join(" AND ");
  return sodaAll<DobRow>("dob", { $select: SELECT, $where: where }, { maxRows: MAX_ROWS });
}

export async function fetchByBin(
  bin: string,
): Promise<{ rows: DobRow[]; truncated: boolean }> {
  return sodaAll<DobRow>(
    "dob",
    { $select: SELECT, $where: `bin=${soqlString(bin)}` },
    { maxRows: MAX_ROWS },
  );
}

export function normalize(
  rows: DobRow[],
  bbl: string,
  matchedBy: MatchedBy,
): NormalizedViolation[] {
  return rows.map((r) => {
    const category = r.violation_category ?? "";
    const isOpen = category.toUpperCase().includes("ACTIVE");
    const description = cleanText(r.description) ?? cleanText(r.violation_type);
    // Prefer the row's own BBL when present — under BIN recovery this is the
    // underlying physical lot, which differs from the queried condo lot.
    const rowBbl = canonicalBbl(r.boro, r.block, r.lot) ?? bbl;

    return {
      agency: "DOB",
      sourceDataset: DATASET,
      sourceId: String(r.isn_dob_bis_viol ?? r.violation_number ?? ""),
      // DOB rows referencing an ECB summons carry its number here.
      dedupKey: dedupKey(r.ecb_number),
      bbl: rowBbl,
      bin: cleanBin(r.bin),
      issuedDate: parseCityDate(r.issue_date),
      status: isOpen ? "open" : "closed",
      rawStatus: cleanText(r.violation_category),
      severity: null,
      description,
      balanceDue: null,
      penaltyImposed: null,
      judgmentDocketed: null,
      issuingAgency: "Department of Buildings",
      correctionType: correctionType("DOB", null, description),
      matchedBy,
      raw: r as Record<string, unknown>,
    } satisfies NormalizedViolation;
  });
}
