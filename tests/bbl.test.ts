/**
 * Guards the key-normalization rules from the data spike.
 *
 * These are the cheapest tests in the suite and the most valuable: every
 * failure mode they cover produces a report that is silently wrong rather
 * than visibly broken.
 */

import { describe, expect, it } from "vitest";
import {
  canonicalBbl,
  cleanBin,
  dedupKey,
  isCondoBillingLot,
  normalizeBbl,
  padBlock,
  padLot,
  padLotVariants,
  splitBbl,
  boroughCodeFromName,
} from "@/lib/nyc/bbl";

describe("canonicalBbl", () => {
  it("builds borough(1) + block(5) + lot(4)", () => {
    expect(canonicalBbl("1", "847", "38")).toBe("1008470038");
    expect(canonicalBbl("3", "1302", "1")).toBe("3013020001");
  });

  it("accepts each source's own padding and yields the same key", () => {
    // DOB pads lot to 5, ECB and OATH pad it to 4. All three describe the same
    // lot and must normalize identically — this is the join.
    const fromDob = canonicalBbl("3", "01588", "00001");
    const fromEcb = canonicalBbl("3", "01588", "0001");
    const fromHpd = canonicalBbl("3", 1588, 1);
    expect(fromDob).toBe("3015880001");
    expect(fromEcb).toBe(fromDob);
    expect(fromHpd).toBe(fromDob);
  });

  it("parses PLUTO's float-string BBLs", () => {
    expect(normalizeBbl("2054800111.00000000")).toBe("2054800111");
  });

  it("rejects invalid boroughs and out-of-range blocks/lots", () => {
    expect(canonicalBbl("6", "100", "1")).toBeNull();
    expect(canonicalBbl("1", "0", "1")).toBeNull();
    expect(canonicalBbl("1", "100", "99999")).toBeNull();
    expect(canonicalBbl("1", "abc", "1")).toBeNull();
    expect(canonicalBbl(null, null, null)).toBeNull();
  });

  it("round-trips through splitBbl", () => {
    const bbl = "4001230045";
    const parts = splitBbl(bbl)!;
    expect(parts).toEqual({ boro: "4", block: 123, lot: 45 });
    expect(canonicalBbl(parts.boro, parts.block, parts.lot)).toBe(bbl);
  });
});

describe("per-source padding", () => {
  it("pads block to 5 and lot to the width the source expects", () => {
    expect(padBlock(1588)).toBe("01588");
    expect(padLot(1, 4)).toBe("0001");
    expect(padLot(1, 5)).toBe("00001");
    // The trap: DOB's 5-wide lot vs ECB's 4-wide for the same lot.
    expect(padLot(38, 5)).not.toBe(padLot(38, 4));
  });

  it("padLotVariants returns both widths a live row might use (issue #17)", () => {
    // A single exact-padded string silently drops rows recorded at the other
    // width — sources must query both, not just their documented convention.
    expect(padLotVariants(1)).toEqual(["0001", "00001"]);
    expect(padLotVariants(38)).toEqual(["0038", "00038"]);
  });
});

describe("cleanBin", () => {
  it("accepts real BINs", () => {
    expect(cleanBin("3413929")).toBe("3413929");
  });

  it("rejects sentinel and placeholder BINs", () => {
    // 'X000000' means "unknown building in borough X", not a real building.
    expect(cleanBin("0000000")).toBeNull();
    expect(cleanBin("3000000")).toBeNull();
    expect(cleanBin("1000000")).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(cleanBin("")).toBeNull();
    expect(cleanBin(null)).toBeNull();
    expect(cleanBin("12345")).toBeNull();
    expect(cleanBin("abcdefg")).toBeNull();
  });
});

describe("dedupKey", () => {
  it("makes ECB and OATH identifiers comparable", () => {
    // OATH's ticket_number is the ECB violation number with a leading zero.
    // Exact matching finds no overlap at all; this is what makes it visible.
    const ecbNumber = "39523868K";
    const oathTicket = "039523868K";
    expect(ecbNumber).not.toBe(oathTicket);
    expect(dedupKey(ecbNumber)).toBe(dedupKey(oathTicket));
  });

  it("normalizes case and whitespace", () => {
    expect(dedupKey(" 039523868k ")).toBe("39523868K");
  });

  it("returns null for empty and all-zero input", () => {
    expect(dedupKey("")).toBeNull();
    expect(dedupKey(null)).toBeNull();
    expect(dedupKey("000")).toBeNull();
  });
});

describe("isCondoBillingLot", () => {
  it("flags lots at or above 7501", () => {
    expect(isCondoBillingLot("3000017501")).toBe(true);
    expect(isCondoBillingLot("2022687501")).toBe(true);
    expect(isCondoBillingLot("3000010002")).toBe(false);
  });
});

describe("boroughCodeFromName", () => {
  it("handles the naming variants across sources", () => {
    expect(boroughCodeFromName("BROOKLYN")).toBe("3");
    expect(boroughCodeFromName("Brooklyn")).toBe("3");
    // OATH truncates Staten Island.
    expect(boroughCodeFromName("STATEN IS")).toBe("5");
    expect(boroughCodeFromName("Staten Island")).toBe("5");
    expect(boroughCodeFromName("BK")).toBe("3");
    expect(boroughCodeFromName("Nowhere")).toBeNull();
  });
});
