/**
 * Pre-launch accuracy measurement: the cross-source join, at scale.
 *
 *   npm run accuracy:join -- --sample 500
 *   npm run accuracy:join -- --sample 2000 --concurrency 3 --out reports/join.json
 *
 * PLAN.md §8 lists this as a launch gate and spike/FINDINGS.md §8 explains why:
 * the spike measured 27 lots, deliberately skewed toward heavily-cited
 * properties. That is enough to prove the join mechanism works and to surface
 * systematic failure modes. It is not enough to put a number on the citywide
 * match rate, and the number quoted to a customer should be one that was
 * actually measured on a representative sample.
 *
 * What this reports, and why each one is here:
 *
 *   - **Per-source coverage** — of lots where a source holds anything, how
 *     often did we get it. This is the headline match rate.
 *   - **BIN-recovery lift** — the same run with recovery disabled, on the
 *     subset that used it. Rule 3 exists because condo billing lots silently
 *     return zero DOB violations; this quantifies how much it is still buying.
 *   - **Dedup volume** — ECB/OATH duplicates removed. If this ever trends to
 *     zero, the leading-zero join key has drifted and both the counts and the
 *     dollar totals are about to double.
 *   - **Failure rate** — lots where a source errored rather than returned
 *     empty. A report that renders "no violations" because an API timed out is
 *     the failure mode this product cannot have.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY (for sampling) and, in practice,
 * SOCRATA_APP_TOKEN — a few thousand lots is a lot of anonymous SODA calls.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "dotenv";
import { generateReport } from "../src/lib/nyc/report";
import { supabaseService } from "../src/lib/supabase/server";
import type { Agency, ViolationReport } from "../src/lib/nyc/types";

config({ path: ".env.local", quiet: true });

const AGENCIES: Agency[] = ["DOB", "HPD", "ECB", "OATH"];

interface Options {
  sample: number;
  concurrency: number;
  out: string | null;
  measureRecoveryLift: boolean;
}

function parseArgs(argv: string[]): Options {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    sample: Number(get("--sample") ?? 500),
    // Low by default and deliberately so: each lot is ~6 SODA calls, and the
    // point of this script is to measure the join, not to get the app's IP
    // throttled by NYC Open Data on the day before launch.
    concurrency: Number(get("--concurrency") ?? 4),
    out: get("--out") ?? null,
    measureRecoveryLift: !argv.includes("--no-recovery-lift"),
  };
}

interface LotResult {
  bbl: string;
  isCondoBillingLot: boolean;
  ok: boolean;
  error?: string;
  /** Per agency: how many records came back, and how they were matched. */
  perAgency: Record<Agency, { total: number; recoveredByBin: boolean }>;
  duplicatesRemoved: number;
  distinctBins: number;
  elapsedMs: number;
  /** Only populated for lots that used BIN recovery — see `measureRecoveryLift`. */
  withoutRecovery?: Record<Agency, number>;
}

async function measureLot(
  bbl: string,
  lot: number,
  opts: Options,
): Promise<LotResult> {
  const started = Date.now();
  const base: LotResult = {
    bbl,
    isCondoBillingLot: lot >= 7501,
    ok: false,
    perAgency: {
      DOB: { total: 0, recoveredByBin: false },
      HPD: { total: 0, recoveredByBin: false },
      ECB: { total: 0, recoveredByBin: false },
      OATH: { total: 0, recoveredByBin: false },
    },
    duplicatesRemoved: 0,
    distinctBins: 0,
    elapsedMs: 0,
  };

  let report: ViolationReport;
  try {
    report = await generateReport(bbl);
  } catch (err) {
    base.error = err instanceof Error ? err.message : String(err);
    base.elapsedMs = Date.now() - started;
    return base;
  }

  for (const section of report.sections) {
    base.perAgency[section.agency] = {
      total: section.total,
      recoveredByBin: section.recoveredByBin,
    };
  }
  base.duplicatesRemoved = report.summary.duplicatesRemoved;
  base.distinctBins = report.summary.distinctBins.length;
  base.ok = true;

  // Only re-run the lots where recovery actually fired. Running it on every lot
  // would double the SODA load to learn nothing about the ~95% that never
  // needed it.
  const usedRecovery = report.sections.some((s) => s.recoveredByBin);
  if (opts.measureRecoveryLift && usedRecovery) {
    try {
      const plain = await generateReport(bbl, { skipBinRecovery: true });
      base.withoutRecovery = {
        DOB: 0,
        HPD: 0,
        ECB: 0,
        OATH: 0,
      };
      for (const section of plain.sections) {
        base.withoutRecovery[section.agency] = section.total;
      }
    } catch {
      // A failed control run is not worth failing the measured run over.
    }
  }

  base.elapsedMs = Date.now() - started;
  return base;
}

