import { NextResponse } from "next/server";
import {
  isStripeConfigured,
  priceId,
  siteUrl,
  stripe,
} from "@/lib/stripe/client";
import { currentUser } from "@/lib/supabase/session";
import { supabaseService, hasServiceRole } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** $199/mo unlimited subscription (FR5). Requires an account. */
export async function POST(request: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Payments are not configured on this deployment." },
      { status: 503 },
    );
  }

  const origin = new URL(request.url).origin;
  const base = siteUrl(origin);
  const user = await currentUser().catch(() => null);

  if (!user?.email) {
    return NextResponse.redirect(
      new URL("/login?next=/dashboard", origin),
      { status: 303 },
    );
  }

  try {
    // Reuse an existing Stripe customer so a returning subscriber doesn't end
    // up with duplicate customer records.
    let customerId: string | undefined;
    if (hasServiceRole()) {
      const { data } = await supabaseService()
        .from("accounts")
        .select("stripe_customer_id")
        .eq("id", user.id)
        .maybeSingle();
      customerId = data?.stripe_customer_id ?? undefined;
    }

    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId("subscription"), quantity: 1 }],
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      // Ties the Stripe customer back to our account row in the webhook.
      client_reference_id: user.id,
      subscription_data: { metadata: { account_id: user.id } },
      success_url: `${base}/dashboard?subscribed=1`,
      cancel_url: `${base}/dashboard`,
    });

    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return NextResponse.redirect(session.url, { status: 303 });
  } catch (err) {
    console.error("subscription checkout failed", err);
    return NextResponse.json({ error: "Could not start checkout" }, { status: 502 });
  }
}
