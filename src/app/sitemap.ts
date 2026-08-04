import type { MetadataRoute } from "next";
import { GUIDES } from "@/lib/guides";
import {
  BOROUGH_SLUGS,
  SITEMAP_CHUNK_SIZE,
  listBoroughSlugs,
  sitemapChunks,
} from "@/lib/nyc/seo-summary";
import { SITE_URL } from "@/lib/site";

// Sitemaps are crawled periodically, not per-visitor.
export const revalidate = 86400;

/**
 * Emits `/sitemap/{id}.xml`. Id 0 is the static pages and the guides; every id
 * after that is one chunk of one borough's property pages, per
 * `sitemapChunks()`.
 *
 * The index tying these together is `/sitemap-index.xml` — Next does not
 * generate one for `generateSitemaps`, and that index is what robots.txt
 * points crawlers at.
 */
export async function generateSitemaps(): Promise<{ id: number }[]> {
  const list = await sitemapChunks();
  // Always at least the statics sitemap, even before the refresh has ever run.
  return [{ id: 0 }, ...list.map((_, i) => ({ id: i + 1 }))];
}

export default async function sitemap({
  id,
}: {
  // Next 16 hands this over as a Promise of the route segment — a *string* —
  // even though the documented type is a plain number. Comparing the raw value
  // against 0 silently matched nothing and emitted an empty sitemap, so it is
  // awaited and parsed rather than trusted. `await` on a non-promise returns
  // the value unchanged, so this holds either way.
  id: Promise<string | number> | string | number;
}): Promise<MetadataRoute.Sitemap> {
  const index = parseInt(String(await id), 10);
  if (!Number.isFinite(index)) return [];

  if (index === 0) {
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
      ...BOROUGH_SLUGS.map((borough) => ({
        url: `${SITE_URL}/p/${borough}`,
        changeFrequency: "daily" as const,
        priority: 0.7,
      })),
    ];
  }

  const chunk = (await sitemapChunks())[index - 1];
  if (!chunk) return [];

  // Property URLs are the slug pages now; the old `/property/{bbl}` seeding
  // from the `lookups` table is gone with the route, which 301s to these.
  const rows = await listBoroughSlugs(chunk.borough, {
    limit: SITEMAP_CHUNK_SIZE,
    offset: chunk.offset,
  });

  return rows.map((row) => ({
    url: `${SITE_URL}/p/${chunk.borough}/${row.slug}`,
    lastModified: new Date(row.computedAt),
    changeFrequency: "weekly" as const,
    priority: 0.4,
  }));
}
