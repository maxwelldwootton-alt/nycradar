/**
 * Shared types for the unified NYC violation model.
 *
 * Every source normalizes into `NormalizedViolation` so the report layer never
 * has to know which agency a record came from.
 */

export type Agency = "DOB" | "HPD" | "ECB" | "OATH";

export type ViolationStatus = "open" | "closed" | "unknown";

/**
 * Deliberately a two-value flag plus "unknown" (PRD §4.3). Anything more
 * prescriptive drifts toward the legal-advice boundary in PRD §5/§12.
 */
export type CorrectionType = "administrative" | "physical" | "unknown";

export type MatchedBy = "bbl" | "bin";

export interface NormalizedViolation {
  agency: Agency;
  sourceDataset: string;
  /** Native primary key within the source dataset. */
  sourceId: string;
  /**
   * Cross-source identity for the same real-world summons, normalized with
   * leading zeros stripped. This is what makes ECB/OATH dedup possible.
   */
  dedupKey: string | null;
  bbl: string;
  bin: string | null;
  issuedDate: string | null;
  status: ViolationStatus;
  /** The source's own status wording, preserved for display and audit. */
  rawStatus: string | null;
  severity: string | null;
  description: string | null;
  balanceDue: number | null;
  penaltyImposed: number | null;
  /** Set when a judgment has been docketed — the lien-risk signal. */
  judgmentDocketed: string | null;
  /** For OATH, the agency that wrote the ticket (DOB, FDNY, DEP, …). */
  issuingAgency: string | null;
  /** Heuristic paperwork-vs-physical-work flag; "unknown" when unclear. */
  correctionType: CorrectionType;
  matchedBy: MatchedBy;
  raw: Record<string, unknown>;
}

export interface AgencySection {
  agency: Agency;
  /** Authoritative count from a SoQL aggregate — never a length of `violations`. */
  total: number;
  open: number;
  closed: number;
  balanceDue: number;
  /**
   * Violation detail. May be a capped subset of `total` on heavily-cited
   * properties; `truncated` says so explicitly.
   */
  violations: NormalizedViolation[];
  truncated: boolean;
  /** True when this section's rows were recovered via BIN rather than BBL. */
  recoveredByBin: boolean;
}

export interface PropertyRef {
  bbl: string;
  boroughCode: string;
  borough: string;
  block: number;
  lot: number;
  address: string | null;
  zip: string | null;
  bldgClass: string | null;
  unitsRes: number | null;
  isCondoBillingLot: boolean;
  /** Physical tax lot backing a condo billing lot, when one was resolved. */
  underlyingBbl: string | null;
}

export interface ViolationReport {
  property: PropertyRef;
  sections: AgencySection[];
  summary: {
    totalViolations: number;
    openViolations: number;
    totalBalanceDue: number;
    docketedJudgments: number;
    /** Distinct buildings on the lot. >1 means a multi-building parcel. */
    distinctBins: string[];
    /** ECB records suppressed because the same summons appears in OATH. */
    duplicatesRemoved: number;
  };
  /**
   * Oldest `rowsUpdatedAt` across all four sources — deliberately the oldest,
   * so the timestamp never overstates freshness (FR7).
   */
  dataAsOf: string | null;
  perSourceUpdatedAt: Record<string, string | null>;
  generatedAt: string;
  warnings: string[];
  /**
   * Agencies whose API did not answer. Empty is the normal case and means an
   * empty section is a real "no violations found" rather than a gap — the
   * distinction the report must never blur.
   */
  unavailableSources: Agency[];
}
