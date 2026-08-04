import { notFound } from "next/navigation";
import { normalizeBbl } from "@/lib/nyc/bbl";
import { getSlugForBbl } from "@/lib/nyc/seo-summary";

/**
 * Legacy redirect.
 *
 * `/property/{bbl}` was the first indexable teaser URL. It carried none of the
 * words anyone searches for, so it has been superseded by the address slug at
 * `/p/{borough}/{address-slug}`. A 301 rather than keeping both alive: two
 * URLs serving the same content split ranking signals, and this one is new
 * enough to have no inbound links worth preserving.
 *
 * A property with no summary row has no landing page — it has no violations,
 * so there is nothing to show and nothing to rank. The paid report still
 * exists at `/report/{bbl}` for anyone who wants to check.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bbl: string }> },
) {
  const { bbl: raw } = await params;
  const bbl = normalizeBbl(raw);
  if (!bbl) notFound();

  const target = await getSlugForBbl(bbl);
  if (!target) notFound();

  // An explicit 301 rather than `redirect()`, which issues a 307 from a route
  // handler. A temporary redirect would leave the old URL as the indexed one.
  return new Response(null, {
    status: 301,
    headers: { Location: `/p/${target.boroughSlug}/${target.slug}` },
  });
}