/** Bounded-concurrency map. A pool rather than chunked batches so one slow lot doesn't stall the run. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
      onProgress?.(++done, items.length);
    }
  });

  await Promise.all(workers);
  return results;
}

function percent(n: number, d: number): string {
  if (d === 0) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  console.log(`Sampling ${opts.sample} tax lots…`);
  const { data, error } = await supabaseService().rpc("sample_properties", {
    p_count: opts.sample,
  });
  if (error) throw new Error(`sample_properties failed: ${error.message}`);

  const lots = (data ?? []) as { bbl: string; lot: number }[];
  if (lots.length === 0) throw new Error("Sample came back empty — is PLUTO loaded?");

  console.log(
    `Running ${lots.length} reports at concurrency ${opts.concurrency}. ` +
      `This is roughly ${lots.length * 6} SODA calls.\n`,
  );

  const started = Date.now();
  const results = await mapPool(
    lots,
    opts.concurrency,
    (row) => measureLot(row.bbl, row.lot, opts),
    (done, total) => {
      if (done % 25 === 0 || done === total) {
        process.stdout.write(`\r  ${done}/${total} lots`);
      }
    },
  );
  const elapsedS = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`\n\nCompleted in ${elapsedS}s.\n`);

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  console.log(`Lots sampled          ${results.length}`);
  console.log(`  succeeded           ${ok.length} (${percent(ok.length, results.length)})`);
  console.log(`  failed              ${failed.length} (${percent(failed.length, results.length)})`);
  console.log(
    `  condo billing lots  ${ok.filter((r) => r.isCondoBillingLot).length}`,
  );
  console.log(
    `  multi-building lots ${ok.filter((r) => r.distinctBins > 1).length} ` +
      `(${percent(ok.filter((r) => r.distinctBins > 1).length, ok.length)})`,
  );

  console.log("\n  agency   lots with data   share   recovered by BIN");
  for (const agency of AGENCIES) {
    const withData = ok.filter((r) => r.perAgency[agency].total > 0);
    const recovered = ok.filter((r) => r.perAgency[agency].recoveredByBin);
    console.log(
      `  ${agency.padEnd(7)}  ${String(withData.length).padStart(13)}` +
        `   ${percent(withData.length, ok.length).padStart(5)}` +
        `   ${String(recovered.length).padStart(16)}`,
    );
  }

  // The lift number. A lot that only has DOB records *because* of BIN recovery
  // is a lot that would have rendered as a clean building without rule 3.
  const liftMeasured = ok.filter((r) => r.withoutRecovery);
  if (liftMeasured.length > 0) {
    console.log(`\n  BIN recovery (measured on ${liftMeasured.length} lots that used it)`);
    for (const agency of AGENCIES) {
      const rescued = liftMeasured.filter(
        (r) => r.withoutRecovery![agency] === 0 && r.perAgency[agency].total > 0,
      );
      if (rescued.length > 0) {
        console.log(
          `    ${agency.padEnd(5)} ${rescued.length} lots would have reported zero ${agency} violations without it`,
        );
      }
    }
  }

  const totalDupes = ok.reduce((sum, r) => sum + r.duplicatesRemoved, 0);
  const lotsWithDupes = ok.filter((r) => r.duplicatesRemoved > 0).length;
  console.log(
    `\n  ECB/OATH duplicates removed  ${totalDupes} across ${lotsWithDupes} lots ` +
      `(${percent(lotsWithDupes, ok.length)})`,
  );
  if (totalDupes === 0) {
    console.log(
      "  ⚠ Zero duplicates across the whole sample. The spike measured 82.6% overlap,\n" +
        "    so this most likely means the leading-zero dedup key has drifted — not that\n" +
        "    the data changed. Counts and dollar totals are close to doubled if so.",
    );
  }

  const latencies = ok.map((r) => r.elapsedMs).sort((a, b) => a - b);
  if (latencies.length > 0) {
    const at = (q: number) => latencies[Math.floor(latencies.length * q)] ?? 0;
    console.log(
      `\n  Latency  median ${(at(0.5) / 1000).toFixed(1)}s · ` +
        `p95 ${(at(0.95) / 1000).toFixed(1)}s · ` +
        `max ${(latencies[latencies.length - 1] / 1000).toFixed(1)}s`,
    );
  }

  if (failed.length > 0) {
    console.log("\n  Failures:");
    const byMessage = new Map<string, number>();
    for (const f of failed) {
      const key = f.error ?? "unknown";
      byMessage.set(key, (byMessage.get(key) ?? 0) + 1);
    }
    for (const [message, count] of [...byMessage].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(count).padStart(4)}×  ${message.slice(0, 100)}`);
    }
  }

  if (opts.out) {
    mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(
      opts.out,
      JSON.stringify({ generatedAt: new Date().toISOString(), opts, results }, null, 2),
    );
    console.log(`\nFull per-lot results written to ${opts.out}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
