/**
 * The canonical public origin, without a trailing slash.
 *
 * `www` is primary. Vercel 308s the apex to it, and a canonical URL that
 * redirects is discounted by crawlers and skipped by most og:image fetchers —
 * so the host the app *claims* has to be the host that actually serves.
 *
 * The default is not a placeholder. When `NEXT_PUBLIC_SITE_URL` is missing —
 * a fresh environment, a mistyped variable name — this is silently what every
 * canonical tag, sitemap entry, Stripe return URL and magic-link redirect
 * becomes. A stale value here fails quietly and looks like working software,
 * which is the same trap the auth section of the README documents.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
  "https://www.nycviolationhub.com";

/**
 * The public, no-login URL for a shared or purchased report snapshot.
 *
 * Built from `SITE_URL` rather than from the request origin for a reason that
 * outlives the request: this link is emailed. A preview deployment that sent a
 * purchase receipt pointing at its own hostname would produce a link that dies
 * with the deployment, and the buyer of a $49 report has no account to fall
 * back to.
 */
export function reportShareUrl(token: string): string {
  return `${SITE_URL}/r/${token}`;
}
