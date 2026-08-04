/**
 * Reads for the public /p/{borough}/{slug} landing pages.
 *
 * Everything here comes from `property_seo_summaries`, written nightly by
 * scripts/refresh-seo-summaries.ts. Deliberately no Socrata call anywhere in
 * this module: these pages exist to be crawled, and a crawler walking tens of
 * thousands of cold properties would miss the report cache every single time
 * and hammer a rate-limited API. Freshness is traded for being crawlable —
 * the paid /report/{bbl} is still generated live.
 */

import "server-only";
import { supabaseAnon, hasAnonConfig } from "@/lib/supabase/server";
import { BORO_CODE_TO_LABEL } from "./bbl";

export const BOROUGH_SLUG_TO_CODE: Record<string, string> = {
  manhattan: "1",
  bronx: "2",
  brooklyn: "3",
  queens: "4",
  "staten-island": "5",
};

export const BOROUGH_SLUGS = Object.keys(BOROUGH_SLUG_TO_CODE);

export function boroughLabel(slug: string): string | null {
  const code = BOROUGH_SLUG_TO_CODE[slug];
  return code ? (BORO_CODE_TO_LABEL[code] ?? null) : null;
}

export interface PropertySummary {
  bbl: string;
  slug: string;
  boroughSlug: string;
  boroughLabel: string;
  dobTotal: number;
  hpdTotal: number;
  ecbOathTotal: number;
  openViolations: number;
  totalViolations: number;
  computedAt: string;
  address: string | null;
  zip: string | null;
  block: number;
  lot: number;
  bldgClass: string | null;
  unitsRes: number | null;
  yearBuilt: number | null;
}

/** Shape Supabase returns for the summary + embedded property join. */
interface SummaryJoinRow {
  bbl: string;
  slug: string;
  borough_slug: string;
  dob_total: number;
  hpd_total: number;
  ecb_oath_total: number;
  open_violations: number;
  total_violations: number;
  computed_at: string;
  properties: {
    address: string | null;
    zip: string | null;
    block: number;
    lot: number;
    bldg_class: string | null;
    units_res: number | null;
    year_built: number | null;
  } | null;
}

const SELECT =
  "bbl, slug, borough_slug, dob_total, hpd_total, ecb_oath_total, open_violations, total_violations, computed_at, properties!inner(address, zip, block, lot, bldg_class, units_res, year_built)";

function toSummary(row: SummaryJoinRow): PropertySummary {
  const p = row.properties;
  return {
    bbl: row.bbl,
    slug: row.slug,
    boroughSlug: row.borough_slug,
    boroughLabel: boroughLabel(row.borough_slug) ?? row.borough_slug,
    dobTotal: row.dob_total,
    hpdTotal: row.hpd_total,
    ecbOathTotal: row.ecb_oath_total,
    openViolations: row.open_violations,
    totalViolations: row.total_violations,
    computedAt: row.computed_at,
    address: p?.address ?? null,
    zip: p?.zip ?? null,
    block: p?.block ?? 0,
    lot: p?.lot ?? 0,
    bldgClass: p?.bldg_class ?? null,
    unitsRes: p?.units_res ?? null,
    yearBuilt: p?.year_built ?? null,
  };
}

export async function getPropertySummary(
  boroughSlug: string,
  slug: string,
): Promise<PropertySummary | null> {
  if (!hasAnonConfig()) return null;
  if (!(boroughSlug in BOROUGH_SLUG_TO_CODE)) return null;

  const { data, error } = await supabaseAnon()
    .from("property_seo_summaries")
    .select(SELECT)
    .eq("borough_slug", boroughSlug)
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) return null;
  return toSummary(data as unknown as SummaryJoinRow);
}

