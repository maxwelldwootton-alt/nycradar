/**
 * Transactional email.
 *
 * Two things depend on this and both are launch blockers:
 *
 *   1. Magic-link sign-in, which Supabase sends. That is configured in the
 *      Supabase dashboard rather than here, but the same domain and sender
 *      identity must be verified with the provider or those messages land in
 *      spam. See README → "Email".
 *   2. Delivering a purchased report to the buyer. The $49 tier requires no
 *      account, so the emailed link is the *only* durable way that buyer can
 *      reach what they paid for.
 *
 * Resend's HTTP API, called directly rather than through its SDK — this is one
 * POST with a JSON body, and a dependency that ships its own fetch wrapper and
 * React renderer is not worth carrying for that.
 *
 * Every send is best-effort and returns a result rather than throwing. A
 * failed email must never fail the request that triggered it: the Stripe
 * webhook in particular has already taken the customer's money by the time it
 * sends, and throwing would make Stripe retry a charge-side-effect-free
 * handler forever.
 */

import "server-only";
import { captureError } from "@/lib/observability/capture";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Surfaced in logs and error reports so a failure names its own feature. */
  tag: string;
}

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: "not_configured" | "rejected" | "network" };

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/**
 * Send one message. Never throws.
 *
 * Returns `not_configured` rather than pretending to succeed, so callers can
 * degrade visibly — the purchase-complete page, for instance, keeps showing
 * the report link on screen when it knows no email went out.
 */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  if (!isEmailConfigured()) {
    // Deliberately a warning, not an error: a preview deployment without mail
    // configured is expected. Production is asserted at startup instead —
    // see `assertEmailConfigured` below.
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "email.skipped",
        reason: "not_configured",
        tag: message.tag,
      }),
    );
    return { ok: false, reason: "not_configured" };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        // Lets the provider dashboard group deliverability by feature, which is
        // how you find out that (say) only purchase receipts are bouncing.
        tags: [{ name: "feature", value: message.tag }],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      captureError(new Error(`Email provider returned ${response.status}`), {
        tag: message.tag,
        status: response.status,
        // Truncated: provider errors are short, and an unbounded body in a log
        // line is how a bounce message ends up containing a recipient's data.
        body: body.slice(0, 300),
      });
      return { ok: false, reason: "rejected" };
    }

    const payload = (await response.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: payload?.id ?? null };
  } catch (err) {
    captureError(err, { tag: message.tag, stage: "email.send" });
    return { ok: false, reason: "network" };
  }
}

/**
 * Throws when mail is unconfigured in production.
 *
 * Called from the launch preflight check rather than at import time, so a
 * missing key surfaces as one loud failure during deploy verification instead
 * of as silently undelivered purchases discovered by a support email.
 */
export function assertEmailConfigured(): void {
  if (process.env.NODE_ENV === "production" && !isEmailConfigured()) {
    throw new Error(
      "RESEND_API_KEY and EMAIL_FROM must be set in production — purchased " +
        "reports are delivered by email and there is no other way for a " +
        "no-account buyer to reach one.",
    );
  }
}
