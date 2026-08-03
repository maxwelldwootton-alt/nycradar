/**
 * HPD Housing Maintenance Code Violations (`wvxf-dwi5`).
 *
 * The cleanest of the four sources: it carries a native canonical 10-digit
 * `bbl` column, populated on 99.9% of rows, plus a usable `bin`. That makes it
 * the primary source of BINs for the condo-recovery pass.
 */

import { soda, sodaAll, soqlString } from "../socrata";
import { cleanBin, normalizeBbl } from "../bbl";
import { cleanText, parseCityDate } from "../parse";
import { correctionType } from "../classify";
import type { MatchedBy, NormalizedViolation } from "../types";

const DATASET = "wvxf-dwi5";

/**
 * HPD is by far the highest-volume source — distressed buildings exceed 5,000
 * violations, and Co-op City-scale lots exceed 20,000. Detail rows are capped
 * for display while counts come from an aggregate, so headline numbers stay
 * exact even when the list is a subset.
 */
const DISPLAY_CAP = 2000;

const SELECT = [
  "violationid",
  "bin",
  "bbl",
  "class",
  "novissueddate",
  "violationstatus",
  "currentstatus",
  "currentstatusdate",
  "novdescription",
  "housenumber",
  "streetname",
  "apartment",
  "story",
  "rentimpairing",
].join(", ");

export interface HpdRow {
  violationid?: string;
  bin?: string;
  bbl?: string;
  class?: string;
  novissueddate?: string;
  violationstatus?: string;
  currentstatus?: string;
  currentstatusdate?: string;
  novdescription?: string;
  housenumber?: string;
  streetname?: string;
  apartment?: string;
  story?: string;
  rentimpairing?: string;
}

export interface HpdCounts {
  total: number;
  open: number;
  closed: number;
}

/**
 * Exact status counts via aggregate. Cheap regardless of property size, and
 * the only way to report an accurate open-violation count on a lot with tens
 * of thousands of records.
 */
export async function countsByBbl(bbl: string): Promise<HpdCounts> {
  const rows = await soda<{ violationstatus?: string; n?: string }>("hpd", {
    $select: "violationstatus, count(1) as n",
    $where: `bbl=${soqlString(bbl)}`,
    $group: "violationstatus",
  });
  return tallyCounts(rows);
}

export async function countsByBin(bin: string): Promise<HpdCounts> {
  const rows = await soda<{ violationstatus?: string; n?: string }>("hpd", {
    $select: "violationstatus, count(1) as n",
    $where: `bin=${soqlString(bin)}`,
    $group: "violationstatus",
  });
  return tallyCounts(rows);
}

function tallyCounts(rows: { violationstatus?: string; n?: string }[]): HpdCounts {
  let total = 0;
  let open = 0;
  let closed = 0;
  for (const r of rows) {
    const n = parseInt(r.n ?? "0", 10) || 0;
    total += n;
    const s = (r.violationstatus ?? "").toUpperCase();
    if (s === "OPEN") open += n;
    else if (s === "CLOSE") closed += n;
  }
  return { total, open, closed };
}

export async function fetchByBbl(
  bbl: string,
): Promise<{ rows: HpdRow[]; truncated: boolean }> {
  return sodaAll<HpdRow>(
    "hpd",
    {
      $select: SELECT,
      $where: `bbl=${soqlString(bbl)}`,
      // Open first so a capped list still surfaces what matters at closing.
      $order: "violationstatus ASC, novissueddate DESC",
    },
    { pageSize: 1000, maxRows: DISPLAY_CAP },
  );
}

export async function fetchByBin(
  bin: string,
): Promise<{ rows: HpdRow[]; truncated: boolean }> {
  return sodaAll<HpdRow>(
    "hpd",
    {
      $select: SELECT,
      $where: `bin=${soqlString(bin)}`,
      $order: "violationstatus ASC, novissueddate DESC",
    },
    { pageSize: 1000, maxRows: DISPLAY_CAP },
  );
}

export function normalize(
  rows: HpdRow[],
  bbl: string,
  matchedBy: MatchedBy,
): NormalizedViolation[] {
  return rows.map((r) => {
    const status = (r.violationstatus ?? "").toUpperCase();
    const description = cleanText(r.novdescription);
    const severity = cleanText(r.class);

    return {
      agency: "HPD",
      sourceDataset: DATASET,
      sourceId: String(r.violationid ?? ""),
      // HPD violation IDs are internal to HPD and share no namespace with the
      // DOB/OATH summons numbering, so there is nothing to dedup against.
      dedupKey: null,
      bbl: normalizeBbl(r.bbl) ?? bbl,
      bin: cleanBin(r.bin),
      issuedDate: parseCityDate(r.novissueddate),
      status: status === "OPEN" ? "open" : status === "CLOSE" ? "closed" : "unknown",
      rawStatus: cleanText(r.currentstatus),
      severity,
      description,
      balanceDue: null,
      penaltyImposed: null,
      judgmentDocketed: null,
      issuingAgency: "Housing Preservation & Development",
      correctionType: correctionType("HPD", severity, description),
      matchedBy,
      raw: r as Record<string, unknown>,
    } satisfies NormalizedViolation;
  });
}