/** Canonical URL for a BBL, used by the /property/{bbl} redirect. */
export async function getSlugForBbl(
  bbl: string,
): Promise<{ boroughSlug: string; slug: string } | null> {
  if (!hasAnonConfig()) return null;

  const { data, error } = await supabaseAnon()
    .from("property_seo_summaries")
    .select("borough_slug, slug")
    .eq("bbl", bbl)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as { borough_slug: string; slug: string };
  return { boroughSlug: row.borough_slug, slug: row.slug };
}

export interface BoroughListing {
  slug: string;
  address: string | null;
  totalViolations: number;
  openViolations: number;
}

/**
 * A page of a borough's properties, worst first.
 *
 * Ordering by violation count is not cosmetic: it front-loads the pages most
 * likely to be worth crawling, and it is the order the covering index
 * (`property_seo_borough_rank_idx`) is built for.
 */
export async function listBoroughProperties(
  boroughSlug: string,
  { page, perPage }: { page: number; perPage: number },
): Promise<{ items: BoroughListing[]; total: number }> {
  if (!hasAnonConfig()) return { items: [], total: 0 };
  if (!(boroughSlug in BOROUGH_SLUG_TO_CODE)) return { items: [], total: 0 };

  const from = (page - 1) * perPage;
  const { data, error, count } = await supabaseAnon()
    .from("property_seo_summaries")
    .select("slug, total_violations, open_violations, properties!inner(address)", {
      count: "estimated",
    })
    .eq("borough_slug", boroughSlug)
    .order("total_violations", { ascending: false })
    .order("bbl", { ascending: true })
    .range(from, from + perPage - 1);

  if (error || !data) return { items: [], total: 0 };

  const items = (data as unknown as {
    slug: string;
    total_violations: number;
    open_violations: number;
    properties: { address: string | null } | null;
  }[]).map((row) => ({
    slug: row.slug,
    address: row.properties?.address ?? null,
    totalViolations: row.total_violations,
    openViolations: row.open_violations,
  }));

  return { items, total: count ?? 0 };
}

/** Slugs for one borough's sitemap chunk. */
export async function listBoroughSlugs(
  boroughSlug: string,
  { limit, offset }: { limit: number; offset: number },
): Promise<{ slug: string; computedAt: string }[]> {
  if (!hasAnonConfig()) return [];

  const { data, error } = await supabaseAnon()
    .from("property_seo_summaries")
    .select("slug, computed_at")
    .eq("borough_slug", boroughSlug)
    .order("total_violations", { ascending: false })
    .order("bbl", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error || !data) return [];
  return (data as { slug: string; computed_at: string }[]).map((r) => ({
    slug: r.slug,
    computedAt: r.computed_at,
  }));
}

/**
 * A sitemap file caps at 50,000 URLs, so property pages are split across
 * several. Well under the cap, since counts shift with every nightly refresh
 * and exceeding it is a hard rejection rather than a truncation.
 */
export const SITEMAP_CHUNK_SIZE = 25_000;

export interface SitemapChunk {
  borough: string;
  offset: number;
}

/**
 * Chunk layout for the property sitemaps, derived from live counts.
 *
 * Shared by `sitemap.ts` (which renders chunk N) and the sitemap index (which
 * lists them). Both must agree on the count and the order or the index will
 * point at sitemaps that do not exist.
 */
export async function sitemapChunks(): Promise<SitemapChunk[]> {
  const out: SitemapChunk[] = [];
  for (const borough of BOROUGH_SLUGS) {
    const total = await countBoroughProperties(borough);
    for (let offset = 0; offset < total; offset += SITEMAP_CHUNK_SIZE) {
      out.push({ borough, offset });
    }
  }
  return out;
}

export async function countBoroughProperties(boroughSlug: string): Promise<number> {
  if (!hasAnonConfig()) return 0;

  const { count, error } = await supabaseAnon()
    .from("property_seo_summaries")
    .select("bbl", { count: "estimated", head: true })
    .eq("borough_slug", boroughSlug);
  return error ? 0 : (count ?? 0);
}
