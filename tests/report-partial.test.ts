/**
 * What happens to a report when one city API is down.
 *
 * Two behaviours are load-bearing and neither is obvious from reading
 * `getCachedReport` alone:
 *
 *   1. One agency failing must not fail the report. Three agencies' worth of
 *      violations is worth showing; a 500 is not.
 *   2. The partial report must reach the caller *without* being cached. The
 *      only way to keep a value out of `unstable_cache` is to reject out of it,
 *      so the partial report is thrown and caught — and a bug in that recovery
 *      would surface as a hard error on every outage.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Pass-through: the real one needs a Next request scope. What matters here is
// that a rejection propagates to the caller, which a pass-through preserves.
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

vi.mock("@/lib/nyc/socrata", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nyc/socrata")>()),
  datasetUpdatedAt: vi.fn(async () => "2026-08-01T00:00:00.000Z"),
}));

const empty = { rows: [], truncated: false };
const zeroCounts = { total: 0, open: 0, closed: 0 };

const dobFetch = vi.fn(async () => empty);
const hpdFetch = vi.fn(async () => empty);
const ecbFetch = vi.fn(async () => empty);
const oathFetch = vi.fn(async () => empty);

vi.mock("@/lib/nyc/sources/dob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nyc/sources/dob")>()),
  fetchByBbl: (...args: unknown[]) => dobFetch(...(args as [])),
}));
vi.mock("@/lib/nyc/sources/hpd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nyc/sources/hpd")>()),
  fetchByBbl: (...args: unknown[]) => hpdFetch(...(args as [])),
  countsByBbl: async () => zeroCounts,
}));
vi.mock("@/lib/nyc/sources/ecb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nyc/sources/ecb")>()),
  fetchByBbl: (...args: unknown[]) => ecbFetch(...(args as [])),
}));
vi.mock("@/lib/nyc/sources/oath", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nyc/sources/oath")>()),
  fetchByBbl: (...args: unknown[]) => oathFetch(...(args as [])),
}));

const BBL = "1000160100";

describe("getCachedReport with a failing source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of [dobFetch, hpdFetch, ecbFetch, oathFetch]) {
      fn.mockResolvedValue(empty);
    }
    // The failure path logs; silence it so a passing run stays readable.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("resolves rather than rejecting, and names the missing agency", async () => {
    const { getCachedReport } = await import("@/lib/nyc/report");
    dobFetch.mockRejectedValue(new Error("socrata 503"));

    const report = await getCachedReport(BBL);

    expect(report.unavailableSources).toEqual(["DOB"]);
    expect(report.property.bbl).toBe(BBL);
  });

  it("marks a report with every source healthy as complete", async () => {
    const { getCachedReport, isReportComplete } = await import("@/lib/nyc/report");

    const report = await getCachedReport(BBL);

    expect(report.unavailableSources).toEqual([]);
    expect(isReportComplete(report)).toBe(true);
  });

  it("reports missing agencies in a stable order regardless of failure order", async () => {
    const { getCachedReport } = await import("@/lib/nyc/report");
    oathFetch.mockRejectedValue(new Error("down"));
    dobFetch.mockRejectedValue(new Error("down"));

    const report = await getCachedReport(BBL);

    expect(report.unavailableSources).toEqual(["DOB", "OATH"]);
  });
});
