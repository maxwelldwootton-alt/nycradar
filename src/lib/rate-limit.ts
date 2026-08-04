/**
 * Rate limiting for the unauthenticated surfaces.
 *
 * See `supabase/migrations/20260804120000_rate_limits.sql` for why this is in
 * Postgres rather than in memory. The short version: the expensive resource
 * being protected is the app's NYC Open Data quota, which is shared across
 * every Vercel instance, so the counter has to be shared too.
 *
 * **These limiters fail open.** If Supabase is unreachable, the right outcome
 * is a served page, not a 429 — the limiter exists to protect a quota under
 * abnormal load, and letting its own outage take down search would trade a
 * cost problem for an availability one. Failures are captured so a limiter
 * that has quietly stopped limiting is visible rather than assumed.
 */

import "server-only";
import { supabaseService, hasServiceRole } from "@/lib/supabase/server";
import { captureError } from "@/lib/observability/capture";

/**
 * The client's IP, as reported by the platform proxy.
 *
 * `x-forwarded-for` is a client-settable header in general and is only
 * trustworthy because Vercel overwrites it at the edge; the leftmost entry is
 * the real client there. Behind any other proxy this assumption needs
 * re-checking before it means anything.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/** Prune expired buckets on roughly 1 in 200 checks — see `prune_rate_limits`. */
const PRUNE_PROBABILITY = 0.005;

/**
 * Consume one unit from `bucket`. True means "allowed".
 *
 * Buckets are namespaced strings — `search:1.2.3.4`, `render:global` — and the
 * limit and window travel with the call rather than living in the database, so
 * tuning a limit is a code change with a diff rather than a hand-run UPDATE
 * nobody can find later.
 */
export async function consumeRateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  if (!hasServiceRole()) return true;

  try {
    const db = supabaseService();
    const { data, error } = await db.rpc("consume_rate_limit", {
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      captureError(new Error(error.message), { stage: "rate_limit.consume", bucket });
      return true;
    }

    if (Math.random() < PRUNE_PROBABILITY) {
      // Not awaited — housekeeping must not sit on the request's critical path.
      void db.rpc("prune_rate_limits", { p_older_than_seconds: 86_400 }).then(
        () => undefined,
        () => undefined,
      );
    }

    return data !== false;
  } catch (err) {
    captureError(err, { stage: "rate_limit.consume", bucket });
    return true;
  }
}

/**
 * Address search. Generous enough that the debounced type-ahead in `SearchBox`
 * never trips it — that fires at most a few times per second while typing and
 * aborts superseded requests — but low enough to stop a scraper walking the
 * PLUTO index.
 */
export async function guardAddressSearch(headers: Headers): Promise<boolean> {
  return consumeRateLimit(`search:${clientIp(headers)}`, 120, 60);
}

/**
 * Public report renders — the Socrata-expensive path.
 *
 * The cost being metered is **fetching a property we haven't fetched
 * recently**, not serving a page. Repeat views of the same BBL are already free
 * (`getCachedReport` holds the assembled report for an hour), so counting them
 * would burn the budget on exactly the traffic the product wants.
 *
 * So the first check is a one-per-BBL-per-hour bucket, which doubles as a
 * cache-miss oracle: it returns true only for the first render of that BBL in
 * the window — which is precisely when the four city APIs are about to be
 * called. A repeat view short-circuits and consumes nothing.
 *
 * Only on a likely miss do the real budgets apply:
 *
 *   - **Per IP**, which stops one enumerator walking the BBL space.
 *   - **Global**, which is what actually protects the quota. A distributed
 *     crawl defeats any per-IP limit, and the quota is a single shared
 *     resource, so it needs a single shared ceiling.
 *
 * The global budget is sized well above organic traffic at launch. It is a
 * circuit breaker, not a throttle — if it trips during normal operation that is
 * a signal to raise it deliberately, having first looked at why.
 */
export async function guardPublicReportRender(
  headers: Headers,
  bbl: string,
): Promise<boolean> {
  const firstViewThisHour = await consumeRateLimit(`property:${bbl}`, 1, 3600);
  if (!firstViewThisHour) return true;

  const perIp = await consumeRateLimit(`render:${clientIp(headers)}`, 60, 3600);
  if (!perIp) return false;

  return consumeRateLimit("render:global", 2000, 3600);
}
