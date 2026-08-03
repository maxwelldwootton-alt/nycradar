/**
 * Address normalization — the TypeScript half of a mirrored pair.
 *
 * The other half is `normalize_address_text()` in the database. Search works by
 * normalizing the user's query here and comparing it against
 * `properties.address_normalized`, which was written by the SQL function. If
 * the two ever disagree, search silently misses instead of erroring, so
 * `tests/address-parity.live.test.ts` asserts they agree on real data.
 *
 * Any change here must be made in the database function too.
 */

/** Street types are abbreviated, never dropped — "5 AVENUE" and "5 STREET"
 *  are different streets in every borough. */
const TOKEN_MAP: Record<string, string> = {
  STREET: "ST",
  AVENUE: "AVE",
  BOULEVARD: "BLVD",
  PLACE: "PL",
  ROAD: "RD",
  DRIVE: "DR",
  COURT: "CT",
  LANE: "LN",
  TERRACE: "TER",
  PARKWAY: "PKWY",
  PLAZA: "PLZ",
  SQUARE: "SQ",
  HIGHWAY: "HWY",
  TURNPIKE: "TPKE",
  EXPRESSWAY: "EXPY",
  CIRCLE: "CIR",
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
  // PLUTO spells out numbered thoroughfares ("FIFTH AVENUE") while users type
  // "5th Ave". Both must collapse to the same key.
  FIRST: "1",
  SECOND: "2",
  THIRD: "3",
  FOURTH: "4",
  FIFTH: "5",
  SIXTH: "6",
  SEVENTH: "7",
  EIGHTH: "8",
  NINTH: "9",
  TENTH: "10",
  ELEVENTH: "11",
  TWELFTH: "12",
};

export function normalizeAddress(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;

  let cleaned = input.toUpperCase();
  // Apostrophes are elided, not replaced with a space: "ST ANN'S AVENUE" must
  // become "ST ANNS AVE" to match a user's "St Anns Avenue".
  cleaned = cleaned.replace(/'/g, "");
  cleaned = cleaned.replace(/[.,#]/g, " ");
  cleaned = cleaned.replace(/\b(\d+)(ST|ND|RD|TH)\b/g, "$1");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (cleaned === "") return null;

  const tokens = cleaned.split(" ").map((t) => TOKEN_MAP[t] ?? t);
  const out = tokens.join(" ").trim();
  return out === "" ? null : out;
}

/** Leading house number, including Queens' hyphenated form ("114-15"). */
export function splitHouseNumber(normalized: string | null): string | null {
  if (!normalized) return null;
  const m = normalized.match(/^(\d+(?:-\d+)?[A-Z]?)\s/);
  return m ? m[1] : null;
}

export function splitStreet(normalized: string | null): string | null {
  if (!normalized) return null;
  const m = normalized.match(/^\d+(?:-\d+)?[A-Z]?\s+(.*)$/);
  return m ? m[1] : normalized;
}

/** Detect a BBL typed directly into the search box (FR1 supports both). */
export function looksLikeBbl(input: string): boolean {
  return /^\s*\d{10}\s*$/.test(input);
}
