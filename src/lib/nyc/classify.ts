/**
 * Severity normalization and the correction-complexity flag (PRD §4.3).
 *
 * Scope boundary (PRD §5, §12): this module classifies *what kind of work a
 * violation implies*, based on how the city itself categorizes it. It does not
 * recommend a course of action, assess likelihood of success, or suggest
 * contesting anything — that would cross into advice.
 *
 * The correction flag is an explicit heuristic over city violation text. It
 * returns "unknown" whenever the source text doesn't clearly indicate one way
 * or the other, which is the honest default and keeps the report from implying
 * more certainty than the data supports.
 */

import type { Agency, CorrectionType } from "./types";

/** Lower ordinal = more severe. Used for sorting; 99 sorts last. */
export function severityRank(agency: Agency, severity: string | null): number {
  if (!severity) return 99;
  const s = severity.toUpperCase();

  if (agency === "HPD") {
    // HPD classes: C immediately hazardous, B hazardous, A non-hazardous,
    // I information order.
    if (s === "C") return 1;
    if (s === "B") return 2;
    if (s === "A") return 3;
    if (s === "I") return 4;
    return 99;
  }

  if (agency === "ECB") {
    // ECB severity arrives as "CLASS - 1" … "CLASS - 3"; 1 is most severe.
    const m = s.match(/(\d)/);
    if (m) return parseInt(m[1], 10);
    return 99;
  }

  return 99;
}

export function severityLabel(agency: Agency, severity: string | null): string | null {
  if (!severity) return null;
  const s = severity.toUpperCase().trim();

  if (agency === "HPD") {
    const map: Record<string, string> = {
      A: "Class A — non-hazardous",
      B: "Class B — hazardous",
      C: "Class C — immediately hazardous",
      I: "Class I — information order",
    };
    return map[s] ?? severity;
  }

  if (agency === "ECB") {
    const m = s.match(/(\d)/);
    if (m) {
      const map: Record<string, string> = {
        "1": "Class 1 — immediately hazardous",
        "2": "Class 2 — major",
        "3": "Class 3 — lesser",
      };
      return map[m[1]] ?? severity;
    }
  }

  return severity;
}

// Phrases that indicate the violation is cleared with paperwork — a filing, a
// certification, a registration — rather than physical work at the property.
const ADMINISTRATIVE_PATTERNS = [
  /FAIL(?:URE|ED)?\s+TO\s+FILE/,
  /FAIL(?:URE|ED)?\s+TO\s+(?:SUBMIT|CERTIFY|REGISTER|RENEW)/,
  /FAIL(?:URE|ED)?\s+TO\s+(?:MAINTAIN|PROVIDE)\s+RECORDS?/,
  /LATE\s+FILING/,
  /NO\s+(?:VALID\s+)?(?:PERMIT|CERTIFICATE)\s+(?:ON\s+FILE|FILED)/,
  /ANNUAL\s+(?:INSPECTION\s+)?REPORT/,
  /REGISTRATION/,
  /PAPERWORK/,
  /\bFILING\b/,
];

// Phrases that indicate physical work is required at the property.
//
// Note the missing leading \b on the distinctive verbs: ECB descriptions glue
// infraction codes directly onto the text ("97X07.97XRESTORE TO SERVICE"), so
// a leading word boundary never matches on real ECB rows. These words are long
// enough that substring matching does not produce false positives.
const PHYSICAL_PATTERNS = [
  /REPAIR\b/,
  /REPLACE\b/,
  /INSTALL\b/,
  /RESTORE\b/,
  /REMOVE\b/,
  /DEFECTIVE\b/,
  /BROKEN\b/,
  /\bLEAK/,
  /\bMOLD\b/,
  /\bVERMIN\b|\bRODENT|\bROACH|\bINFEST/,
  /\bHAZARD/,
  /\bSTRUCTURAL\b/,
  /\bCOLLAPSE\b/,
  /\bUNSAFE\b/,
  /\bDEBRIS\b/,
  /\bPAINT\b/,
  /\bPLASTER\b/,
  /\bABATE\s+THE\s+NUISANCE\b/,
  /\bNO\s+(?:HOT\s+WATER|HEAT)\b/,
  /\bOBSTRUCT/,
];

/**
 * Best-effort two-value classification, defaulting to "unknown".
 *
 * HPD class I is administrative by definition — those are issued
 * administratively rather than after a physical inspection. Everything else is
 * inferred from the violation text, and stays "unknown" when the text is
 * ambiguous.
 */
export function correctionType(
  agency: Agency,
  severity: string | null,
  description: string | null,
): CorrectionType {
  if (agency === "HPD" && severity?.toUpperCase().trim() === "I") {
    return "administrative";
  }

  if (!description) return "unknown";
  const text = description.toUpperCase();

  const admin = ADMINISTRATIVE_PATTERNS.some((p) => p.test(text));
  const physical = PHYSICAL_PATTERNS.some((p) => p.test(text));

  // When a description matches both (e.g. "failure to file report on defective
  // elevator"), physical work is the binding constraint — say so rather than
  // understating what clearing it takes.
  if (physical) return "physical";
  if (admin) return "administrative";
  return "unknown";
}

/**
 * Agencies whose OATH tickets attach to a property.
 *
 * Citywide only ~4% of OATH's 21.9M rows carry block/lot, because most are
 * street- and vehicle-attached (sanitation, TLC, parking). Filtered to these
 * agencies, key coverage is 98.3% for DOB and 96.8% for FDNY.
 * See spike/FINDINGS.md §5.
 */
export const OATH_PROPERTY_AGENCIES = [
  "DEPT. OF BUILDINGS",
  "FIRE DEPARTMENT OF NYC",
  "DEP - BUREAU OF ENV. COMPLIANC",
  "DEP - BWSO",
  "SANITATION DEPT",
  "SANITATION OTHERS",
  "SANITATION RECYCLING",
  "ASBESTOS CONTROL PROGRAM",
  "COOLING TOWERS - DOHMH",
  "DOHMH - BFSCS",
  "PCS - DOHMH",
] as const;

/**
 * Join agency codes into readable prose ("DOB and HPD", "DOB, HPD and ECB").
 *
 * Lives here rather than in a component because three surfaces — the web
 * report, the teaser, and the PDF — have to phrase an outage identically. A
 * PDF that names a different set of missing agencies than the page it was
 * exported from is exactly the drift these reports cannot afford.
 */
export function formatAgencyList(agencies: readonly string[]): string {
  if (agencies.length === 0) return "";
  if (agencies.length === 1) return agencies[0];
  return `${agencies.slice(0, -1).join(", ")} and ${agencies[agencies.length - 1]}`;
}
