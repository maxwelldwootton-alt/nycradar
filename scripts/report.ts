/**
 * Dev CLI: generate a violation report for a BBL.
 *
 *   npx tsx scripts/report.ts 3000017501
 *   npx tsx scripts/report.ts 3000017501 --json
 *
 * This is also the tool for running the PRD's Phase 0 validation reports by
 * hand before the UI exists.
 */

import { generateReport } from "../src/lib/nyc/report";
import { normalizeBbl } from "../src/lib/nyc/bbl";

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const raw = args.find((a) => !a.startsWith("--"));
  if (!raw) {
    console.error("usage: tsx scripts/report.ts <BBL> [--json]");
    process.exit(1);
  }

  const bbl = normalizeBbl(raw);
  if (!bbl) {
    console.error(`Not a valid BBL: ${raw}`);
    process.exit(1);
  }

  const started = Date.now();
  const report = await generateReport(bbl);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const p = report.property;
  console.log(`\nBBL ${p.bbl}  ${p.borough} block ${p.block} lot ${p.lot}`);
  if (p.isCondoBillingLot) console.log("  (condominium billing lot)");
  console.log(`  generated in ${elapsed}s · data as of ${report.dataAsOf ?? "unknown"}`);
  console.log("");

  console.log("  agency   total   open   balance due   matched");
  for (const s of report.sections) {
    console.log(
      `  ${s.agency.padEnd(7)} ${String(s.total).padStart(6)} ${String(s.open).padStart(6)}   ` +
        `${("$" + s.balanceDue.toFixed(2)).padStart(11)}   ${s.recoveredByBin ? "BIN" : "BBL"}`,
    );
  }

  const sum = report.summary;
  console.log("");
  console.log(`  total violations   ${sum.totalViolations}`);
  console.log(`  open               ${sum.openViolations}`);
  console.log(`  balance due        $${sum.totalBalanceDue.toFixed(2)}`);
  console.log(`  docketed judgments ${sum.docketedJudgments}`);
  console.log(`  duplicates removed ${sum.duplicatesRemoved}`);
  console.log(`  distinct buildings ${sum.distinctBins.length}`);

  if (report.warnings.length) {
    console.log("\n  warnings:");
    for (const w of report.warnings) console.log(`   - ${w}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
