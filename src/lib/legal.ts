/**
 * The handful of facts the Terms and Privacy pages need that only the operator
 * can supply.
 *
 * Kept in one place because a legal entity name that appears in two documents
 * and disagrees between them is worse than one that appears nowhere. The
 * bracketed values are placeholders: `legalDetailsConfigured()` detects them
 * and both pages render a visible draft banner until they are replaced, so an
 * unfinished policy can never quietly pass as a binding one.
 */

export const LEGAL = {
  entityName: "[LEGAL ENTITY NAME]",
  productName: "ViolationRadar",
  siteName: "nycviolationhub.com",
  mailingAddress: "[MAILING ADDRESS]",
  privacyEmail: "[privacy@yourdomain.com]",
  supportEmail: "[support@yourdomain.com]",
  governingLaw: "the State of New York",
  lastUpdated: "August 3, 2026",
} as const;

/** False while any placeholder remains. Drives the draft banner. */
export function legalDetailsConfigured(): boolean {
  return !Object.values(LEGAL).some(
    (v) => typeof v === "string" && v.includes("["),
  );
}
