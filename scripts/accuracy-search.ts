/**
 * Pre-launch accuracy measurement: address → BBL resolution.
 *
 *   npm run accuracy:search -- --sample 400
 *   npm run accuracy:search -- --sample 1000 --out reports/search.json
 *
 * spike/FINDINGS.md §6 left this as the product's one unmeasured term:
 *
 *   > Real end-to-end accuracy will be **this join's accuracy × the geocoder's
 *   > accuracy**, and the second term is still unmeasured.
 *
 * The join is now measured by `accuracy-join.ts`. This measures the other
 * factor. It matters more than the join does, because a join miss shows up as a
 * thin report while a resolver miss shows up as a *confident, complete report
 * about the wrong building* — and the user has no way to tell.
 *
 * ## Method, and its limits
 *
 * Ground truth is PLUTO itself: sample lots, take each one's own address, and
 * check whether search returns that lot. Feeding back a source's own strings
 * would be circular and flattering, so each address is also run through
 * perturbations that stand in for how people actually type — expanded street
 * types, no suffix, an apartment number stapled on, ordinal forms.
 *
 * Two honest caveats that belong on any number this prints:
 *
 *   1. PLUTO stores one primary address per lot. A building with a colloquial
 *      or corner alias ("30 Rock", "1 Penn Plaza") is *correctly* found under a
 *      name this test never tries, so this understates real-world reach.
 *   2. Perturbations are a model of user input, not a sample of it. Replace
 *      them with real queries from the search logs as soon as there are any.
 *
 * The headline number is not the hit rate. It is **confidently wrong**: how
 * often the top result is labelled `exact` and is the wrong lot. Those are the
 * ones that become a report about somebody else's building.
 *
 * `--input <file>` skips the Supabase sampling call and reads a pre-fetched
 * JSON array of `{bbl, address, borough_code}` instead — useful to reuse the
 * exact sample `accuracy-join.ts --input` was run against, for an
 * apples-to-apples comparison, and it's the only way to run this script
 * somewhere that can't reach the project's Supabase host: unlike the join
 * measurement, every probe here is itself a live call to
 * `search_properties_smart` over PostgREST, so `--input` only removes the
 * initial sampling call, not the network dependency this script has
 * throughout. Get the sample with:
 *
 *   select bbl, address, borough_code from sample_properties(400);
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "dotenv";
import { searchProperties } from "../src/lib/nyc/property";
import { supabaseService } from "../src/lib/supabase/server";

config({ path: ".env.local", quiet: true });

const EXPANSIONS: Record<string, string> = {
  ST: "STREET",
  AVE: "AVENUE",
  BLVD: "BOULEVARD",
  PL: "PLACE",
  RD: "ROAD",
  DR: "DRIVE",
  CT: "COURT",
  LN: "LANE",
  TER: "TERRACE",
  PKWY: "PARKWAY",
  PLZ: "PLAZA",
  SQ: "SQUARE",
};

const SUFFIXES = new Set([...Object.keys(EXPANSIONS), ...Object.values(EXPANSIONS)]);

type Variant =
  | "verbatim"
  | "expanded"
  | "lowercase"
  | "no_suffix"
  | "with_unit"
  | "ordinal";

/** Returns null when a variant doesn't apply to a given address. */
function perturb(address: string, variant: Variant): string | null {
  const words = address.trim().split(/\s+/);
  if (words.length < 2) return null;

  switch (variant) {
    case "verbatim":
      return address;

    case "expanded": {
      const out = words.map((w) => EXPANSIONS[w.toUpperCase()] ?? w);
      const changed = out.some((w, i) => w !== words[i]);
      return changed ? out.join(" ") : null;
    }

    case "lowercase":
      return address.toLowerCase();

    case "no_suffix": {
      const last = words[words.length - 1].toUpperCase();
      if (!SUFFIXES.has(last) || words.length < 3) return null;
      return words.slice(0, -1).join(" ");
    }

    case "with_unit":
      // Users paste what's on the contract, which usually carries the unit.
      return `${address} Apt 4B`;

    case "ordinal": {
      // PLUTO writes "5 AVENUE"; people type "5th Ave".
      const out = words.map((w, i) => {
        if (i === 0) return w; // the house number, not a street name
        const n = Number(w);
        if (!Number.isInteger(n) || n < 1 || n > 200) return w;
        const suffix =
          n % 100 >= 11 && n % 100 <= 13
            ? "th"
            : n % 10 === 1
              ? "st"
              : n % 10 === 2
                ? "nd"
                : n % 10 === 3
                  ? "rd"
                  : "th";
        return `${n}${suffix}`;
      });
      return out.some((w, i) => w !== words[i]) ? out.join(" ") : null;
    }
  }
}

const VARIANTS: Variant[] = [
  "verbatim",
  "expanded",
  "lowercase",
  "no_suffix",
  "with_unit",
  "ordinal",
];

interface Probe {
  bbl: string;
  boroughCode: string;
  variant: Variant;
  query: string;
  /** Rank of the true BBL in the results, or -1 if absent. */
  rank: number;
  topBbl: string | null;
  topMatchType: string | null;
  resultCount: number;
  error?: string;
}

