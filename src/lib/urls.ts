/**
 * Absolute URLs for links that leave the app.
 *
 * Anything that ends up in an email or a Stripe redirect has to be absolute and
 * has to point at the canonical host, not at whatever origin happened to serve
 * the request. A preview deployment sending a purchase receipt that links back
 * to the preview's own hostname produces a link that outlives the deployment.
 *
 * `NEXT_PUBLIC_SITE_URL` is already load-bearing for magic-link auth for the
 * same reason (see README → "Auth configuration"); this keeps the report links
 * on the same footing rather than deriving them independently.
 */

const FALLBACK = "http://localhost:3000";

export function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? FALLBACK).replace(/\/+$/, "");
}

/** The public, no-login URL for a shared or purchased report snapshot. */
export function reportShareUrl(token: string): string {
  return `${siteOrigin()}/r/${token}`;
}
