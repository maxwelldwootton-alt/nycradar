/**
 * Nightly refresh of `property_seo_summaries`, the table behind the public
 * /p/{borough}/{slug} landing pages.
 *
 *   npx tsx scripts/refresh-seo-summaries.ts
 *   npx tsx scripts/refresh-seo-summaries.ts --borough 1 --max-pages 3
 *   npx tsx scripts/refresh-seo-summaries.ts --dry-run
 *
 * ## Why this is a citywide sweep and not a loop over properties
 *
 * The obvious shape — for each of ~858k tax lots, fetch its violations — is
 * ~3.4M Socrata requests per run. Instead each dataset is read once, in
 * document order, and folded into a per-BBL tally. That is a few hundred
 * requests total.
 *
 * DOB and HPD are read as SoQL aggregates (`count(1) ... $group`), which never
 * transfers a single violation row. ECB and OATH have to be read at row level
 * because the two datasets overlap and de-duplicating them needs the per-row
 * summons number — see the dedup note below.
 *
 * ## Consistency with the paid report
 *
 * ~82.6% of ECB summonses reappear in the OATH docket under a ticket number
 * that is the ECB number with a leading zero. `generateReport` folds the
 * duplicate away (`dedupeEcbAgainstOath` in src/lib/nyc/report.ts). If this
 * script skipped that step, a landing page would advertise ~68 violations for
 * a property whose paid report then shows ~54, which reads as a bait and
 * switch. So the same `dedupKey` is applied here, per property.
 */

import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { configureSocrataThrottle, sodaPages, soqlString } from "../src/lib/nyc/socrata";
import {
  BORO_CODE_TO_NAME,
  boroughCodeFromName,
  canonicalBbl,
  dedupKey,
  normalizeBbl,
} from "../src/lib/nyc/bbl";
import { slugifyAddress, SlugAllocator } from "../src/lib/nyc/seo-slug";
import { OATH_PROPERTY_AGENCIES } from "../src/lib/nyc/classify";

/**
 * Mirrors `isNewApiKey` in `@supabase/supabase-js`'s own fetch wrapper (used
 * internally only to special-case Edge Functions — see below).
 */
function isNewFormatKey(key: string): boolean {
  return key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");
}

/**
 * `createClient()` defaults to sending the key as both `apikey` and
 * `Authorization: Bearer <key>` when there's no user session — correct for
 * the legacy JWT-based `service_role` key, but not for the newer non-JWT
 * `sb_secret_...` format: the gateway forwards a request whose Authorization
 * matches apikey down to Postgres, which rejects it outright for not being a
 * JWT (confirmed directly against this project's REST endpoint — apikey alone
 * succeeds, apikey + matching Authorization returns 401 "Invalid API key").
 *
 * supabase-js already has this exact fix, but only wires it into the Edge
 * Functions client (`omitApiKeyAsBearer`) — not the general REST client this
 * script's `.from()` calls go through. This script never authenticates a user
 * session (`persistSession: false`), so `apikey` alone already identifies it
 * as the secret key; stripping the redundant Authorization avoids the
 * conflict. Only applied when the configured key is the new format — a legacy
 * JWT `service_role` key still needs Authorization for role resolution.
 */
function fetchWithoutRedundantAuth(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.delete("Authorization");
  return fetch(input, { ...init, headers });
}

const BOROUGH_SLUGS: Record<string, string> = {
  "1": "manhattan",
  "2": "bronx",
  "3": "brooklyn",
  "4": "queens",
  "5": "staten-island",
};

interface Tally {
  dob: number;
  hpd: number;
  ecbOath: number;
  open: number;
}

interface Options {
  borough: string | null;
  maxPages: number | undefined;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const borough = valueOf(argv, "--borough");
  const maxPages = valueOf(argv, "--max-pages");
  if (borough !== null && !(borough in BOROUGH_SLUGS)) {
    throw new Error(`--borough must be 1-5, got ${borough}`);
  }
  return {
    borough,
    maxPages: maxPages === null ? undefined : Number(maxPages),
    dryRun: argv.includes("--dry-run"),
  };
}

function valueOf(argv: string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  return i === -1 ? null : (argv[i + 1] ?? null);
}

function blank(): Tally {
  return { dob: 0, hpd: 0, ecbOath: 0, open: 0 };
}

function bump(tallies: Map<string, Tally>, bbl: string): Tally {
  let t = tallies.get(bbl);
  if (!t) {
    t = blank();
    tallies.set(bbl, t);
  }
  return t;
}