async function runProbe(
  truth: { bbl: string; address: string; borough_code: string },
  variant: Variant,
  withBorough: boolean,
): Promise<Probe | null> {
  const query = perturb(truth.address, variant);
  if (!query) return null;

  const probe: Probe = {
    bbl: truth.bbl,
    boroughCode: truth.borough_code,
    variant,
    query,
    rank: -1,
    topBbl: null,
    topMatchType: null,
    resultCount: 0,
  };

  try {
    const results = await searchProperties(query, {
      // Without the borough the query is genuinely ambiguous — the same house
      // number and street name recur across boroughs — which is exactly why the
      // UI has a borough selector. Measured both ways; see the summary.
      borough: withBorough ? truth.borough_code : null,
      limit: 10,
    });
    probe.resultCount = results.length;
    probe.rank = results.findIndex((r) => r.bbl === truth.bbl);
    probe.topBbl = results[0]?.bbl ?? null;
    probe.topMatchType = results[0]?.matchType ?? null;
  } catch (err) {
    probe.error = err instanceof Error ? err.message : String(err);
  }

  return probe;
}

function percent(n: number, d: number): string {
  return d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`;
}

function summarize(label: string, probes: Probe[]) {
  const usable = probes.filter((p) => !p.error);
  const top1 = usable.filter((p) => p.rank === 0);
  const top5 = usable.filter((p) => p.rank >= 0 && p.rank < 5);
  const missed = usable.filter((p) => p.rank === -1);
  const empty = usable.filter((p) => p.resultCount === 0);

  // The number that matters. A wrong answer the UI labels `nearby` is a
  // hedged answer the user can second-guess; a wrong answer labelled `exact`
  // is the product asserting something false.
  const confidentlyWrong = usable.filter(
    (p) => p.rank !== 0 && p.topMatchType === "exact" && p.topBbl !== null,
  );

  console.log(`\n${label}  (${usable.length} probes)`);
  console.log(`  correct at rank 1     ${top1.length.toString().padStart(5)}  ${percent(top1.length, usable.length)}`);
  console.log(`  correct in top 5      ${top5.length.toString().padStart(5)}  ${percent(top5.length, usable.length)}`);
  console.log(`  not returned at all   ${missed.length.toString().padStart(5)}  ${percent(missed.length, usable.length)}`);
  console.log(`  zero results          ${empty.length.toString().padStart(5)}  ${percent(empty.length, usable.length)}`);
  console.log(
    `  CONFIDENTLY WRONG     ${confidentlyWrong.length.toString().padStart(5)}  ${percent(confidentlyWrong.length, usable.length)}` +
      `   ← top hit labelled "exact" but wrong lot`,
  );

  const byVariant = new Map<Variant, Probe[]>();
  for (const p of usable) {
    const list = byVariant.get(p.variant) ?? [];
    list.push(p);
    byVariant.set(p.variant, list);
  }
  console.log("\n    variant        probes   rank-1   confidently wrong");
  for (const variant of VARIANTS) {
    const list = byVariant.get(variant) ?? [];
    if (list.length === 0) continue;
    const hits = list.filter((p) => p.rank === 0).length;
    const wrong = list.filter(
      (p) => p.rank !== 0 && p.topMatchType === "exact" && p.topBbl !== null,
    ).length;
    console.log(
      `    ${variant.padEnd(14)} ${String(list.length).padStart(6)}   ` +
        `${percent(hits, list.length).padStart(6)}   ${percent(wrong, list.length).padStart(17)}`,
    );
  }

  return { usable: usable.length, top1: top1.length, confidentlyWrong: confidentlyWrong.length };
}

async function main() {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const sample = Number(get("--sample") ?? 400);
  const out = get("--out") ?? null;
  const input = get("--input") ?? null;

  let raw: { bbl: string; address: string | null; borough_code: string }[];
  if (input) {
    console.log(`Reading sample from ${input}…`);
    raw = JSON.parse(readFileSync(input, "utf8"));
  } else {
    console.log(`Sampling ${sample} tax lots…`);
    const { data, error } = await supabaseService().rpc("sample_properties", {
      p_count: sample,
    });
    if (error) throw new Error(`sample_properties failed: ${error.message}`);
    raw = (data ?? []) as { bbl: string; address: string | null; borough_code: string }[];
  }

  const lots = raw.filter((l): l is { bbl: string; address: string; borough_code: string } =>
    Boolean(l.address && l.address.trim()),
  );

  if (lots.length === 0) throw new Error("Sample came back empty — is PLUTO loaded?");
  console.log(`${lots.length} of them have an address. Probing…\n`);

  const withBorough: Probe[] = [];
  const withoutBorough: Probe[] = [];

  let done = 0;
  for (const lot of lots) {
    for (const variant of VARIANTS) {
      const a = await runProbe(lot, variant, true);
      if (a) withBorough.push(a);
      const b = await runProbe(lot, variant, false);
      if (b) withoutBorough.push(b);
    }
    if (++done % 25 === 0 || done === lots.length) {
      process.stdout.write(`\r  ${done}/${lots.length} lots`);
    }
  }
  console.log("\n");

  const scoped = summarize("With borough (what the UI sends when one is picked)", withBorough);
  summarize("Without borough (a bare address, all five boroughs in scope)", withoutBorough);

  const errors = [...withBorough, ...withoutBorough].filter((p) => p.error);
  if (errors.length > 0) {
    console.log(`\n  ${errors.length} probes errored. First: ${errors[0].error}`);
  }

  console.log(
    "\nRead these together with the join numbers: end-to-end accuracy is the\n" +
      "product of the two, not either one alone.",
  );
  if (scoped.confidentlyWrong > 0) {
    console.log(
      `\n⚠ ${scoped.confidentlyWrong} probe(s) returned a wrong lot labelled "exact".\n` +
        "  Each one is a report about the wrong building that reads as certain.\n" +
        "  Inspect them in the --out file before launch.",
    );
  }

  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(
      out,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), sample: lots.length, withBorough, withoutBorough },
        null,
        2,
      ),
    );
    console.log(`\nFull per-probe results written to ${out}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
