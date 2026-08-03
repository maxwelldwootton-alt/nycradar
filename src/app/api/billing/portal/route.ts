import { NextResponse } from "next/server";
import { isStripeConfigured, siteUrl, stripe } from "@/lib/stripe/client";
import { currentUser } from "@/lib/supabase/session";
import { supabaseService, hasServiceRole } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Stripe customer portal — cancellation, payment method, invoices (FR5). */
export async function POST(request: Request) {
  if (!isStripeConfigured() || !hasServiceRole()) {
    return NextResponse.json(
      { error: "Billing is not configured on this deployment." },
      { status: 503 },
    );
  }

  const origin = new URL(request.url).origin;
  const user = await currentUser().catch(() => null);
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/dashboard", origin), {
      status: 303,
    });
  }

  const { data: account } = await supabaseService()
    .from("accounts")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!account?.stripe_customer_id) {
    return NextResponse.redirect(new URL("/dashboard", origin), { status: 303 });
  }

  try {
    const session = await stripe().billingPortal.sessions.create({
      customer: account.stripe_customer_id,
      return_url: `${siteUrl(origin)}/dashboard`,
    });
    return NextResponse.redirect(session.url, { status: 303 });
  } catch (err) {
    console.error("billing portal failed", err);
    return NextResponse.json({ error: "Could not open billing" }, { status: 502 });
  }
}
