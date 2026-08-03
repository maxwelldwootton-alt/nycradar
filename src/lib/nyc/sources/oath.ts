/**
 * OATH Hearings Division Case Status (`jz4z-kudi`).
 *
 * The citywide adjudication docket for every OATH-adjudicated summons — 21.9M
 * rows, the large majority street- or vehicle-attached (sanitation, TLC,
 * parking) with no property to key on. **It must be filtered by issuing
 * agency**; unfiltered it is mostly noise. Filtered, key coverage is 98.3%
 * for DOB and 96.8% for FDNY.
 *
 * This is also the only source for two things the product needs:
 *   - `date_judgment_docketed` — the lien-risk signal in the PRD's problem
 *     statement (judgments accrue 9% interest and can become property liens)
 *   - non-DOB property violations, including FDNY
 *
 * Keys: borough as a NAME ('STATEN IS', not 'STATEN ISLAND'), block 5-wide,
 * lot 4-wide.
 */

import { sodaAll, soqlString } from "../socrata";
import { BORO_CODE_TO_NAME, dedupKey, padBlock, padLot, splitBbl } from "../bbl";
import { OATH_PROPERTY_AGENCIES } from "../classify";
import { cleanText, parseCityDate, parseMoney } from "../parse";
import type { MatchedBy, NormalizedViolation } from "../types";

const DATASET = "jz4z-kudi";
/** Fetched in full — the ECB/OATH dedup is only exact over complete row sets. */
const MAX_ROWS = 20_000;

const SELECT = [
  "ticket_number",
  "issuing_agency",
  "violation_date",
  "hearing_status",
  "hearing_result",
  "compliance_status",
  "balance_due",
  "penalty_imposed",
  "paid_amount",
  "date_judgment_docketed",
  "violation_details",
  "violation_description",
  "charge_1_code_description",
  "violation_location_borough",
  "violation_location_block_no",
  "violation_location_lot_no",
  "violation_location_house",
  "violation_location_street_name",
].join(", ");

export interface OathRow {
  ticket_number?: string;
  issuing_agency?: string;
  violation_date?: string;
  hearing_status?: string;
  hearing_result?: string;
  compliance_status?: string;
  balance_due?: string;
  penalty_imposed?: string;
  paid_amount?: string;
  date_judgment_docketed?: string;
  violation_details?: string;
  violation_description?: string;
  charge_1_code_description?: string;
  violation_location_borough?: string;
  violation_location_block_no?: string;
  violation_location_lot_no?: string;
  violation_location_house?: string;
  violation_location_street_name?: string;
}

function agencyFilter(): string {
  const list = OATH_PROPERTY_AGENCIES.map((a) => soqlString(a)).join(", ");
  return `issuing_agency in(${list})`;
}

export async function fetchByBbl(
  bbl: string,
): Promise<{ rows: OathRow[]; truncated: boolean }> {
  const parts = splitBbl(bbl);
  if (!parts) return { rows: [], truncated: false };
  const boroName = BORO_CODE_TO_NAME[parts.boro];
  if (!boroName) return { rows: [], truncated: false };

  const where = [
    `violation_location_borough=${soqlString(boroName)}`,
    `violation_location_block_no=${soqlString(padBlock(parts.block))}`,
    `violation_location_lot_no=${soqlString(padLot(parts.lot, 4))}`,
    agencyFilter(),
  ].join(" AND ");

  return sodaAll<OathRow>("oath", { $select: SELECT, $where: where }, { maxRows: MAX_ROWS });
}

export function normalize(
  rows: OathRow[],
  bbl: string,
  matchedBy: MatchedBy,
): NormalizedViolation[] {
  return rows.map((r) => {
    const balanceDue = parseMoney(r.balance_due);
    const judgment = parseCityDate(r.date_judgment_docketed);
    const description =
      cleanText(r.violation_details) ??
      cleanText(r.violation_description) ??
      cleanText(r.charge_1_code_description);

    // For an adjudicated summons the actionable question at closing is whether
    // money is still owed, so that — not the hearing's procedural state — is
    // what drives open/closed. The hearing wording is preserved in rawStatus.
    const status: NormalizedViolation["status"] =
      balanceDue !== null && balanceDue > 0 ? "open" : "closed";

    return {
      agency: "OATH",
      sourceDataset: DATASET,
      sourceId: String(r.ticket_number ?? ""),
      // OATH ticket numbers are ECB violation numbers with a leading zero;
      // stripping zeros is what makes the ECB overlap visible at all.
      dedupKey: dedupKey(r.ticket_number),
      bbl,
      bin: null,
      issuedDate: parseCityDate(r.violation_date),
      status,
      rawStatus:
        cleanText(r.hearing_result) ??
        cleanText(r.hearing_status) ??
        cleanText(r.compliance_status),
      severity: null,
      description,
      balanceDue,
      penaltyImposed: parseMoney(r.penalty_imposed),
      judgmentDocketed: judgment,
      issuingAgency: cleanText(r.issuing_agency),
      correctionType: "unknown",
      matchedBy,
      raw: r as Record<string, unknown>,
    } satisfies NormalizedViolation;
  });
}
