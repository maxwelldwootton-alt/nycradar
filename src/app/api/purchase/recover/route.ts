import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseService, hasServiceRole } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/client";
import { recoveredReportsEmail } from "@/lib/email/templates";
import { consumeRateLimit, clientIp } from "@/lib/rate-limit";
import { captureError } from "@/lib/observability/capture";
import { reportShareUrl, SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().email().max(320) });

/**
 * Re-send the report links for every one-time purchase made with an email
 * address.
 *
 * The $49 tier deliberately creates no account, which means the emailed link is
 * the buyer's only durable handle on what they bought. When that message is
 * lost — spam-filtered, mistyped address, deleted — this is the sole remaining
 * path, and without it the support answer is a refund.
 *
 * **The response never reveals whether the address has purchases.** Anything
 * that distinguishes "no purchases" from "check your inbox" turns this into an
 * oracle for whether a given person is a customer, which for a product whose
 * customers are mid-transaction on specific properties is a real disclosure.
 * Both cases return the same redirect; only the mailbox owner learns anything.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const parsed = schema.safeParse({ email: form?.get("email") });

  const done = NextResponse.redirect(`${SITE_URL}/purchase/recover?sent=1`, {
    status: 303,
  });

  // Even a malformed address gets the generic answer — a distinct validation
  // error would still confirm which addresses are well-formed enough to check.
  if (!parsed.success || !hasServiceRole()) return done;

  const email = parsed.data.email;

  // Two limits with different jobs. Per-IP stops someone walking a list of
  // addresses to find customers; per-email stops this endpoint being used to
  // mail-bomb one person, which needs only a single request per attempt from
  // any number of addresses.
  const [ipOk, emailOk] = await Promise.all([
    consumeRateLimit(`recover:ip:${clientIp(request.headers)}`, 5, 3600),
    consumeRateLimit(`recover:email:${email.toLowerCase()}`, 3, 3600),
  ]);
  if (!ipOk || !emailOk) return done;

  try {
    const db = supabaseService();

    const { data: purchases, error } = await db
      .from("single_report_purchases")
      .select("bbl, report_id")
      .ilike("email", email)
      .eq("status", "paid")
      .not("report_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(25);

    if (error) throw new Error(error.message);
    if (!purchases || purchases.length === 0) return done;

    // Resolved as a second query rather than a PostgREST embed: the embed name
    // depends on the foreign-key constraint's name, so it breaks silently if
    // the schema is ever recreated with a different one.
    const reportIds = purchases.map((p) => p.report_id as string);
    const { data: reports } = await db
      .from("reports")
      .select("id, token, address, bbl")
      .in("id", reportIds);

    const byId = new Map((reports ?? []).map((r) => [r.id as string, r]));

    const items = purchases
      .map((p) => byId.get(p.report_id as string))
      .filter((r): r is NonNullable<typeof r> => Boolean(r?.token))
      .map((r) => ({
        address: (r.address as string | null) ?? `BBL ${r.bbl}`,
        bbl: r.bbl as string,
        reportUrl: reportShareUrl(r.token as string),
      }));

    if (items.length === 0) return done;

    const message = recoveredReportsEmail({ reports: items });
    const sent = await sendEmail({ to: email, tag: "purchase_recovery", ...message });
    if (!sent.ok) {
      captureError(new Error(`Recovery email failed: ${sent.reason}`), {
        tag: "purchase",
        stage: "recovery_email",
      });
    }
  } catch (err) {
    // Never surfaced to the caller — see the disclosure note above. The
    // operator finds out instead.
    captureError(err, { tag: "purchase", stage: "recovery" });
  }

  return done;
}
