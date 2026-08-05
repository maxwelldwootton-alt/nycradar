/**
 * Links from a violation row back to the city's own record for it.
 *
 * Why this exists: the report's disclaimer tells readers to "verify any finding
 * that matters to your transaction independently." Until now that instruction
 * had nowhere to point. For a document sold to attorneys and title companies,
 * every line should be checkable at the source in one click — it is the
 * cheapest credibility the product can buy, and it turns the disclaimer from a
 * liability hedge into something actionable.
 *
 * ## A dead link is worse than no link
 *
 * City URL formats change without notice, and a 404 on a due-diligence report
 * actively damages the trust this feature exists to build. So every pattern
 * below carries an explicit verification status, and **only `verified`
 * patterns ever render**. An unverified pattern returns `null` and the row
 * renders exactly as it does today.
 *
 * That means this ships inert. That is deliberate: the alternative is guessing
 * at URLs, and a guess that happens to work is indistinguishable from one that
 * 404s next quarter until a customer finds it.
 *
 * ## Verifying a pattern (~30 minutes for all four)
 *
 * The build sandbox cannot reach `*.nyc.gov` — the proxy answers 403 to CONNECT
 * for `a810-bisweb`, `hpdonline` and `a820-ecbticketfinder` alike — so this has
 * to be done from an unrestricted network. For each source:
 *
 *   1. `npm run report -- 3000017501` (or any BBL with records in that section)
 *      and take a real `sourceId` / `dedupKey` / `bin` off a row.
 *   2. Build the URL by hand from the pattern below and open it.
 *   3. Confirm it lands on *that specific record or building* — not a generic
 *      search form, not a session-expired page.
 *   4. Open it again in a private window. Several city portals hand out a
 *      session on first visit and 302 to a landing page without one; a URL that
 *      only works with a warm session is not verified.
 *   5. Flip `status` to `"verified"` and set `verifiedOn` to today.
 *
 * If a deep link proves fragile, **prefer a search URL that lands on the right
 * building.** A search hit that always works beats a record URL that sometimes
 * 404s. Downgrading a pattern to a search URL is a fix, not a compromise.
 *
 * If a pattern cannot be made to work, leave it `unverified`. Shipping no link
 * for a source is a supported outcome.
 */

import type { NormalizedViolation } from "./types";

export interface SourceLink {
  href: string;
  /** Visible link text. Names the destination so the reader knows where it goes. */
  label: string;
}

export type VerificationStatus = "verified" | "unverified";

export interface LinkPattern {
  status: VerificationStatus;
  /** ISO date the pattern was last confirmed against a live record. */
  verifiedOn: string | null;
  label: string;
  /**
   * Returns the URL, or null when this particular row lacks the identifier the
   * pattern needs (a DOB row with no BIN, say). Distinct from an unverified
   * pattern: this row simply cannot be linked.
   */
  build: (v: NormalizedViolation) => string | null;
}

/** Percent-encode a path/query value. Violation numbers can contain letters and slashes. */
function enc(value: string): string {
  return encodeURIComponent(value.trim());
}

/**
 * Candidate patterns, all currently unverified.
 *
 * These are starting points for the verification pass above, not researched
 * facts — they were written without network access to the portals, so treat
 * every one as a hypothesis. Correcting them during verification is expected
 * and is the point of the exercise.
 *
 * Exported so tests can exercise the builders directly: with every pattern
 * unverified, `sourceLink` correctly returns null for everything, which would
 * otherwise leave the URL-construction logic completely untested until the day
 * someone flips a flag.
 */
export const PATTERNS: Record<NormalizedViolation["agency"], LinkPattern> = {
  // DOB Buildings Information System. Keyed on BIN; the per-violation view
  // hangs off a building's violation list rather than a standalone record URL.
  DOB: {
    status: "unverified",
    verifiedOn: null,
    label: "View on DOB BIS",
    build: (v) =>
      v.bin
        ? `https://a810-bisweb.nyc.gov/bisweb/ActionsByLocationServlet?requestid=1&allbin=${enc(v.bin)}`
        : null,
  },

  // HPD Online. Now a single-page app, so the deep-link shape is the least
  // certain of the four — this may well need to become a search URL keyed on
  // the building rather than the violation.
  HPD: {
    status: "unverified",
    verifiedOn: null,
    label: "View on HPD Online",
    build: (v) => `https://hpdonline.nyc.gov/hpdonline/building/${enc(v.bbl)}/overview`,
  },

  // ECB summonses. `dedupKey` is the leading-zero-stripped violation number;
  // the portal may want the zero-padded form, which is exactly the kind of
  // thing verification has to settle — see bbl.ts on how much padding matters
  // elsewhere in this codebase.
  ECB: {
    status: "unverified",
    verifiedOn: null,
    label: "View ECB summons",
    build: (v) =>
      v.dedupKey
        ? `https://a820-ecbticketfinder.nyc.gov/searchHome.action?violationNumber=${enc(v.dedupKey)}`
        : null,
  },

  // OATH's citywide docket. Same caveat as ECB about which form of the ticket
  // number the search expects.
  OATH: {
    status: "unverified",
    verifiedOn: null,
    label: "View OATH case",
    build: (v) =>
      v.dedupKey
        ? `https://a820-ecbticketfinder.nyc.gov/searchHome.action?violationNumber=${enc(v.dedupKey)}`
        : null,
  },
};

/**
 * The city's record for a violation, or null when there isn't one to link to.
 *
 * Null covers three distinct cases, all of which render the same way (no link):
 * the pattern is unverified, the row lacks the identifier the pattern needs, or
 * the builder produced nothing usable.
 */
export function sourceLink(violation: NormalizedViolation): SourceLink | null {
  const pattern = PATTERNS[violation.agency];
  if (!pattern || pattern.status !== "verified") return null;

  const href = pattern.build(violation);
  if (!href) return null;

  return { href, label: pattern.label };
}

/**
 * Which agencies currently render links. Exported for tests and for a
 * launch-checklist readout — "we shipped deep links" should be answerable with
 * a fact rather than a memory.
 */
export function verifiedAgencies(): NormalizedViolation["agency"][] {
  return (Object.keys(PATTERNS) as NormalizedViolation["agency"][]).filter(
    (a) => PATTERNS[a].status === "verified",
  );
}
