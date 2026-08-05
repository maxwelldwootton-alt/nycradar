import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The free-tier limit's failure modes, offline.
 *
 * `entitlement.integration.test.ts` covers the happy path against a real
 * Postgres. This covers what happens when the RPC *doesn't answer* — which is
 * the case that actually shipped broken: `claim_free_lookup` was merged but
 * never applied to production, every call errored, `recordLookup` failed open,
 * nothing was written to `lookups`, and `free_lookups_remaining` answered 1
 * forever. The free tier was unlimited for months and produced no error anyone
 * would ever see.
 *
 * These run offline against a stubbed Supabase client precisely because the
 * integration suite cannot cover them: it needs a working database, and the
 * bug was a *missing* one.
 */

const rpc = vi.fn();
const insert = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  hasServiceRole: () => true,
  supabaseService: () => ({
    rpc,
    from: () => ({ insert }),
  }),
}));

vi.mock("@/lib/supabase/session", () => ({ currentUser: async () => null }));

const { recordLookup } = await import("@/lib/auth/entitlement");

const freeDecision = {
  entitlement: "free" as const,
  canViewFullReport: true,
  email: "someone@example.com",
  accountId: "00000000-0000-0000-0000-000000000001",
  freeRemaining: 1,
  reason: "Using your free monthly lookup.",
};

beforeEach(() => {
  rpc.mockReset();
  insert.mockReset();
  insert.mockResolvedValue({ error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("recordLookup when the free-tier claim cannot be recorded", () => {
  it("fails CLOSED when claim_free_lookup is missing (PostgREST schema cache)", async () => {
    // The exact shape PostgREST returns for an RPC it cannot find.
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function public.claim_free_lookup in the schema cache",
      },
    });

    const claimed = await recordLookup({
      bbl: "1000010001",
      address: null,
      decision: freeDecision,
    });

    // False means the caller renders the teaser. Returning true here is the
    // production bug: it would hand out an unmetered full report every time.
    expect(claimed).toBe(false);
  });

  it("fails CLOSED when Postgres itself reports undefined_function (42883)", async () => {
    // Which of the two surfaces depends on whether the schema cache reloaded,
    // so both have to be treated as permanent.
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42883", message: "function claim_free_lookup(...) does not exist" },
    });

    expect(
      await recordLookup({ bbl: "1000010001", address: null, decision: freeDecision }),
    ).toBe(false);
  });

  it("fails CLOSED on a bare 'does not exist' with no error code", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "function public.claim_free_lookup does not exist" },
    });

    expect(
      await recordLookup({ bbl: "1000010001", address: null, decision: freeDecision }),
    ).toBe(false);
  });

  it("fails OPEN on a transient error", async () => {
    // A blip is the opposite trade: one user getting a report they were most
    // likely entitled to beats paywalling everyone over a dropped connection.
    rpc.mockResolvedValue({
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });

    expect(
      await recordLookup({ bbl: "1000010001", address: null, decision: freeDecision }),
    ).toBe(true);
  });

  it("passes the claim result through when the RPC answers", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(
      await recordLookup({ bbl: "1000010001", address: null, decision: freeDecision }),
    ).toBe(true);

    // False here is the race case: a concurrent view took the last grant.
    rpc.mockResolvedValue({ data: false, error: null });
    expect(
      await recordLookup({ bbl: "1000010001", address: null, decision: freeDecision }),
    ).toBe(false);
  });

  it("does not consult the RPC at all for paid entitlements", async () => {
    // Subscription and single-purchase grants aren't metered, so a missing
    // claim function must never paywall a paying customer.
    for (const entitlement of ["subscription", "single_purchase"] as const) {
      rpc.mockResolvedValue({
        data: null,
        error: { code: "PGRST202", message: "Could not find the function" },
      });

      const claimed = await recordLookup({
        bbl: "1000010001",
        address: null,
        decision: { ...freeDecision, entitlement, reason: "Included in your subscription." },
      });

      expect(claimed).toBe(true);
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("does not re-claim for a property already counted this window", async () => {
    const claimed = await recordLookup({
      bbl: "1000010001",
      address: null,
      decision: {
        ...freeDecision,
        reason: "You already used a free lookup on this property.",
      },
    });

    expect(claimed).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
});