// ---------------------------------------------------------------------------
// Source sweeps
// ---------------------------------------------------------------------------

/**
 * DOB Violations, as an aggregate over (boro, block, lot, category).
 *
 * DOB pads lot to 5 while every other source pads to 4, so the BBL has to be
 * rebuilt through `canonicalBbl` rather than string-concatenated.
 */
async function sweepDob(
  tallies: Map<string, Tally>,
  opts: Options,
): Promise<number> {
  const where = opts.borough ? `boro=${soqlString(opts.borough)}` : undefined;
  let groups = 0;

  const pages = sodaPages<{
    boro?: string;
    block?: string;
    lot?: string;
    violation_category?: string;
    n?: string;
  }>(
    "dob",
    {
      $select: "boro, block, lot, violation_category, count(1) as n",
      $group: "boro, block, lot, violation_category",
      $order: "boro, block, lot, violation_category",
      ...(where ? { $where: where } : {}),
    },
    { maxPages: opts.maxPages },
  );

  for await (const page of pages) {
    for (const row of page) {
      const bbl = canonicalBbl(row.boro, row.block, row.lot);
      if (!bbl) continue;
      const n = parseInt(row.n ?? "0", 10) || 0;
      if (n === 0) continue;
      const t = bump(tallies, bbl);
      t.dob += n;
      if ((row.violation_category ?? "").toUpperCase().includes("ACTIVE")) {
        t.open += n;
      }
      groups++;
    }
  }
  return groups;
}

/** HPD, as an aggregate over its native canonical `bbl` column. */
async function sweepHpd(
  tallies: Map<string, Tally>,
  opts: Options,
): Promise<number> {
  const clauses = ["bbl IS NOT NULL"];
  if (opts.borough) clauses.push(`starts_with(bbl, ${soqlString(opts.borough)})`);
  let groups = 0;

  const pages = sodaPages<{ bbl?: string; violationstatus?: string; n?: string }>(
    "hpd",
    {
      $select: "bbl, violationstatus, count(1) as n",
      $group: "bbl, violationstatus",
      $order: "bbl, violationstatus",
      $where: clauses.join(" AND "),
    },
    { maxPages: opts.maxPages },
  );

  for await (const page of pages) {
    for (const row of page) {
      const bbl = normalizeBbl(row.bbl);
      if (!bbl) continue;
      const n = parseInt(row.n ?? "0", 10) || 0;
      if (n === 0) continue;
      const t = bump(tallies, bbl);
      t.hpd += n;
      if ((row.violationstatus ?? "").toUpperCase() === "OPEN") t.open += n;
      groups++;
    }
  }
  return groups;
}

/**
 * ECB at row level, recording each property's summons numbers so the OATH
 * sweep can recognise the duplicates.
 */
async function sweepEcb(
  tallies: Map<string, Tally>,
  opts: Options,
): Promise<{ rows: number; keys: Map<string, Set<string>> }> {
  const keysByBbl = new Map<string, Set<string>>();
  const where = opts.borough ? `boro=${soqlString(opts.borough)}` : undefined;
  let rows = 0;

  const pages = sodaPages<{
    boro?: string;
    block?: string;
    lot?: string;
    ecb_violation_status?: string;
    ecb_violation_number?: string;
  }>(
    "ecb",
    {
      $select: "boro, block, lot, ecb_violation_status, ecb_violation_number",
      $order: "ecb_violation_number",
      ...(where ? { $where: where } : {}),
    },
    { maxPages: opts.maxPages },
  );

  for await (const page of pages) {
    for (const row of page) {
      const bbl = canonicalBbl(row.boro, row.block, row.lot);
      if (!bbl) continue;
      const t = bump(tallies, bbl);
      t.ecbOath += 1;
      if ((row.ecb_violation_status ?? "").toUpperCase() === "ACTIVE") t.open += 1;

      const key = dedupKey(row.ecb_violation_number);
      if (key) {
        let set = keysByBbl.get(bbl);
        if (!set) {
          set = new Set();
          keysByBbl.set(bbl, set);
        }
        set.add(key);
      }
      rows++;
    }
  }
  return { rows, keys: keysByBbl };
}

/**
 * OATH at row level, skipping any summons already counted from ECB.
 *
 * OATH keys the borough by name and carries no BBL, so the property key is
 * rebuilt from (borough name, block, lot). Unfiltered this dataset is ~21.9M
 * rows of mostly street- and vehicle-attached tickets with no property to key
 * on, hence the issuing-agency filter.
 */
