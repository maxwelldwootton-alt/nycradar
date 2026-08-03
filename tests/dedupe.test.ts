/**
 * The ECB/OATH deduplication rule.
 *
 * ~82.6% of ECB summonses also appear in the OATH docket. Without this pass
 * the report roughly doubles both the open-violation count and the dollars
 * owed — and dollars owed is the number a title company acts on.
 */

import { describe, expect, it } from "vitest";
import { dedupeEcbAgainstOath } from "@/lib/nyc/report";
import { dedupKey } from "@/lib/nyc/bbl";
import type { NormalizedViolation } from "@/lib/nyc/types";

function violation(
  overrides: Partial<NormalizedViolation> & Pick<NormalizedViolation, "agency">,
): NormalizedViolation {
  return {
    sourceDataset: "test",
    sourceId: "x",
    dedupKey: null,
    bbl: "3013020001",
    bin: null,
    issuedDate: "2024-01-01",
    status: "open",
    rawStatus: null,
    severity: null,
    description: null,
    balanceDue: null,
    penaltyImposed: null,
    judgmentDocketed: null,
    issuingAgency: null,
    correctionType: "unknown",
    matchedBy: "bbl",
    raw: {},
    ...overrides,
  };
}

describe("dedupeEcbAgainstOath", () => {
  it("removes the OATH copy of a summons already counted in ECB", () => {
    const ecb = [
      violation({ agency: "ECB", sourceId: "39523868K", dedupKey: dedupKey("39523868K") }),
    ];
    const oath = [
      violation({ agency: "OATH", sourceId: "039523868K", dedupKey: dedupKey("039523868K") }),
    ];

    const result = dedupeEcbAgainstOath(ecb, oath);
    expect(result.removed).toBe(1);
    expect(result.ecb).toHaveLength(1);
    expect(result.oath).toHaveLength(0);
  });

  it("keeps OATH tickets that have no ECB counterpart", () => {
    // FDNY and DSNY tickets exist only in OATH — dropping them would lose
    // real violations, which is the opposite failure from double-counting.
    const ecb = [
      violation({ agency: "ECB", sourceId: "39523868K", dedupKey: dedupKey("39523868K") }),
    ];
    const oath = [
      violation({ agency: "OATH", sourceId: "049999999X", dedupKey: dedupKey("049999999X") }),
    ];

    const result = dedupeEcbAgainstOath(ecb, oath);
    expect(result.removed).toBe(0);
    expect(result.oath).toHaveLength(1);
  });

  it("folds OATH's docketed judgment into the surviving ECB record", () => {
    // ECB has no judgment field; OATH is the only source of it. Merging keeps
    // the lien signal instead of discarding it with the duplicate.
    const ecb = [
      violation({
        agency: "ECB",
        sourceId: "39523868K",
        dedupKey: dedupKey("39523868K"),
        judgmentDocketed: null,
        balanceDue: null,
      }),
    ];
    const oath = [
      violation({
        agency: "OATH",
        sourceId: "039523868K",
        dedupKey: dedupKey("039523868K"),
        judgmentDocketed: "2024-06-01",
        balanceDue: 1500,
      }),
    ];

    const result = dedupeEcbAgainstOath(ecb, oath);
    expect(result.ecb[0].judgmentDocketed).toBe("2024-06-01");
    expect(result.ecb[0].balanceDue).toBe(1500);
  });

  it("does not overwrite money the ECB record already reports", () => {
    const ecb = [
      violation({
        agency: "ECB",
        dedupKey: dedupKey("39523868K"),
        balanceDue: 500,
      }),
    ];
    const oath = [
      violation({
        agency: "OATH",
        dedupKey: dedupKey("039523868K"),
        balanceDue: 1500,
      }),
    ];

    const result = dedupeEcbAgainstOath(ecb, oath);
    expect(result.ecb[0].balanceDue).toBe(500);
  });

  it("counts each summons once toward dollars owed", () => {
    const ecb = [violation({ agency: "ECB", dedupKey: dedupKey("39523868K"), balanceDue: 1000 })];
    const oath = [violation({ agency: "OATH", dedupKey: dedupKey("039523868K"), balanceDue: 1000 })];

    const result = dedupeEcbAgainstOath(ecb, oath);
    const total =
      result.ecb.reduce((s, v) => s + (v.balanceDue ?? 0), 0) +
      result.oath.reduce((s, v) => s + (v.balanceDue ?? 0), 0);
    // Naively summing both sources would report $2,000 owed on a $1,000 debt.
    expect(total).toBe(1000);
  });

  it("leaves records without a dedup key untouched", () => {
    const ecb = [violation({ agency: "ECB", dedupKey: null })];
    const oath = [violation({ agency: "OATH", dedupKey: null })];

    const result = dedupeEcbAgainstOath(ecb, oath);
    expect(result.removed).toBe(0);
    expect(result.ecb).toHaveLength(1);
    expect(result.oath).toHaveLength(1);
  });
});
