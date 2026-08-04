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
