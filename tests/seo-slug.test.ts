/**
 * Slug assignment for the public property landing pages.
 *
 * These slugs sit behind a unique index and are what a crawler indexes, so two
 * things have to hold: they must never collide within a borough (the nightly
 * upsert would fail), and a given property must keep the same slug run over
 * run (or every refresh would invalidate what was indexed).
 */

import { describe, expect, it } from "vitest";
import { slugifyAddress, SlugAllocator } from "@/lib/nyc/seo-slug";

describe("slugifyAddress", () => {
  it("lowercases and hyphenates a PLUTO address", () => {
    expect(slugifyAddress("123 MAIN STREET", "10001")).toBe("123-main-st-10001");
  });

  it("abbreviates street types via the shared normalizer", () => {
    // Matches normalize_address_text() in the database — search depends on the
    // two agreeing, so the slug has to come from the same normalizer.
    expect(slugifyAddress("450 WEST BOULEVARD", null)).toBe("450-w-blvd");
  });

  it("keeps Queens hyphenated house numbers readable", () => {
    expect(slugifyAddress("114-15 ROCKAWAY BEACH BOULEVARD", "11694")).toBe(
      "114-15-rockaway-beach-blvd-11694",
    );
  });

  it("elides apostrophes rather than splitting the word", () => {
    expect(slugifyAddress("345 ST ANN'S AVENUE", "10454")).toBe(
      "345-st-anns-ave-10454",
    );
  });

  it("collapses spelled-out ordinals the way the normalizer does", () => {
    expect(slugifyAddress("1 FIFTH AVENUE", "10003")).toBe("1-5-ave-10003");
  });

  it("omits a missing zip instead of leaving a dangling separator", () => {
    const slug = slugifyAddress("123 MAIN STREET", null);
    expect(slug).toBe("123-main-st");
    expect(slug?.endsWith("-")).toBe(false);
  });

  it("returns null when there is no usable address", () => {
    expect(slugifyAddress(null, "10001")).toBeNull();
    expect(slugifyAddress("", "10001")).toBeNull();
    expect(slugifyAddress("   ", "10001")).toBeNull();
  });

  it("returns null when an address has nothing slug-safe in it", () => {
    expect(slugifyAddress("!!!", null)).toBeNull();
  });
});

describe("SlugAllocator", () => {
  it("gives the first claimant the bare slug", () => {
    const a = new SlugAllocator();
    expect(a.claim("manhattan", "123-main-st")).toBe("123-main-st");
  });

  it("suffixes collisions instead of reusing a taken slug", () => {
    const a = new SlugAllocator();
    expect(a.claim("manhattan", "123-main-st")).toBe("123-main-st");
    expect(a.claim("manhattan", "123-main-st")).toBe("123-main-st-2");
    expect(a.claim("manhattan", "123-main-st")).toBe("123-main-st-3");
  });

  it("scopes uniqueness to the borough, since that is a separate path segment", () => {
    const a = new SlugAllocator();
    expect(a.claim("manhattan", "123-main-st")).toBe("123-main-st");
    expect(a.claim("brooklyn", "123-main-st")).toBe("123-main-st");
  });

  it("does not hand out a bare slug that a suffixed claim already took", () => {
    const a = new SlugAllocator();
    a.claim("queens", "5-ave");
    a.claim("queens", "5-ave"); // -> 5-ave-2
    // A property whose own base is literally '5-ave-2' must not collide with it.
    expect(a.claim("queens", "5-ave-2")).toBe("5-ave-2-2");
  });

  it("is deterministic for a stable input order", () => {
    const order = ["1000010001", "1000010002", "1000010003"];
    const run = () => {
      const a = new SlugAllocator();
      return order.map(() => a.claim("manhattan", "123-main-st"));
    };
    expect(run()).toEqual(run());
    expect(run()).toEqual(["123-main-st", "123-main-st-2", "123-main-st-3"]);
  });
});
