/**
 * Live integration tests against NYC Open Data.
 *
 * These assert the specific behaviours the data spike measured, using the same
 * properties. Beyond guarding our own logic they double as a **schema-drift
 * alarm**: if the city renames a column, changes a padding convention, or
 * retires a dataset, these fail loudly rather than the product quietly
 * reporting zero violations.
 *
 *   npm run test:live
 */

import { describe, expect, it } from "vitest";
import { generateReport } from "@/lib/nyc/report";
import * as dobSource from "@/lib/nyc/sources/dob";
import * as ecbSource from "@/lib/nyc/sources/ecb";
import * as oathSource from "@/lib/nyc/sources/oath";

describe("condominium billing lots", () => {
  it("recovers DOB violations filed against the underlying lot (1 John Street)", async () => {
    // The failure this guards: a pure BBL join returns zero DOB violations for
    // a condo, and the report renders as a clean building rather than an error.
    const report = await generateReport("3000017501");

    const dob = report.sections.find((s) => s.agency === "DOB")!;
    expect(dob.total).toBeGreaterThan(0);
    expect(dob.recoveredByBin).toBe(true);
    expect(report.property.underlyingBbl).toBe("3000010002");
    expect(report.warnings.join(" ")).toMatch(/condominium billing lot/i);
  });

  it("recovers DOB violations for 345 St Ann's Avenue", async () => {
    const report = await generateReport("2022687501");

    const dob = report.sections.find((s) => s.agency === "DOB")!;
    expect(dob.total).toBeGreaterThan(0);
    expect(report.property.underlyingBbl).toBe("2022680027");
  });

  it("confirms the BBL-only path genuinely finds nothing without recovery", async () => {
    // Proves the recovery pass is load-bearing, not decorative.
    const report = await generateReport("3000017501", { skipBinRecovery: true });
    const dob = report.sections.find((s) => s.agency === "DOB")!;
    expect(dob.total).toBe(0);
  });
});

describe("ECB / OATH deduplication", () => {
  it("removes duplicate summonses on a heavily-cited property", async () => {
    const report = await generateReport("3013020001");
    expect(report.summary.duplicatesRemoved).toBeGreaterThan(0);
  });

  it("finds overlap only after stripping OATH's leading zero", async () => {
    // The spike measured 82.6% overlap. Exact string matching finds none of
    // it, which is why the duplication is invisible without normalization.
    const bbl = "3013020001";
    const [ecbRes, oathRes] = await Promise.all([
      ecbSource.fetchByBbl(bbl),
      oathSource.fetchByBbl(bbl),
    ]);

    const ecbNums = ecbRes.rows
      .map((r) => r.ecb_violation_number?.trim())
      .filter(Boolean) as string[];
    const oathExact = new Set(
      oathRes.rows.map((r) => r.ticket_number?.trim()).filter(Boolean) as string[],
    );
    const oathStripped = new Set([...oathExact].map((t) => t.replace(/^0+/, "")));

    const exactHits = ecbNums.filter((n) => oathExact.has(n)).length;
    const strippedHits = ecbNums.filter((n) => oathStripped.has(n.replace(/^0+/, ""))).length;

    expect(ecbNums.length).toBeGreaterThan(0);
    expect(exactHits).toBe(0);
    expect(strippedHits / ecbNums.length).toBeGreaterThan(0.5);
  });
});

describe("cross-source join", () => {
  // A sample of the spike's test set, spanning boroughs and building types.
  const lots = [
    { bbl: "1000530006", label: "109 Washington St, Manhattan" },
    { bbl: "2026100012", label: "530 E 169 St, Bronx" },
    { bbl: "3013020001", label: "1720 Bedford Ave, Brooklyn" },
    { bbl: "4000260003", label: "45-42 Vernon Blvd, Queens" },
    { bbl: "5029220150", label: "225 Park Hill Ave, Staten Island" },
  ];

  it.each(lots)("joins all four sources for $label", async ({ bbl }) => {
    const report = await generateReport(bbl);
    for (const section of report.sections) {
      expect(section.total).toBeGreaterThan(0);
    }
    expect(report.dataAsOf).toBeTruthy();
  });

  it("reports section totals that sum to the summary", async () => {
    const report = await generateReport("3013020001");
    const summed = report.sections.reduce((s, x) => s + x.total, 0);
    expect(report.summary.totalViolations).toBe(summed);
  });

  it("generates a report within the 60 second requirement", async () => {
    // FR2 / NFR performance budget, measured against a large property.
    const started = Date.now();
    await generateReport("2051410120");
    expect(Date.now() - started).toBeLessThan(60_000);
  });
});

describe("source key conventions", () => {
  it("DOB pads lot to five characters", async () => {
    // If DOB ever switches to 4-wide padding this returns nothing and the
    // product would silently under-report. Fail loudly instead.
    const res = await dobSource.fetchByBbl("3013020001");
    expect(res.rows.length).toBeGreaterThan(0);
  });

  it("ECB pads lot to four characters", async () => {
    const res = await ecbSource.fetchByBbl("3013020001");
    expect(res.rows.length).toBeGreaterThan(0);
  });

  it("OATH keys on borough name with 4-wide lot", async () => {
    const res = await oathSource.fetchByBbl("3013020001");
    expect(res.rows.length).toBeGreaterThan(0);
  });
});
