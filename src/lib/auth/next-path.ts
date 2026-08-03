/**
 * Deliberately free of `server-only` and of any Supabase import: this is a pure
 * function guarding a security boundary, so it stays directly unit-testable.
 */

/**
 * Constrain a post-sign-in `next` destination to a same-origin path.
 *
 * `next` arrives from the URL, so without this it is an open redirect — a
 * crafted sign-in link could bounce a freshly-authenticated user to an
 * attacker's site with their session already established. Anything that isn't
 * an unambiguous local path falls back to the homepage.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  // Absolute URLs ("https://evil.com") and scheme-relative ones ("//evil.com")
  // both leave our origin; only a single leading slash is a local path.
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  // Backslashes are normalized to forward slashes by some user agents, so
  // "/\evil.com" can escape the origin the same way "//evil.com" does.
  if (raw.startsWith("/\\")) return "/";
  return raw;
}
