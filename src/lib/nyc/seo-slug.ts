/**
 * URL slugs for the property landing pages.
 *
 * Pure and dependency-free so the nightly refresh script and the tests can
 * share it — `seo-summary.ts` is `server-only` and cannot be imported from
 * either.
 *
 * Slugs are assigned once, by the refresh script, and stored. They are not
 * derived at request time because `properties.address_normalized` is not
 * unique across tax lots: two lots really can normalize to the same string,
 * and something has to remember which one won.
 */

import { normalizeAddress } from "./address";

/** '123 MAIN ST' + '10001' -> '123-main-st-10001'. */
export function slugifyAddress(
  address: string | null | undefined,
  zip: string | null | undefined,
): string | null {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;

  const slug = [normalized, zip]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug === "" ? null : slug;
}

/**
 * Hands out slugs that are unique within a borough.
 *
 * The first claimant of a slug keeps it bare; later collisions take `-2`,
 * `-3`, and so on. Callers must feed properties in a stable order (BBL
 * ascending) so a given property keeps the same URL from one nightly run to
 * the next — otherwise every run would reshuffle which lot owns the bare slug
 * and invalidate whatever the crawler had indexed.
 */
export class SlugAllocator {
  private taken = new Map<string, Set<string>>();

  claim(boroughSlug: string, base: string): string {
    let set = this.taken.get(boroughSlug);
    if (!set) {
      set = new Set();
      this.taken.set(boroughSlug, set);
    }

    let slug = base;
    for (let n = 2; set.has(slug); n++) slug = `${base}-${n}`;
    set.add(slug);
    return slug;
  }
}
