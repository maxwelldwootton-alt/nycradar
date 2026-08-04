/**
 * Report orchestration — the core of the product.
 *
 * Fetches all four sources for a BBL and assembles one unified report. The
 * ordering here is not incidental; each step encodes a finding from the data
 * spike, and skipping any of them produces a report that is wrong in a way
 * that looks plausible:
 *
 *   1. Query by canonical BBL, with per-source padding.
 *   2. Collect BINs, then re-query DOB/ECB by BIN when they came back empty.
 *      Condo billing lots (7501+) are cited by HPD/ECB against the billing lot
 *      but by DOB against the *underlying physical lot* — without this pass a
 *      condo reports zero DOB violations and reads as a clean building.
 *   3. Deduplicate ECB against OATH. ~82.6% of ECB summonses also appear in
 *      OATH; exact string matching finds none of them because OATH prefixes a
 *      zero. Skipping this roughly doubles both counts and dollars owed.
 *
 * See spike/FINDINGS.md for the measurements behind each.
 */

import { unstable_cache } from "next/cache";
import { cleanBin, isCondoBillingLot, splitBbl, BORO_CODE_TO_LABEL } from "./bbl";
import { datasetUpdatedAt } from "./socrata";
import * as dob from "./sources/dob";
import * as hpd from "./sources/hpd";
import * as ecb from "./sources/ecb";
import * as oath from "./sources/oath";
import { severityRank } from "./classify";
import type {
  Agency,
  AgencySection,
  NormalizedViolation,
  PropertyRef,
  ViolationReport,
} from "./types";

/** Canonical order for anything that reports per-agency state to a reader. */
const AGENCIES: Agency[] = ["DOB", "HPD", "ECB", "OATH"];

export interface GenerateOptions {
  /** Known property metadata (from PLUTO), merged into the report. */
  property?: Partial<PropertyRef>;
  /** Skip the BIN recovery pass. Only useful for measuring its effect. */
  skipBinRecovery?: boolean;
}

/**
 * Merge OATH duplicates into their ECB counterparts.
 *
 * Both datasets describe the same summons from different angles: ECB carries
 * severity and certification status, OATH carries the docketed judgment. Rather
 * than drop one, the OATH record's financial detail is folded into the ECB
 * record and the duplicate is removed.
 */
export function dedupeEcbAgainstOath(
  ecbRows: NormalizedViolation[],
  oathRows: NormalizedViolation[],
): { ecb: NormalizedViolation[]; oath: NormalizedViolation[]; removed: number } {
  const oathByKey = new Map<string, NormalizedViolation>();
  for (const row of oathRows) {
    if (row.dedupKey) oathByKey.set(row.dedupKey, row);
  }

  const matchedKeys = new Set<string>();
  const mergedEcb = ecbRows.map((row) => {
    if (!row.dedupKey) return row;
    const match = oathByKey.get(row.dedupKey);
    if (!match) return row;
    matchedKeys.add(row.dedupKey);
    return {
      ...row,
      // OATH is the only source of the docketed-judgment date.
      judgmentDocketed: row.judgmentDocketed ?? match.judgmentDocketed,
      balanceDue: row.balanceDue ?? match.balanceDue,
      penaltyImposed: row.penaltyImposed ?? match.penaltyImposed,
    };
  });

  const remainingOath = oathRows.filter(
    (row) => !row.dedupKey || !matchedKeys.has(row.dedupKey),
  );

  return {
    ecb: mergedEcb,
    oath: remainingOath,
    removed: oathRows.length - remainingOath.length,
  };
}

function buildSection(
  agency: Agency,
  violations: NormalizedViolation[],
  opts: { truncated?: boolean; counts?: { total: number; open: number; closed: number } } = {},
): AgencySection {
  const sorted = [...violations].sort((a, b) => {
    // Open first, then most severe, then most recent.
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    const rank = severityRank(agency, a.severity) - severityRank(agency, b.severity);
    if (rank !== 0) return rank;
    return (b.issuedDate ?? "").localeCompare(a.issuedDate ?? "");
  });

  // Prefer authoritative aggregate counts when supplied — on a capped section
  // the length of `violations` would understate the real total.
  const counts = opts.counts ?? {
    total: sorted.length,
    open: sorted.filter((v) => v.status === "open").length,
    closed: sorted.filter((v) => v.status === "closed").length,
  };

  return {
    agency,
    total: counts.total,
    open: counts.open,
    closed: counts.closed,
    balanceDue:
      Math.round(sorted.reduce((sum, v) => sum + (v.balanceDue ?? 0), 0) * 100) / 100,
    violations: sorted,
    truncated: opts.truncated ?? false,
    recoveredByBin: sorted.length > 0 && sorted.every((v) => v.matchedBy === "bin"),
  };
}

