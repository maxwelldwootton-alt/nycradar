import { describe, it, expect } from "vitest";
import { PATTERNS, sourceLink, verifiedAgencies } from "@/lib/nyc/source-links";
import type { NormalizedViolation } from "@/lib/nyc/types";

/**
 * The safety property first, the construction logic second.
 *
 * A dead link on a due-diligence report is worse than no link — it damages the
 * trust the feature exists to build. So the invariant that actually matters is
 * that an *unverified* pattern can never render, no matter how plausible its
 * URL looks. Everything else is secondary to that.
 *
 * These tests are written to stay valid after someone completes the
 * verification pass and flips a flag. Nothing here asserts "all patterns are
 * unverified" — that would turn the intended next change into a test failure.
 */

function violation(over: Partial<NormalizedViolation> = {}): NormalizedViolation {
  return {
    agency: "DOB",
    sourceDataset: "3h2n-5cm9",
    sourceId: "V123456",
    dedupKey: "39523868K",
    bbl: "3000010002",
    bin: "3000123",
    issuedDate: "2024-03-12",
    status: "open",
    rawStatus: "ACTIVE",
    severity: null,
    description: "TEST",
    balanceDue: null,
    penaltyImposed: null,
    judgmentDocketed: null,
    issuingAgency: null,
    correctionType: "unknown",
    matchedBy: "bbl",
    raw: {},
    ...over,
  };
}

const AGENCIES = ["DOB", "HPD", "ECB", "OATH"] as const;

describe("sourceLink — the no-dead-links guarantee", () => {
  it("renders nothing for an unverified pattern, however well-formed its URL", () => {
    for (const agency of AGENCIES) {
      if (PATTERNS[agency].status === "verified") continue;

      // The builder may well produce a perfectly plausible URL — that is
      // exactly the case this guards. Plausible and confirmed are different.
      expect(sourceLink(violation({ agency }))).toBeNull();
    }
  });

  it("only reports an agency as verified when its pattern says so", () => {
    const expected = AGENCIES.filter((a) => PATTERNS[a].status === "verified");
    expect(verifiedAgencies().sort()).toEqual([...expected].sort());
  });

  it("requires a verification date alongside a verified status", () => {
    // A pattern marked verified with no date is unauditable: nobody can tell
    // whether it was checked today or a year before the city redesigned.
    for (const agency of AGENCIES) {
      if (PATTERNS[agency].status === "verified") {
        expect(PATTERNS[agency].verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});

describe("URL construction", () => {
  it("builds absolute https URLs carrying the row's identifier", () => {
    for (const agency of AGENCIES) {
      const href = PATTERNS[agency].build(violation({ agency }));
      if (href === null) continue; // agency needs an identifier this row lacks
      expect(href).toMatch(/^https:\/\//);
      expect(href).not.toContain("undefined");
      expect(href).not.toContain("null");
    }
  });

  it("returns null rather than a broken URL when the identifier is missing", () => {
    // A DOB link keyed on BIN cannot be built for a row that has no BIN, and a
    // summons link cannot be built without a ticket number. Emitting a URL with
    // an empty parameter would produce a link that silently goes nowhere.
    expect(PATTERNS.DOB.build(violation({ agency: "DOB", bin: null }))).toBeNull();
    expect(PATTERNS.ECB.build(violation({ agency: "ECB", dedupKey: null }))).toBeNull();
    expect(PATTERNS.OATH.build(violation({ agency: "OATH", dedupKey: null }))).toBeNull();
  });

  it("percent-encodes identifiers", () => {
    // Violation and ticket numbers are not always tidy alphanumerics; an
    // unencoded slash or space silently truncates the query parameter.
    const href = PATTERNS.ECB.build(violation({ agency: "ECB", dedupKey: "123/456 A" }));
    expect(href).not.toBeNull();
    expect(href).toContain("123%2F456%20A");
    expect(href).not.toContain("123/456 A");
  });

  it("does not leak whitespace from a padded identifier", () => {
    const href = PATTERNS.ECB.build(violation({ agency: "ECB", dedupKey: "  39523868K  " }));
    expect(href).toContain("39523868K");
    expect(href).not.toMatch(/%20{1,}39523868K/);
  });
});
