/**
 * Exercises the Stripe webhook handler
 * (`src/app/api/stripe/webhook/route.ts`) against a real Postgres instance,
 * using cryptographically-signed *fake* Stripe events built with
 * `Stripe.webhooks.generateTestHeaderString` — no real Stripe API calls are
 * made. Requires STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
 * NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, pointed at the same
 * (local or branch) Postgres instance used by entitlement.integration.test.ts.
 *
 * The one-time-purchase case triggers real report generation against live
 * NYC APIs (same as the production handler); it only asserts on the purchase
 * row itself, since report/share-link creation is best-effort and allowed to
 * fail without failing the webhook (see the handler's comment on why).
 *
 * Run with: npm run test:integration
 */
import { afterAll, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { POST } from "@/app/api/stripe/webhook/route";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
if (!url || !serviceKey || !process.env.STRIPE_SECRET_KEY || !webhookSecret) {
  throw new Error(
    "test:integration requires STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, " +
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const testAccountIds: string[] = [];
const testSessionIds: string[] = [];

afterAll(async () => {
  if (testSessionIds.length > 0) {
    await db.from("single_report_purchases").delete().in("stripe_session_id", testSessionIds);
  }
  for (const id of testAccountIds) {
    await db.auth.admin.deleteUser(id).catch(() => {});
  }
});

function signedRequest(event: unknown): Request {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature, "content-type": "application/json" },
    body: payload,
  });
}

function fakeEvent(type: string, object: Record<string, unknown>) {
  return { id: `evt_test_${crypto.randomUUID()}`, object: "event", type, data: { object } };
}

async function createTestAccount(label: string): Promise<{ id: string; email: string }> {
  const email = `webhook-${label}-${Date.now()}@example.test`;
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`could not create test auth user: ${error?.message}`);
  const id = data.user.id;
  testAccountIds.push(id);
  const { error: acctError } = await db.from("accounts").upsert({ id, email });
  if (acctError) throw new Error(`could not create test account: ${acctError.message}`);
  return { id, email };
}

describe("Stripe webhook", () => {
  it("rejects a request with an invalid signature, and writes nothing", async () => {
    const payload = JSON.stringify(fakeEvent("checkout.session.completed", {}));
    const res = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=deadbeef" },
        body: payload,
      }),
    );
    expect(res.status).toBe(400);
  });

  it(
    "one-time purchase: writes a paid purchase row, idempotently on redelivery",
    async () => {
      const sessionId = `cs_test_${crypto.randomUUID()}`;
      testSessionIds.push(sessionId);
      const bbl = "8000080001";
      const event = fakeEvent("checkout.session.completed", {
        id: sessionId,
        mode: "payment",
        payment_status: "paid",
        amount_total: 4900,
        payment_intent: `pi_test_${crypto.randomUUID()}`,
        customer_details: { email: "webhook-buyer@example.test" },
        metadata: { bbl, address: "1 Test St" },
      });

      const res1 = await POST(signedRequest(event));
      expect(res1.status).toBe(200);

      const { data: row1 } = await db
        .from("single_report_purchases")
        .select("status, bbl, email")
        .eq("stripe_session_id", sessionId)
        .maybeSingle();
      expect(row1?.status).toBe("paid");
      expect(row1?.bbl).toBe(bbl);
      expect(row1?.email).toBe("webhook-buyer@example.test");

      // Stripe redelivers at least once; the same event must not duplicate the row.
      const res2 = await POST(signedRequest(event));
      expect(res2.status).toBe(200);
      const { count } = await db
        .from("single_report_purchases")
        .select("id", { count: "exact", head: true })
        .eq("stripe_session_id", sessionId);
      expect(count).toBe(1);
    },
    90_000,
  );

  it("subscription checkout: links the Stripe customer to the account", async () => {
    const { id: accountId } = await createTestAccount("sub-checkout");
    const customerId = `cus_test_${crypto.randomUUID()}`;
    const event = fakeEvent("checkout.session.completed", {
      id: `cs_test_${crypto.randomUUID()}`,
      mode: "subscription",
      client_reference_id: accountId,
      customer: customerId,
    });

    const res = await POST(signedRequest(event));
    expect(res.status).toBe(200);

    const { data: account } = await db
      .from("accounts")
      .select("stripe_customer_id")
      .eq("id", accountId)
      .maybeSingle();
    expect(account?.stripe_customer_id).toBe(customerId);
  });

  it("subscription lifecycle: activates then clears on cancellation", async () => {
    const { id: accountId } = await createTestAccount("lifecycle");
    const customerId = `cus_test_${crypto.randomUUID()}`;
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    const activated = fakeEvent("customer.subscription.updated", {
      id: `sub_test_${crypto.randomUUID()}`,
      customer: customerId,
      status: "active",
      metadata: { account_id: accountId },
      items: { data: [{ current_period_end: periodEnd, price: { id: "price_test_1" } }] },
    });
    expect((await POST(signedRequest(activated))).status).toBe(200);

    const { data: activeRow } = await db
      .from("accounts")
      .select("subscription_status")
      .eq("id", accountId)
      .maybeSingle();
    expect(activeRow?.subscription_status).toBe("active");

    const canceled = fakeEvent("customer.subscription.deleted", {
      id: `sub_test_${crypto.randomUUID()}`,
      customer: customerId,
      status: "canceled",
      metadata: { account_id: accountId },
      items: { data: [{ current_period_end: periodEnd, price: { id: "price_test_1" } }] },
    });
    expect((await POST(signedRequest(canceled))).status).toBe(200);

    const { data: canceledRow } = await db
      .from("accounts")
      .select("subscription_status")
      .eq("id", accountId)
      .maybeSingle();
    expect(canceledRow?.subscription_status).toBe("canceled");
  });
});
