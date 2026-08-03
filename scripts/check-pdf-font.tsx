/**
 * Asserts the PDF actually embeds Geist rather than silently falling back.
 *
 * The route at /report/[bbl]/pdf is gated by `resolveAccess` and 402s without a
 * Supabase service role, so it can't be exercised locally. This renders the
 * document directly, which isolates the font wiring from the entitlement layer.
 *
 * A missed `Font.register` does not throw — react-pdf just draws Helvetica — so
 * this checks the produced bytes rather than trusting the render to succeed.
 *
 *   npx tsx scripts/check-pdf-font.tsx
 */

import { renderToBuffer } from "@react-pdf/renderer";
import { ReportDocument } from "../src/lib/pdf/ReportDocument";
import { registerPdfFonts } from "../src/lib/pdf/fonts";
import type { NormalizedViolation, ViolationReport } from "../src/lib/nyc/types";

function violation(over: Partial<NormalizedViolation> = {}): NormalizedViolation {
  return {
    agency: "HPD",
    sourceDataset: "fixture",
    sourceId: "1",
    dedupKey: null,
    bbl: "3000017501",
    bin: null,
    issuedDate: "2024-01-15",
    status: "open",
    rawStatus: "OPEN",
    severity: "C",
    description: "Fixture — repair the broken plaster · $1,234.56 due",
    balanceDue: 1234.56,
    penaltyImposed: null,
    judgmentDocketed: "2024-06-01",
    issuingAgency: null,
    correctionType: "physical",
    matchedBy: "bbl",
    raw: {},
    ...over,
  };
}

const report: ViolationReport = {
  property: {
    bbl: "3000017501",
    boroughCode: "3",
    borough: "Brooklyn",
    block: 1,
    lot: 7501,
    address: "1 John Street",
    zip: "11201",
    bldgClass: null,
    unitsRes: 42,
    isCondoBillingLot: true,
    underlyingBbl: "3000010002",
  },
  sections: [
    {
      agency: "HPD",
      total: 2,
      open: 1,
      closed: 1,
      balanceDue: 1234.56,
      violations: [violation(), violation({ sourceId: "2", status: "closed", severity: "A" })],
      truncated: false,
      recoveredByBin: false,
    },
  ],
  summary: {
    totalViolations: 2,
    openViolations: 1,
    totalBalanceDue: 1234.56,
    docketedJudgments: 1,
    distinctBins: [],
    duplicatesRemoved: 0,
  },
  dataAsOf: "2026-08-02T00:00:00.000Z",
  perSourceUpdatedAt: {},
  generatedAt: "2026-08-03T00:00:00.000Z",
  warnings: ["Fixture warning line."],
};

async function main() {
  registerPdfFonts();
  const buffer = await renderToBuffer(<ReportDocument report={report} />);
  const bytes = buffer.toString("latin1");

  const embedsGeist = /Geist/.test(bytes);
  const usesHelvetica = /Helvetica/.test(bytes);

  console.log(`bytes:        ${buffer.length.toLocaleString()}`);
  console.log(`embeds Geist: ${embedsGeist}`);
  console.log(`uses Helvetica: ${usesHelvetica}`);

  if (!embedsGeist || usesHelvetica) {
    console.error("\nFAIL: expected Geist embedded and no Helvetica fallback.");
    process.exit(1);
  }
  console.log("\nOK: PDF embeds Geist.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
