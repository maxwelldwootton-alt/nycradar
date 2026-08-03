/**
 * Parity between the TypeScript and SQL address normalizers.
 *
 * Search normalizes the user's query in TypeScript and compares it against
 * `properties.address_normalized`, which the database wrote using its own
 * function. A divergence between the two does not throw — it silently returns
 * no results, which is the worst way for a search box to fail. This test
 * samples real rows across all five boroughs and asserts the two agree.
 */

import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { normalizeAddress, splitHouseNumber, splitStreet } from "@/lib/nyc/address";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const db = createClient(url, key, { auth: { persistSession: false } });

describe("TS/SQL normalizer parity", () => {
  it("agrees on a broad sample of real addresses", async () => {
    const mismatches: { address: string; sql: string | null; ts: string | null }[] = [];
    let checked = 0;

    for (const boro of ["1", "2", "3", "4", "5"]) {
      const { data, error } = await db
        .from("properties")
        .select("address, address_normalized, house_number, street_normalized")
        .eq("borough_code", boro)
        .not("address", "is", null)
        .limit(400);

      expect(error).toBeNull();
      for (const row of data ?? []) {
        checked++;
        const ts = normalizeAddress(row.address);
        if (ts !== row.address_normalized) {
          mismatches.push({ address: row.address, sql: row.address_normalized, ts });
        }
        expect(splitHouseNumber(ts)).toBe(row.house_number);
        expect(splitStreet(ts)).toBe(row.street_normalized);
      }
    }

    expect(checked).toBeGreaterThan(1000);
    if (mismatches.length > 0) {
      throw new Error(
        `${mismatches.length}/${checked} normalizer mismatches, e.g. ` +
          JSON.stringify(mismatches.slice(0, 5), null, 2),
      );
    }
  });

  it("agrees on the awkward cases specifically", async () => {
    // Apostrophes, spelled-out ordinals, and hyphenated Queens house numbers
    // are the three shapes that previously diverged.
    const { data, error } = await db
      .from("properties")
      .select("address, address_normalized")
      .or("address.ilike.%'%,address.ilike.%FIFTH%,address.ilike.%-%")
      .limit(300);

    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
    for (const row of data ?? []) {
      expect(normalizeAddress(row.address)).toBe(row.address_normalized);
    }
  });
});
