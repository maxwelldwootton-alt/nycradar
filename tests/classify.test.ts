import { describe, expect, it } from "vitest";
import { correctionType, severityLabel, severityRank } from "@/lib/nyc/classify";
import { parseCityDate, parseMoney } from "@/lib/nyc/parse";

describe("correctionType", () => {
  it("treats HPD class I as administrative by definition", () => {
    // Class I orders are issued administratively rather than after inspection.
    expect(correctionType("HPD", "I", "SOME ORDER")).toBe("administrative");
  });

  it("flags physical work from violation text", () => {
    expect(
      correctionType("HPD", "C", "ABATE THE NUISANCE CONSISTING OF MOLD IN THE BATHROOM"),
    ).toBe("physical");
    expect(correctionType("ECB", "CLASS - 2", "97X07.97XRESTORE TO SERVICE")).toBe("physical");
  });

  it("flags paperwork-only violations as administrative", () => {
    expect(correctionType("DOB", null, "FAILURE TO FILE ANNUAL INSPECTION REPORT")).toBe(
      "administrative",
    );
  });

  it("prefers physical when a description implies both", () => {
    // Understating what clearing a violation takes is the costlier error.
    expect(
      correctionType("DOB", null, "FAILURE TO FILE REPORT FOR DEFECTIVE ELEVATOR"),
    ).toBe("physical");
  });

  it("returns unknown rather than guessing", () => {
    expect(correctionType("DOB", null, null)).toBe("unknown");
    expect(correctionType("DOB", null, "MISCELLANEOUS")).toBe("unknown");
    expect(correctionType("OATH", null, "SEE ATTACHED NOV")).toBe("unknown");
  });
});

describe("severity", () => {
  it("ranks HPD classes by hazard, most severe first", () => {
    expect(severityRank("HPD", "C")).toBeLessThan(severityRank("HPD", "B"));
    expect(severityRank("HPD", "B")).toBeLessThan(severityRank("HPD", "A"));
    expect(severityRank("HPD", null)).toBe(99);
  });

  it("parses ECB's 'CLASS - N' format", () => {
    expect(severityRank("ECB", "CLASS - 1")).toBe(1);
    expect(severityLabel("ECB", "CLASS - 1")).toMatch(/immediately hazardous/i);
  });

  it("labels HPD classes in plain language", () => {
    expect(severityLabel("HPD", "C")).toMatch(/immediately hazardous/i);
    expect(severityLabel("HPD", "A")).toMatch(/non-hazardous/i);
  });
});

describe("parseCityDate", () => {
  it("parses DOB/ECB compact YYYYMMDD", () => {
    expect(parseCityDate("20090217")).toBe("2009-02-17");
  });

  it("parses HPD/OATH ISO datetimes", () => {
    expect(parseCityDate("2014-01-06T00:00:00.000")).toBe("2014-01-06");
  });

  it("rejects the corrupt dates present in OATH", () => {
    // The source genuinely contains rows dated in the year 5201.
    expect(parseCityDate("5201-05-12T09:00:00.000")).toBeNull();
    expect(parseCityDate("00000000")).toBeNull();
    expect(parseCityDate("")).toBeNull();
    expect(parseCityDate(null)).toBeNull();
  });
});

describe("parseMoney", () => {
  it("parses string amounts and rounds to cents", () => {
    expect(parseMoney("1500")).toBe(1500);
    expect(parseMoney("1500.005")).toBe(1500.01);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(null)).toBeNull();
  });
});
