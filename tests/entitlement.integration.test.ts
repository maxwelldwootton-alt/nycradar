/**
 * Exercises the four report-access paths (anonymous/first-time, returning
 * free user, one-time purchase, subscription) against a real Postgres
 * instance — either a local `supabase start` stack or a Supabase branch —
 * with `SUPABASE_SERVICE_ROLE_KEY` set. `currentUser()` is the only thing
 * mocked, since it depends on request-scoped auth cookies that don't exist
 * outside a real HTTP request; everything downstream hits the real database,
 * including the `claim_free_lookup` RPC this suite was written to cover.
 *
 * `accounts.id` references `auth.users`, so each case creates a real auth
 * user via the admin API first — mirroring what `ensureAccount` does on
 * magic-link sign-in — rather than a bare random uuid, which would fail the
 * foreign key the moment a lookup row is inserted.
 *
 * Run with: npm run test:integration
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

let mockUser: { id: string; email: string } | null = null;
vi.mock("@/lib/supabase/session", () => ({
  currentUser: async () => mockUser,
}));

const { resolveAccess, recordLookup } = await import("@/lib/auth/entitlement");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !serviceKey) {
  throw new Error(
    "test:integration requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
      "pointed at a real (local or branch) Supabase project.",
  );
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const testUserIds: string[] = [];
const testEmails: string[] = [];

/** Creates a real auth user + accounts row, and signs `currentUser()` in as them. */
async function setupUser(
  label: string,
  accountOverrides: Record<string, unknown> = {},
): Promise<{ id: string; email: string }> {
  const email = `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  testEmails.push(email);

  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) {
    throw new Error(`could not create test auth user: ${error?.message}`);
  }
  const id = data.user.id;
  testUserIds.push(id);

  const { error: acctError } = await db
    .from("accounts")
    .upsert({ id, email, ...accountOverrides });
  if (acctError) throw new Error(`could not create test account: ${acctError.message}`);

  mockUser = { id, email };
  return { id, email };
}

afterAll(async () => {
  for (const id of testUserIds) {
    await db.auth.admin.deleteUser(id).catch(() => {});
  }
  if (testEmails.length > 0) {
    await db.from("lookups").delete().in("email", testEmails);
    await db.from("single_report_purchases").delete().in("email", testEmails);
  }
});

beforeEach(() => {
  mockUser = null;
});

describe("resolveAccess / recordLookup against real Postgres", () => {
  it("anonymous visitors get the teaser", async () => {
    mockUser = null;
    const access = await resolveAccess("1000010001");
    expect(access.entitlement).toBe("anonymous");
    expect(access.canViewFullReport).toBe(false);
  });

  it("grants the first free lookup and burns it in the same 30-day window", async () => {
    const { id } = await setupUser("first-time");

    const first = await resolveAccess("2000020001");
    expect(first.entitlement).toBe("free");
    expect(first.canViewFullReport).toBe(true);
    expect(first.freeRemaining).toBe(1);

    const claimed = await recordLookup({
      bbl: "2000020001",
      address: "1 Test St",
      decision: first,
    });
    expect(claimed).toBe(true);

    const second = await resolveAccess("2000020002");
    expect(second.canViewFullReport).toBe(false);
    expect(second.entitlement).toBe("anonymous");

    const { data: rows } = await db.from("lookups").select("id").eq("account_id", id);
    expect(rows).toHaveLength(1);
  });

  it("does not burn a second lookup when revisiting the same BBL", async () => {
    const { email } = await setupUser("revisit");

    const first = await resolveAccess("3000030001");
    await recordLookup({ bbl: "3000030001", address: null, decision: first });

    const revisit = await resolveAccess("3000030001");
    expect(revisit.canViewFullReport).toBe(true);
    expect(revisit.reason).toContain("already used");
    const claimedAgain = await recordLookup({
      bbl: "3000030001",
      address: null,
      decision: revisit,
    });
    expect(claimedAgain).toBe(true);

    const { count } = await db
      .from("lookups")
      .select("id", { count: "exact", head: true })
      .eq("email", email);
    expect(count).toBe(1);
  });

  it("closes the race: two concurrent claims for different BBLs, only one wins", async () => {
    const { email } = await setupUser("race");

    const [a, b] = await Promise.all([
      resolveAccess("4000040001"),
      resolveAccess("4000040002"),
    ]);
    // Both reads see the lookup as available — this is the race window the
    // bug lived in. The claim itself must still only let one through.
    expect(a.canViewFullReport).toBe(true);
    expect(b.canViewFullReport).toBe(true);

    const [claimedA, claimedB] = await Promise.all([
      recordLookup({ bbl: "4000040001", address: null, decision: a }),
      recordLookup({ bbl: "4000040002", address: null, decision: b }),
    ]);

    expect([claimedA, claimedB].filter(Boolean)).toHaveLength(1);

    const { count } = await db
      .from("lookups")
      .select("id", { count: "exact", head: true })
      .eq("email", email);
    expect(count).toBe(1);
  });

  it("grants unlimited access to an active subscriber regardless of free-tier state", async () => {
    await setupUser("subscriber", { subscription_status: "active" });

    // Burn the free lookup on one property; subscription must still cover a
    // different one afterward.
    const free = await resolveAccess("5000050001");
    await recordLookup({ bbl: "5000050001", address: null, decision: free });

    const subAccess = await resolveAccess("5000050002");
    expect(subAccess.entitlement).toBe("subscription");
    expect(subAccess.canViewFullReport).toBe(true);
  });

  it("falls through to the free tier once a subscription is canceled", async () => {
    await setupUser("canceled-sub", { subscription_status: "canceled" });

    const access = await resolveAccess("6000060001");
    expect(access.entitlement).toBe("free");
    expect(access.canViewFullReport).toBe(true);
  });

  it("grants access to the exact property a single purchase covers, and no other", async () => {
    const { email } = await setupUser("single-purchase");
    await db.from("single_report_purchases").insert({
      stripe_session_id: `cs_test_${crypto.randomUUID()}`,
      email,
      bbl: "7000070001",
      status: "paid",
      amount_total: 4900,
    });

    const purchased = await resolveAccess("7000070001");
    expect(purchased.entitlement).toBe("single_purchase");
    expect(purchased.canViewFullReport).toBe(true);

    const other = await resolveAccess("7000070002");
    expect(other.entitlement).not.toBe("single_purchase");
  });
});
