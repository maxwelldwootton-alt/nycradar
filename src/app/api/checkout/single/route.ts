import { NextResponse } from "next/server";
import { normalizeBbl } from "@/lib/nyc/bbl";
import { getProperty } from "@/lib/nyc/property";
import {
  isStripeConfigured,
  priceId,
  siteUrl,
  stripe,
} from "@/lib/stripe/client";
import { currentUser } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * One-time $49 report purchase (FR5a).
 *
 * Deliberately does not require an account: this tier exists for the
 * individual seller or one-off attorney who is mid-transaction and will not
 * sign up for a subscription. Stripe collects the email, and the webhook mints
 * a shareable report link that is delivered on the success redirect — so the
 * buyer reaches their report without ever creating a login.
 */
export async function POST(request: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Payments are not configured on this deployment." },
      { status: 503 },
    );
  }

  const form = await request.formData().catch(() => null);
  const raw = form?.get("bbl");
  const bbl = typeof raw === "string" ? normalizeBbl(raw) : null;
  if (!bbl) {
    return NextResponse.json({ error: "A valid BBL is required" }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  const base = siteUrl(origin);
  const property = await getProperty(bbl).catch(() => null);
  const user = await currentUser().catch(() => null);

  try {
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId("single"), quantity: 1 }],
      // Known email when signed in; Stripe collects it otherwise.
      customer_email: user?.email ?? undefined,
      // The webhook needs to know which property was bought.
      metadata: { bbl, address: property?.address ?? "" },
      payment_intent_data: { metadata: { bbl } },
      success_url: `${base}/purchase/complete?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/report/${bbl}`,
    });

    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return NextResponse.redirect(session.url, { status: 303 });
  } catch (err) {
    console.error("single-report checkout failed", err);
    return NextResponse.json(
      { error: "Could not start checkout" },
      { status: 502 },
    );
  }
}