export async function generateReport(
  bbl: string,
  opts: GenerateOptions = {},
): Promise<ViolationReport> {
  const parts = splitBbl(bbl);
  if (!parts) throw new Error(`Invalid BBL: ${bbl}`);

  const warnings: string[] = [];
  const unavailable = new Set<Agency>();

  // --- Pass 1: query every source by canonical BBL, in parallel.
  // Freshness metadata is kicked off here too rather than awaited at the end,
  // so it overlaps the row fetches instead of adding to total latency.
  const freshnessPromise = Promise.all([
    datasetUpdatedAt("dob"),
    datasetUpdatedAt("hpd"),
    datasetUpdatedAt("ecb"),
    datasetUpdatedAt("oath"),
  ]);

  // `allSettled`, not `all`: one agency's API being down must not take the
  // whole report with it. A partial report is worth showing — but only if the
  // reader is told which agency is missing, which is what `unavailable`
  // carries. An empty section from a failed fetch and an empty section from a
  // genuinely clean building look identical otherwise.
  const [dobRaw, hpdRaw, ecbRaw, oathRaw, hpdCountsBbl] = await Promise.allSettled([
    dob.fetchByBbl(bbl),
    hpd.fetchByBbl(bbl),
    ecb.fetchByBbl(bbl),
    oath.fetchByBbl(bbl),
    hpd.countsByBbl(bbl),
  ]);

  const empty = { rows: [] as Record<string, unknown>[], truncated: false };
  function unwrap<T>(
    result: PromiseSettledResult<T>,
    agency: Agency,
    fallback: T,
  ): T {
    if (result.status === "fulfilled") return result.value;
    unavailable.add(agency);
    console.error(`${agency} fetch failed for ${bbl}`, result.reason);
    return fallback;
  }

  const dobResult = unwrap(dobRaw, "DOB", empty);
  const hpdResult = unwrap(hpdRaw, "HPD", empty);
  const ecbResult = unwrap(ecbRaw, "ECB", empty);
  const oathResult = unwrap(oathRaw, "OATH", empty);

  let dobViolations = dob.normalize(dobResult.rows, bbl, "bbl");
  let hpdViolations = hpd.normalize(hpdResult.rows, bbl, "bbl");
  let ecbViolations = ecb.normalize(ecbResult.rows, bbl, "bbl");
  const oathViolations = oath.normalize(oathResult.rows, bbl, "bbl");

  // HPD's headline count comes from a separate aggregate query. If it fails
  // while the rows succeed, the counts fall back to the row lengths — which
  // understate a capped section — so HPD is still flagged unavailable.
  let hpdCounts = unwrap(hpdCountsBbl, "HPD", {
    total: hpdViolations.length,
    open: hpdViolations.filter((v) => v.status === "open").length,
    closed: hpdViolations.filter((v) => v.status === "closed").length,
  });
  let hpdTruncated = hpdResult.truncated;

  // --- Pass 2: BIN recovery for the condo billing-lot failure mode.
  const bins = new Set<string>();
  for (const v of [...dobViolations, ...hpdViolations, ...ecbViolations]) {
    if (v.bin) bins.add(v.bin);
  }

  let underlyingBbl: string | null = null;

  if (!opts.skipBinRecovery && bins.size > 0) {
    const binList = [...bins].sort();

    // A failed recovery pass is the condo failure mode this whole step exists
    // to prevent, so it flags the agency rather than silently leaving the
    // section empty.
    async function recover<T>(
      agency: Agency,
      fetches: Promise<T>[],
    ): Promise<T[] | null> {
      const settled = await Promise.allSettled(fetches);
      const failed = settled.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        unavailable.add(agency);
        console.error(`${agency} BIN recovery failed for ${bbl}`, failed[0].reason);
        return null;
      }
      return settled.map((r) => (r as PromiseFulfilledResult<T>).value);
    }

    if (dobViolations.length === 0 && !unavailable.has("DOB")) {
      const results = await recover("DOB", binList.map((bin) => dob.fetchByBin(bin)));
      const recovered = results?.flatMap((r) => r.rows) ?? [];
      if (recovered.length > 0) {
        dobViolations = dob.normalize(recovered, bbl, "bin");
        underlyingBbl =
          dobViolations.find((v) => v.bbl !== bbl)?.bbl ?? underlyingBbl;
      }
    }

    if (ecbViolations.length === 0 && !unavailable.has("ECB")) {
      const results = await recover("ECB", binList.map((bin) => ecb.fetchByBin(bin)));
      const recovered = results?.flatMap((r) => r.rows) ?? [];
      if (recovered.length > 0) {
        ecbViolations = ecb.normalize(recovered, bbl, "bin");
        underlyingBbl =
          ecbViolations.find((v) => v.bbl !== bbl)?.bbl ?? underlyingBbl;
      }
    }

    if (hpdViolations.length === 0 && !unavailable.has("HPD")) {
      const results = await recover("HPD", binList.map((bin) => hpd.fetchByBin(bin)));
      const recovered = results?.flatMap((r) => r.rows) ?? [];
      if (recovered.length > 0) {
        hpdViolations = hpd.normalize(recovered, bbl, "bin");
        hpdTruncated = results!.some((r) => r.truncated);
        // Counts must follow the same key the rows came from, or the headline
        // number would disagree with the list beneath it.
        const perBin = await recover("HPD", binList.map((bin) => hpd.countsByBin(bin)));
        hpdCounts = perBin
          ? perBin.reduce(
              (acc, c) => ({
                total: acc.total + c.total,
                open: acc.open + c.open,
                closed: acc.closed + c.closed,
              }),
              { total: 0, open: 0, closed: 0 },
            )
          : {
              total: hpdViolations.length,
              open: hpdViolations.filter((v) => v.status === "open").length,
              closed: hpdViolations.filter((v) => v.status === "closed").length,
            };
      }
    }
  }

  if (underlyingBbl) {
    warnings.push(
      `This is a condominium billing lot. DOB and ECB records are filed against the underlying tax lot ${underlyingBbl} and have been included.`,
    );
  }

  // --- Pass 3: deduplicate ECB against OATH.
  const deduped = dedupeEcbAgainstOath(ecbViolations, oathViolations);

  const sections: AgencySection[] = [
    buildSection("DOB", dobViolations, { truncated: dobResult.truncated }),
    buildSection("HPD", hpdViolations, {
      truncated: hpdTruncated,
      counts: hpdCounts,
    }),
    buildSection("ECB", deduped.ecb, { truncated: ecbResult.truncated }),
    buildSection("OATH", deduped.oath, { truncated: oathResult.truncated }),
  ];

  // Ordered by AGENCIES so the list is stable across runs — Set iteration
  // order would otherwise vary with which source happened to fail first.
  //
  // Deliberately NOT folded into `warnings`: this one is rendered at a
  // different severity than the rest (an outage is a failure, a truncation
  // notice is context), and each surface renders it from this field directly
  // rather than by string-matching a warning it can't distinguish.
  const unavailableSources = AGENCIES.filter((a) => unavailable.has(a));

  for (const s of sections) {
    if (s.truncated) {
      warnings.push(
        `${s.agency} detail is limited to the ${s.violations.length} most relevant records of ${s.total}. Counts above reflect the full total.`,
      );
    }
  }

  const all = sections.flatMap((s) => s.violations);
  const distinctBins = [...new Set(all.map((v) => v.bin).filter(Boolean))].sort() as string[];

  if (distinctBins.length > 1) {
    warnings.push(
      `This tax lot contains ${distinctBins.length} separate buildings. Violations shown cover the entire lot.`,
    );
  }

  // --- Freshness. Deliberately the OLDEST source timestamp (FR7).
  const [dobAt, hpdAt, ecbAt, oathAt] = await freshnessPromise;
  const perSourceUpdatedAt = {
    "3h2n-5cm9": dobAt,
    "wvxf-dwi5": hpdAt,
    "6bgk-3dad": ecbAt,
    "jz4z-kudi": oathAt,
  };
  const stamps = Object.values(perSourceUpdatedAt).filter(Boolean) as string[];
  const dataAsOf = stamps.length > 0 ? stamps.sort()[0] : null;
  if (stamps.length < 4) {
    warnings.push(
      "Freshness metadata was unavailable for one or more sources; the data-as-of date reflects only the sources that reported it.",
    );
  }

  const property: PropertyRef = {
    bbl,
    boroughCode: parts.boro,
    borough: BORO_CODE_TO_LABEL[parts.boro] ?? parts.boro,
    block: parts.block,
    lot: parts.lot,
    address: opts.property?.address ?? null,
    zip: opts.property?.zip ?? null,
    bldgClass: opts.property?.bldgClass ?? null,
    unitsRes: opts.property?.unitsRes ?? null,
    isCondoBillingLot: isCondoBillingLot(bbl),
    underlyingBbl: underlyingBbl ?? opts.property?.underlyingBbl ?? null,
  };

  return {
    property,
    sections,
    summary: {
      // Summed from section totals, not from `all` — on a capped section the
      // detail rows are a subset, and summing them would understate the count
      // that a buyer is actually exposed to.
      totalViolations: sections.reduce((sum, s) => sum + s.total, 0),
      openViolations: sections.reduce((sum, s) => sum + s.open, 0),
      // Money and judgments come only from ECB and OATH, which are fetched in
      // full, so these remain exact.
      totalBalanceDue:
        Math.round(sections.reduce((sum, s) => sum + s.balanceDue, 0) * 100) / 100,
      docketedJudgments: all.filter((v) => v.judgmentDocketed).length,
      distinctBins,
      duplicatesRemoved: deduped.removed,
    },
    dataAsOf,
    perSourceUpdatedAt,
    generatedAt: new Date().toISOString(),
    warnings,
    unavailableSources,
  };
}

