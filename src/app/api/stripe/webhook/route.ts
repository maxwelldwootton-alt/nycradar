import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { isStripeConfigured, stripe } from "@/lib/stripe/client";
import { supabaseService, hasServiceRole } from "@/lib/supabase/server";
import { generateReport } from "@/lib/nyc/report";
import { getProperty } from "@/lib/nyc/property";
import { createShareLink } from "@/lib/nyc/share";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Stripe webhook — the **sole** writer of entitlement state.
 *
 * Nothing else in the app may mark a subscription active or a report paid:
 * success redirects can be forged, and client state can be tampered with. If
 * this handler doesn't record it, the user isn't entitled.
 */
export async function POST(request: Request) {
  if (!isStripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }
  if (!hasServiceRole()) {
    return NextResponse.json({ error: "Service role not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // Signature verification requires the raw body, not the parsed JSON.
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error("stripe signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionChange(event.data.object);
        break;
      default:
        break;
    }
  } catch (err) {
    // Returning 500 makes Stripe retry, which is what we want for a transient
    // failure — the handlers are written to be idempotent.
    console.error(`webhook handler failed for ${event.type}`, err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const db = supabaseService();

  if (session.mode === "subscription") {
    const accountId = session.client_reference_id;
    const customerId =
      typeof session.customer === "string" ? session.customer : session.customer?.id;
    if (accountId && customerId) {
      await db
        .from("accounts")
        .update({ stripe_customer_id: customerId })
        .eq("id", accountId);
    }
    return;
  }

  // One-time report purchase (FR5a).
  const bbl = session.metadata?.bbl;
  if (!bbl) {
    console.error("single-report checkout completed without a bbl", session.id);
    return;
  }

  const email =
    session.customer_details?.email ?? session.customer_email ?? null;

  // Generate and snapshot the report so the buyer gets a durable link they can
  // open without an account — the whole point of this tier.
  let reportId: string | null = null;
  try {
    const property = await getProperty(bbl).catch(() => null);
    const report = await generateReport(bbl, { property: property ?? undefined });
    const { token } = await createShareLink(report);

    const { data } = await db
      .from("reports")
      .select("id")
      .eq("token", token)
      .maybeSingle();
    reportId = data?.id ?? null;
  } catch (err) {
    // Payment succeeded; never fail the webhook over report generation. The
    // purchase row is still written and the report can be regenerated.
    console.error("could not pre-generate purchased report", err);
  }

  await db.from("single_report_purchases").upsert(
    {
      stripe_session_id: session.id,
      stripe_payment_intent:
        typeof session.payment_intent === "string" ? session.payment_intent : null,
      email,
      bbl,
      report_id: reportId,
      amount_total: session.amount_total,
      status: session.payment_status === "paid" ? "paid" : "pending",
    },
    { onConflict: "stripe_session_id" },
  );
}

async function handleSubscriptionChange(subscription: Stripe.Subscription) {
  const db = supabaseService();
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const item = subscription.items.data[0];
  const periodEnd = item?.current_period_end
    ? new Date(item.current_period_end * 1000).toISOString()
    : null;

  const update = {
    subscription_status: subscription.status,
    subscription_price_id: item?.price?.id ?? null,
    current_period_end: periodEnd,
  };

  // Prefer the account id carried in metadata; fall back to the customer id.
  const accountId = subscription.metadata?.account_id;
  const query = accountId
    ? db.from("accounts").update({ ...update, stripe_customer_id: customerId }).eq("id", accountId)
    : db.from("accounts").update(update).eq("stripe_customer_id", customerId);

  const { error } = await query;
  if (error) throw new Error(`account update failed: ${error.message}`);
}