async function sweepOath(
  tallies: Map<string, Tally>,
  ecbKeys: Map<string, Set<string>>,
  opts: Options,
): Promise<{ rows: number; deduped: number }> {
  const clauses = [
    `issuing_agency in(${OATH_PROPERTY_AGENCIES.map((a) => soqlString(a)).join(", ")})`,
  ];
  if (opts.borough) {
    const name = BORO_CODE_TO_NAME[opts.borough];
    clauses.push(`violation_location_borough=${soqlString(name)}`);
  }

  let rows = 0;
  let deduped = 0;

  const pages = sodaPages<{
    violation_location_borough?: string;
    violation_location_block_no?: string;
    violation_location_lot_no?: string;
    ticket_number?: string;
    balance_due?: string;
  }>(
    "oath",
    {
      $select:
        "violation_location_borough, violation_location_block_no, violation_location_lot_no, ticket_number, balance_due",
      $where: clauses.join(" AND "),
      $order: "ticket_number",
    },
    { maxPages: opts.maxPages },
  );

  for await (const page of pages) {
    for (const row of page) {
      const boro = row.violation_location_borough
        ? boroughCodeFromName(row.violation_location_borough)
        : null;
      if (!boro) continue;
      const bbl = canonicalBbl(
        boro,
        row.violation_location_block_no,
        row.violation_location_lot_no,
      );
      if (!bbl) continue;

      // Same summons as an ECB row already counted for this property.
      const key = dedupKey(row.ticket_number);
      if (key && ecbKeys.get(bbl)?.has(key)) {
        deduped++;
        continue;
      }

      const t = bump(tallies, bbl);
      t.ecbOath += 1;
      // For an adjudicated summons, "open" means money is still owed — the
      // same rule oath.ts applies when building a report.
      const balance = Number(row.balance_due ?? "0");
      if (Number.isFinite(balance) && balance > 0) t.open += 1;
      rows++;
    }
  }
  return { rows, deduped };
}

// ---------------------------------------------------------------------------
// Property join + slugs
// ---------------------------------------------------------------------------

interface PropertyRow {
  bbl: string;
  borough_code: string;
  address: string | null;
  zip: string | null;
}

async function loadProperties(
  db: SupabaseClient,
  bbls: string[],
): Promise<Map<string, PropertyRow>> {
  const out = new Map<string, PropertyRow>();
  // Chunked rather than one big `in` list: the client encodes these into the
  // query string, and a few hundred thousand BBLs will not fit in a URL.
  const CHUNK = 500;

  for (let i = 0; i < bbls.length; i += CHUNK) {
    const chunk = bbls.slice(i, i + CHUNK);
    const { data, error } = await db
      .from("properties")
      .select("bbl, borough_code, address, zip")
      .in("bbl", chunk);
    if (error) throw new Error(`properties lookup failed: ${error.message}`);
    for (const row of (data ?? []) as PropertyRow[]) out.set(row.bbl, row);
  }
  return out;
}

interface SummaryRow {
  bbl: string;
  slug: string;
  borough_slug: string;
  dob_total: number;
  hpd_total: number;
  ecb_oath_total: number;
  open_violations: number;
  total_violations: number;
  computed_at: string;
}

/**
 * Build the rows to upsert, assigning a unique slug per borough.
 *
 * `properties.address_normalized` is not unique across tax lots, so collisions
 * are real and have to be broken deterministically: BBLs are processed in
 * ascending order so a given property keeps the same slug run over run, and
 * later collisions take a numeric suffix rather than stealing the bare slug.
 */
function buildRows(
  tallies: Map<string, Tally>,
  properties: Map<string, PropertyRow>,
  computedAt: string,
): { rows: SummaryRow[]; skippedNoAddress: number; skippedNoProperty: number } {
  const slugs = new SlugAllocator();
  const rows: SummaryRow[] = [];
  let skippedNoAddress = 0;
  let skippedNoProperty = 0;

  for (const bbl of [...tallies.keys()].sort()) {
    const t = tallies.get(bbl)!;
    const total = t.dob + t.hpd + t.ecbOath;
    if (total === 0) continue;

    const property = properties.get(bbl);
    if (!property) {
      // A violation keyed to a lot PLUTO does not list — a merged or retired
      // lot. There is no address to build a page around.
      skippedNoProperty++;
      continue;
    }
    if (!property.address) {
      skippedNoAddress++;
      continue;
    }

    const boroughSlug = BOROUGH_SLUGS[property.borough_code];
    const base = boroughSlug ? slugifyAddress(property.address, property.zip) : null;
    if (!boroughSlug || !base) {
      skippedNoAddress++;
      continue;
    }

    const slug = slugs.claim(boroughSlug, base);

    rows.push({
      bbl,
      slug,
      borough_slug: boroughSlug,
      dob_total: t.dob,
      hpd_total: t.hpd,
      ecb_oath_total: t.ecbOath,
      // Open is accumulated per source and can only exceed the total if a
      // source double-counted; clamp so the table's check constraints hold.
      open_violations: Math.min(t.open, total),
      total_violations: total,
      computed_at: computedAt,
    });
  }

  return { rows, skippedNoAddress, skippedNoProperty };
}

// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
    );
  }
  // Constructed here rather than via src/lib/supabase/server.ts: that module is
  // marked `server-only`, which throws outside the Next.js runtime.
  const db = createClient(url, serviceKey, {
    auth: { persistSession: false },
    global: isNewFormatKey(serviceKey) ? { fetch: fetchWithoutRedundantAuth } : undefined,
  });

  // Sustained bulk reads, unlike the handful a report page makes. Anonymous
  // Socrata traffic is throttled hard, so pace the sweep.
  configureSocrataThrottle({ maxConcurrency: 2, minIntervalMs: 120 });

  const { data: runRow } = await db
    .from("ingest_runs")
    .insert({ dataset_id: "property_seo_summaries", status: "running" })
    .select("id")
    .maybeSingle();
  const runId = (runRow as { id: number } | null)?.id ?? null;

  const tallies = new Map<string, Tally>();

  try {
    console.log("sweeping DOB…");
    const dobGroups = await sweepDob(tallies, opts);
    console.log(`  ${dobGroups.toLocaleString()} groups, ${tallies.size.toLocaleString()} properties so far`);

    console.log("sweeping HPD…");
    const hpdGroups = await sweepHpd(tallies, opts);
    console.log(`  ${hpdGroups.toLocaleString()} groups, ${tallies.size.toLocaleString()} properties so far`);

    console.log("sweeping ECB…");
    const ecb = await sweepEcb(tallies, opts);
    console.log(`  ${ecb.rows.toLocaleString()} rows, ${tallies.size.toLocaleString()} properties so far`);

    console.log("sweeping OATH…");
    const oath = await sweepOath(tallies, ecb.keys, opts);
    console.log(
      `  ${oath.rows.toLocaleString()} rows kept, ${oath.deduped.toLocaleString()} folded into ECB`,
    );
    ecb.keys.clear();

    console.log(`resolving ${tallies.size.toLocaleString()} properties…`);
    const properties = await loadProperties(db, [...tallies.keys()]);

    const computedAt = new Date().toISOString();
    const { rows, skippedNoAddress, skippedNoProperty } = buildRows(
      tallies,
      properties,
      computedAt,
    );
    console.log(
      `  ${rows.length.toLocaleString()} pages; skipped ${skippedNoProperty.toLocaleString()} not in PLUTO, ${skippedNoAddress.toLocaleString()} without a usable address`,
    );

    if (opts.dryRun) {
      console.log("\n--dry-run: nothing written. Sample:");
      console.table(rows.slice(0, 10));
      return;
    }

    console.log("writing…");
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await db
        .from("property_seo_summaries")
        .upsert(rows.slice(i, i + CHUNK), { onConflict: "bbl" });
      if (error) throw new Error(`upsert failed: ${error.message}`);
    }

    // Properties whose violations have since been cleared should lose their
    // page. Only safe after a complete sweep — a filtered run has not seen
    // most of the city, and would delete pages it simply did not recompute.
    let removed = 0;
    if (!opts.borough && opts.maxPages === undefined) {
      const { data, error } = await db
        .from("property_seo_summaries")
        .delete()
        .lt("computed_at", computedAt)
        .select("bbl");
      if (error) throw new Error(`stale cleanup failed: ${error.message}`);
      removed = (data ?? []).length;
    }

    console.log(`done: ${rows.length.toLocaleString()} upserted, ${removed.toLocaleString()} removed`);

    if (runId !== null) {
      await db
        .from("ingest_runs")
        .update({
          status: "succeeded",
          finished_at: new Date().toISOString(),
          row_count: rows.length,
        })
        .eq("id", runId);
    }
  } catch (err) {
    if (runId !== null) {
      await db
        .from("ingest_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error: String(err).slice(0, 2000),
        })
        .eq("id", runId);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
