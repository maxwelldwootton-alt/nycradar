/**
 * Error capture.
 *
 * The report path calls four independent public-sector APIs of uneven
 * reliability, plus Stripe, plus Supabase. When one of them starts failing,
 * somebody has to find out from something other than a customer email.
 *
 * Deliberately not an SDK. Two transports, both optional, both additive:
 *
 *   1. **Structured JSON on stderr, always.** One line per error, parseable.
 *      This is what a Vercel log drain (or `vercel logs`) consumes, and it
 *      works with zero configuration, which means it works on day one.
 *   2. **An outbound webhook, when `ERROR_WEBHOOK_URL` is set.** Posts a
 *      compact JSON payload so a human is actually paged. Shaped to be
 *      accepted as-is by Slack's incoming webhooks (it sends a `text` field),
 *      while carrying the structured fields alongside for anything else.
 *
 * Keeping the call sites behind this function is the durable part. Swapping in
 * Sentry later is then one file, not a sweep through every catch block.
 */

import "server-only";

export type ErrorContext = Record<string, string | number | boolean | null | undefined>;

/** Cheap de-duplication so a failing dependency can't flood the webhook. */
const recentlySent = new Map<string, number>();
const DEDUP_WINDOW_MS = 60_000;

function shouldSendWebhook(fingerprint: string): boolean {
  const now = Date.now();

  // Opportunistic sweep — this map is per-instance and short-lived, but an
  // unbounded one on a long-running instance is still a leak.
  for (const [key, at] of recentlySent) {
    if (now - at > DEDUP_WINDOW_MS) recentlySent.delete(key);
  }

  const last = recentlySent.get(fingerprint);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) return false;

  recentlySent.set(fingerprint, now);
  return true;
}

function describe(err: unknown): { name: string; message: string; stack: string | null } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack ?? null };
  }
  return { name: "NonError", message: String(err), stack: null };
}

/**
 * Record an error. Never throws, never awaits the webhook.
 *
 * `context` should carry the identifiers needed to reproduce — a BBL, a Stripe
 * session id, which agency's API failed. It must not carry anything a user
 * typed verbatim or anything from the `raw` violation payloads; those can
 * contain occupant names, and an error tracker is not a place to put them.
 */
export function captureError(err: unknown, context: ErrorContext = {}): void {
  const { name, message, stack } = describe(err);

  const record = {
    level: "error" as const,
    event: "error.captured",
    name,
    message,
    ...context,
    at: new Date().toISOString(),
  };

  console.error(JSON.stringify({ ...record, stack }));

  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;

  // Fingerprint on the error identity plus the feature that raised it, not on
  // the full context — a per-BBL fingerprint would defeat the de-duplication
  // exactly when a systematic failure is hitting every property.
  const fingerprint = `${name}:${message}:${context.tag ?? context.stage ?? ""}`;
  if (!shouldSendWebhook(fingerprint)) return;

  const summary = `ViolationRadar error: ${name}: ${message}`;

  // Fire-and-forget. Awaiting would put a third-party outage on the critical
  // path of whatever request just failed, which is the wrong trade twice over.
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: summary, ...record }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {
    // An alerting channel that is itself down must not raise a second error
    // here, or a network blip becomes an infinite capture loop.
  });
}