/**
 * Whether every source answered — i.e. whether an empty section means "clean"
 * rather than "we could not tell".
 *
 * Pure and exported so the cache guard below and its test agree on one
 * definition. Note that a report with zero violations from four healthy
 * sources IS complete: "no violations found" is a real, cacheable answer, and
 * conflating it with an outage would defeat the purpose of the flag.
 */
export function isReportComplete(report: ViolationReport): boolean {
  return report.unavailableSources.length === 0;
}

/**
 * Carries a partial report back out of the cached function.
 *
 * `unstable_cache` has no conditional-write API — it stores whatever the inner
 * function resolves to. Rejections are not stored, so throwing is the only way
 * to keep a partial report out of the cache. The report rides along on the
 * error so the caller can still serve it.
 */
class PartialReportError extends Error {
  constructor(readonly report: ViolationReport) {
    super("report incomplete; not cached");
    this.name = "PartialReportError";
  }
}

/**
 * Matches on the name as well as the prototype: `unstable_cache` propagates
 * rejections in-process today, so `instanceof` holds, but if a future version
 * ever reconstructs the error the prototype would be the first thing lost and
 * the name the last. Getting this wrong would 500 the report page during
 * exactly the outage it is supposed to degrade through.
 */
function partialReportOf(err: unknown): ViolationReport | null | undefined {
  if (err instanceof PartialReportError) return err.report;
  if ((err as Error | null)?.name === "PartialReportError") {
    return (err as PartialReportError).report ?? null;
  }
  return undefined;
}

