import { sitemapChunks } from "@/lib/nyc/seo-summary";
import { SITE_URL } from "@/lib/site";

/**
 * Sitemap index over the `/sitemap/{id}.xml` files.
 *
 * Next's `generateSitemaps` emits the individual sitemaps but no index tying
 * them together, and it takes over `/sitemap.xml` in the process — so without
 * this there is no single URL to hand a crawler, and robots.txt would point at
 * a 404. This is the URL to submit to Search Console.
 */

export const revalidate = 86400;

export async function GET() {
  const chunks = await sitemapChunks();
  // Mirrors generateSitemaps(): id 0 is the statics sitemap, then one per chunk.
  const ids = [0, ...chunks.map((_, i) => i + 1)];

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...ids.map(
      (id) => `<sitemap><loc>${SITE_URL}/sitemap/${id}.xml</loc></sitemap>`,
    ),
    "</sitemapindex>",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=0, s-maxage=86400",
    },
  });
}
