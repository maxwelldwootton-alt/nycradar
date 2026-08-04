import type { MetadataRoute } from "next";
import { GUIDES } from "@/lib/guides";
import { supabaseService, hasServiceRole } from "@/lib/supabase/server";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://nycradar.vercel.app";

// Sitemaps get crawled periodically, not per-visitor — cache to avoid a
// Supabase round trip on every crawl.
export const revalidate = 3600;

/**
 * BBLs people have actually looked up, most recent first.
 *
 * `/property/[bbl]` pages exist for any of NYC's ~850K tax lots (see that
 * route's on-demand ISR comment), so pre-listing all of them here isn't
 * feasible or useful. Seeding the sitemap from real lookups instead gives
 * crawlers a growing, relevance-weighted entry point without a bulk-generation
 * step. Best-effort: an unconfigured Supabase service role or a query failure
 * just means fewer property URLs in the sitemap, not a broken build.
 */
async function recentPropertyBbls(limit = 500): Promise<string[]> {
  if (!hasServiceRole()) return [];
  try {
    const { data, error } = await supabaseService()
      .from("lookups")
      .select("bbl")
      .order("created_at", { ascending: false })
      .limit(limit * 3);
    if (error || !data) return [];

    const seen = new Set<string>();
    for (const row of data as { bbl: string }[]) {
      seen.add(row.bbl);
      if (seen.size >= limit) break;
    }
    return [...seen];
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const bbls = await recentPropertyBbls();

  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/guides`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    ...GUIDES.map((guide) => ({
      url: `${SITE_URL}/guides/${guide.slug}`,
      lastModified: new Date(guide.updated),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    // Low priority but present: buyers and payment processors both expect to
    // be able to find these, and an unlisted policy page reads as an absent one.
    {
      url: `${SITE_URL}/terms`,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: `${SITE_URL}/privacy`,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    ...bbls.map((bbl) => ({
      url: `${SITE_URL}/property/${bbl}`,
      changeFrequency: "weekly" as const,
      priority: 0.4,
    })),
  ];
}
