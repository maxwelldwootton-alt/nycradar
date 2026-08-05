/**
 * DOB ECB Violations (`6bgk-3dad`) — DOB summonses adjudicated at OATH/ECB.
 *
 * This is the property-keyed ECB source, and it is a better starting point
 * than the OATH Hearings dataset the PRD names: it carries native `bin`,
 * `boro`, `block`, `lot` plus the money fields.
 *
 * Padding: block 5-wide, **lot 4-wide** is the documented convention (unlike
 * DOB Violations, which pads lot to 5) — but ~23% of live rows use 5-wide lot
 * instead (see issue #17), so the fetch below matches both widths rather than
 * trusting a single exact string. Note also that the penalty field is
 * misspelled `penality_imposed` in the source — that is not a typo here.
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
import { cleanText, parseCityDate, parseMoney } from "../parse";
import { correctionType } from "../classify";
import type { MatchedBy, NormalizedViolation } from "../types";

const DATASET = "6bgk-3dad";
/** Fetched in full — the ECB/OATH dedup is only exact over complete row sets. */
const MAX_ROWS = 20_000;

const SELECT = [
  "ecb_violation_number",
  "dob_violation_number",
  "bin",
  "boro",
  "block",
  "lot",
  "ecb_violation_status",
  "issue_date",
  "severity",
  "violation_type",
  "violation_description",
  "penality_imposed",
  "amount_paid",
  "balance_due",
  "hearing_status",
  "certification_status",
  "section_law_description1",
].join(", ");

export interface EcbRow {
  ecb_violation_number?: string;
  dob_violation_number?: string;
  bin?: string;
  boro?: string;
  block?: string;
  lot?: string;
  ecb_violation_status?: string;
  issue_date?: string;
  severity?: string;
  violation_type?: string;
  violation_description?: string;
  /** Misspelled in the source dataset. */
  penality_imposed?: string;
  amount_paid?: string;
  balance_due?: string;
  hearing_status?: string;
  certification_status?: string;
  section_law_description1?: string;
}

export async function fetchByBbl(
  bbl: string,
): Promise<{ rows: EcbRow[]; truncated: boolean }> {
  const parts = splitBbl(bbl);
  if (!parts) return { rows: [], truncated: false };
  const where = [
    `boro=${soqlString(parts.boro)}`,
    `block=${soqlString(padBlock(parts.block))}`,
    // Match both 4- and 5-wide lot — a single exact-padded string misses a
    // meaningful fraction of rows recorded at the other width (issue #17).
    `lot in(${padLotVariants(parts.lot).map(soqlString).join(", ")})`,
  ].join(" AND ");
  return sodaAll<EcbRow>("ecb", { $select: SELECT, $where: where }, { maxRows: MAX_ROWS });
}

export async function fetchByBin(
  bin: string,
): Promise<{ rows: EcbRow[]; truncated: boolean }> {
  return sodaAll<EcbRow>(
    "ecb",
    { $select: SELECT, $where: `bin=${soqlString(bin)}` },
    { maxRows: MAX_ROWS },
  );
}

export function normalize(
  rows: EcbRow[],
  bbl: string,
  matchedBy: MatchedBy,
): NormalizedViolation[] {
  return rows.map((r) => {
    const status = (r.ecb_violation_status ?? "").toUpperCase();
    const description =
      cleanText(r.violation_description) ??
      cleanText(r.section_law_description1) ??
      cleanText(r.violation_type);
    const severity = cleanText(r.severity);
    const rowBbl = canonicalBbl(r.boro, r.block, r.lot) ?? bbl;

    return {
      agency: "ECB",
      sourceDataset: DATASET,
      sourceId: String(r.ecb_violation_number ?? ""),
      // The join key against OATH's `ticket_number`, leading zeros stripped.
      dedupKey: dedupKey(r.ecb_violation_number),
      bbl: rowBbl,
      bin: cleanBin(r.bin),
      issuedDate: parseCityDate(r.issue_date),
      status: status === "ACTIVE" ? "open" : status === "RESOLVE" ? "closed" : "unknown",
      rawStatus: cleanText(r.ecb_violation_status),
      severity,
      description,
      balanceDue: parseMoney(r.balance_due),
      penaltyImposed: parseMoney(r.penality_imposed),
      judgmentDocketed: null,
      issuingAgency: "Department of Buildings",
      correctionType: correctionType("ECB", severity, description),
      matchedBy,
      raw: r as Record<string, unknown>,
    } satisfies NormalizedViolation;
  });
}