const cacheCompleteOnly = unstable_cache(
  async (bbl: string): Promise<ViolationReport> => {
    const report = await generateReport(bbl);
    if (!isReportComplete(report)) throw new PartialReportError(report);
    return report;
  },
  ["violation-report"],
  { revalidate: 3600 },
);

/**
 * Cached front door for read-only surfaces (the report page, its PDF export,
 * and the public property-teaser page all want the same data).
 *
 * The 4 live Socrata calls in `generateReport` are the dominant cost on every
 * one of those routes, and unlike entitlement — which is per-visitor and must
 * stay dynamic — the violation data itself is the same for everyone looking
 * at a given BBL within the hour. Caching it here, rather than caching the
 * page, keeps personalized rendering (who gets the teaser vs. the full view)
 * fully dynamic while still cutting repeat-request latency.
 *
 * Deliberately keyed on `bbl` alone, with no PLUTO property data merged in
 * here — `generateReport`'s violation-fetching never depends on `opts.property`
 * (it only decorates the result), and pulling `./property` into this module
 * would drag in its `server-only` guard, which breaks the pure-function tests
 * in tests/dedupe.test.ts. Callers merge property data in via `withProperty`.
 *
 * A report generated while an agency was down is served but never cached: an
 * incomplete report pinned for an hour would show a missing agency as a clean
 * building to everyone who looked in that window.
 */
export async function getCachedReport(bbl: string): Promise<ViolationReport> {
  try {
    return await cacheCompleteOnly(bbl);
  } catch (err) {
    const carried = partialReportOf(err);
    if (carried === undefined) throw err;
    // `null` means the marker survived but the report it carried did not.
    // Regenerating costs a second round of API calls, but only during an
    // outage, and only if the error ever stops arriving intact.
    return carried ?? (await generateReport(bbl));
  }
}

/** Merges PLUTO property metadata into an already-generated report. */
export function withProperty(
  report: ViolationReport,
  property: Partial<PropertyRef> | null,
): ViolationReport {
  if (!property) return report;
  return { ...report, property: { ...report.property, ...property } };
}

export { cleanBin };
