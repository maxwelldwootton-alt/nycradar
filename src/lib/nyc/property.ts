/**
 * Property lookup and address search, backed by the PLUTO-derived index.
 *
 * This is the product's address→BBL resolver. NYC's own geocoders (GeoSearch,
 * GeoClient) would be the obvious choice, but neither is reachable from the
 * build environment, and matching addresses directly against the violation
 * datasets scored only 70–78% with 22% ambiguity in the spike. PLUTO is an
 * authoritative address list, so resolving against it is both more accurate
 * and free of external dependencies.
 */

import "server-only";
import { supabaseAnon } from "@/lib/supabase/server";
import { normalizeBbl } from "./bbl";
import { looksLikeBbl } from "./address";
import type { PropertyRef } from "./types";

export type MatchType = "exact" | "nearby" | "street";

export interface PropertySearchResult {
  bbl: string;
  address: string | null;
  boroughCode: string;
  zip: string | null;
  bldgClass: string | null;
  unitsRes: number | null;
  isCondoBillingLot: boolean;
  score: number;
  /**
   * How the row was reached:
   *   exact  — house number matched and the street matched closely
   *   nearby — same street, closest house number (PLUTO stores one primary
   *            address per lot, so colloquial aliases land here)
   *   street — street-level match only
   * Surface this in the UI; a `nearby` hit must not be presented as certain.
   */
  matchType: MatchType;
}

interface SearchRow {
  bbl: string;
  address: string | null;
  borough_code: string;
  zip: string | null;
  bldg_class: string | null;
  units_res: number | null;
  is_condo_billing_lot: boolean;
  score: number;
  match_type: MatchType;
}

export async function searchProperties(
  query: string,
  opts: { borough?: string | null; limit?: number } = {},
): Promise<PropertySearchResult[]> {
  const trimmed = query.trim();
  if (trimmed === "") return [];

  // A BBL typed directly bypasses fuzzy matching entirely (FR1).
  if (looksLikeBbl(trimmed)) {
    const bbl = normalizeBbl(trimmed);
    if (bbl) {
      const property = await getProperty(bbl);
      if (property) {
        return [
          {
            bbl: property.bbl,
            address: property.address,
            boroughCode: property.boroughCode,
            zip: property.zip,
            bldgClass: property.bldgClass,
            unitsRes: property.unitsRes,
            isCondoBillingLot: property.isCondoBillingLot,
            score: 1,
            matchType: "exact",
          },
        ];
      }
      // A syntactically valid BBL with no PLUTO row is still worth reporting
      // on — violations may exist for a lot that has since been merged.
      return [];
    }
  }

  const { data, error } = await supabaseAnon().rpc("search_properties_smart", {
    q: trimmed,
    boro: opts.borough ?? null,
    lim: opts.limit ?? 10,
  });

  if (error) throw new Error(`Property search failed: ${error.message}`);

  return ((data ?? []) as SearchRow[]).map((r) => ({
    bbl: r.bbl,
    address: r.address,
    boroughCode: r.borough_code,
    zip: r.zip,
    bldgClass: r.bldg_class,
    unitsRes: r.units_res,
    isCondoBillingLot: r.is_condo_billing_lot,
    score: r.score,
    matchType: r.match_type,
  }));
}

export async function getProperty(bbl: string): Promise<PropertyRef | null> {
  const canonical = normalizeBbl(bbl);
  if (!canonical) return null;

  const { data, error } = await supabaseAnon()
    .from("properties")
    .select(
      "bbl, borough_code, block, lot, address, zip, bldg_class, units_res, is_condo_billing_lot, underlying_bbl",
    )
    .eq("bbl", canonical)
    .maybeSingle();

  if (error) throw new Error(`Property lookup failed: ${error.message}`);
  if (!data) return null;

  const { BORO_CODE_TO_LABEL } = await import("./bbl");

  return {
    bbl: data.bbl,
    boroughCode: data.borough_code,
    borough: BORO_CODE_TO_LABEL[data.borough_code] ?? data.borough_code,
    block: data.block,
    lot: data.lot,
    address: data.address,
    zip: data.zip,
    bldgClass: data.bldg_class,
    unitsRes: data.units_res,
    isCondoBillingLot: data.is_condo_billing_lot,
    underlyingBbl: data.underlying_bbl,
  };
}
