/**
 * The completeness guard, and the distinction it exists to protect.
 *
 * Reports are served from a one-hour cache. A report generated while an agency
 * was down looks identical to a report on a clean building — same empty
 * section, same zero in the headline — so caching one would pin "this building
 * is clean" in front of every visitor for an hour. `isReportComplete` is what
 * keeps those two cases apart, and these tests are what keep it honest.
 */

import { describe, expect, it } from "vitest";
import { isReportComplete } from "@/lib/nyc/report";
import type { Agency, ViolationReport } from "@/lib/nyc/types";

function report(unavailableSources: Agency[] = []): ViolationReport {
  return {
    property: {
      bbl: "1000160100",
      boroughCode: "1",
      borough: "Manhattan",
      block: 16,
      lot: 100,
      address: "1 TEST STREET",
      zip: "10004",
      bldgClass: null,
      unitsRes: null,
      isCondoBillingLot: false,
      underlyingBbl: null,
    },
    // Every section empty: the shape both a clean building and a total outage
    // produce. Nothing below distinguishes them except `unavailableSources`.
    sections: (["DOB", "HPD", "ECB", "OATH"] as Agency[]).map((agency) => ({
      agency,
      total: 0,
      open: 0,
      closed: 0,
      balanceDue: 0,
      violations: [],
      truncated: false,
      recoveredByBin: false,
    })),
    summary: {
      totalViolations: 0,
      openViolations: 0,
      totalBalanceDue: 0,
      docketedJudgments: 0,
      distinctBins: [],
      duplicatesRemoved: 0,
    },
    dataAsOf: "2026-08-01T00:00:00.000Z",
    perSourceUpdatedAt: {},
    generatedAt: "2026-08-03T00:00:00.000Z",
    warnings: [],
    unavailableSources,
  };
}

describe("isReportComplete", () => {
  it("treats a genuinely clean building as complete", () => {
    // The case that must not be swept up by the guard: zero violations from
    // four healthy sources is a real answer, and the most cacheable one there
    // is. Conflating it with an outage would disable caching outright.
    expect(isReportComplete(report())).toBe(true);
  });

  it("rejects a report missing any single source", () => {
    for (const agency of ["DOB", "HPD", "ECB", "OATH"] as Agency[]) {
      expect(isReportComplete(report([agency]))).toBe(false);
    }
  });

  it("rejects a report missing several sources", () => {
    expect(isReportComplete(report(["DOB", "ECB"]))).toBe(false);
  });
});
