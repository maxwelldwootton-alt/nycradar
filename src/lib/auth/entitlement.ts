/**
 * Who can see a full report, and why (FR4, FR5, FR5a).
 *
 * Entitlement is decided server-side on every report request and derives from
 * Stripe state written by the webhook — never from anything the client sends.
 *
 * Tiers:
 *   anonymous       → teaser only (counts, no detail)
 *   free            → one full report per email per rolling 30 days
 *   subscription    → unlimited
 *   single_purchase → one specific property, no account required
 */

import "server-only";
import { supabaseService, hasServiceRole } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/session";

export type Entitlement = "anonymous" | "free" | "subscription" | "single_purchase";

export interface AccessDecision {
  entitlement: Entitlement;
  /** False means show the teaser and a paywall. */
  canViewFullReport: boolean;
  email: string | null;
  accountId: string | null;
  /** Remaining free lookups in the current rolling window. */
  freeRemaining: number;
  reason: string;
}

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

export async function resolveAccess(bbl: string): Promise<AccessDecision> {
  const user = await currentUser().catch(() => null);

  if (!user?.email) {
    return {
      entitlement: "anonymous",
      canViewFullReport: false,
      email: null,
      accountId: null,
      freeRemaining: 0,
      reason: "Sign in with your email to view a full report.",
    };
  }

  // Without a service-role key we cannot read billing state. Fail closed to
  // the teaser rather than handing out full reports.
  if (!hasServiceRole()) {
    return {
      entitlement: "anonymous",
      canViewFullReport: false,
      email: user.email,
      accountId: user.id,
      freeRemaining: 0,
      reason: "Billing is not configured on this deployment.",
    };
  }

  const db = supabaseService();

  const { data: account } = await db
    .from("accounts")
    .select("id, subscription_status, current_period_end")
    .eq("id", user.id)
    .maybeSingle();

  if (
    account?.subscription_status &&
    ACTIVE_SUBSCRIPTION_STATUSES.has(account.subscription_status)
  ) {
    return {
      entitlement: "subscription",
      canViewFullReport: true,
      email: user.email,
      accountId: user.id,
      freeRemaining: 0,
      reason: "Included in your subscription.",
    };
  }

  // A one-time purchase unlocks exactly the property it was bought for.
  const { data: purchase } = await db
    .from("single_report_purchases")
    .select("id")
    .eq("bbl", bbl)
    .eq("status", "paid")
    .ilike("email", user.email)
    .maybeSingle();

  if (purchase) {
    return {
      entitlement: "single_purchase",
      canViewFullReport: true,
      email: user.email,
      accountId: user.id,
      freeRemaining: 0,
      reason: "You purchased this report.",
    };
  }

  const { data: remaining } = await db.rpc("free_lookups_remaining", {
    p_email: user.email,
  });
  const freeRemaining = typeof remaining === "number" ? remaining : 0;

  // An already-viewed property stays viewable — re-opening a report you have
  // already spent your free lookup on should not consume another one, and
  // should not be blocked.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: priorLookup } = await db
    .from("lookups")
    .select("id")
    .eq("bbl", bbl)
    .ilike("email", user.email)
    .gte("created_at", since)
    .maybeSingle();

  if (priorLookup) {
    return {
      entitlement: "free",
      canViewFullReport: true,
      email: user.email,
      accountId: user.id,
      freeRemaining,
      reason: "You already used a free lookup on this property.",
    };
  }

  if (freeRemaining > 0) {
    return {
      entitlement: "free",
      canViewFullReport: true,
      email: user.email,
      accountId: user.id,
      freeRemaining,
      reason: "Using your free monthly lookup.",
    };
  }

  return {
    entitlement: "anonymous",
    canViewFullReport: false,
    email: user.email,
    accountId: user.id,
    freeRemaining: 0,
    reason: "You have used your free lookup for this 30-day period.",
  };
}

/**
 * Record a lookup. Also what enforces the free-tier limit, so it must be called
 * exactly once per full report view — and never for a teaser.
 *
 * Returns false only when a free-tier claim was requested but lost a race to a
 * concurrent claim for the same email (see `claim_free_lookup`) — the caller
 * must not render the full report in that case, since the grant it was
 * counting on has just been taken by the other request.
 */
export async function recordLookup(params: {
  bbl: string;
  address: string | null;
  decision: AccessDecision;
}): Promise<boolean> {
  const { bbl, address, decision } = params;
  if (!hasServiceRole() || !decision.canViewFullReport) return true;

  // Re-viewing a property already counted must not burn another lookup.
  if (decision.reason.startsWith("You already used")) return true;

  // Subscription and single-purchase grants aren't rate-limited, so there is
  // nothing to race — record them with a plain insert.
  if (decision.entitlement !== "free") {
    const { error } = await supabaseService().from("lookups").insert({
      account_id: decision.accountId,
      email: decision.email,
      bbl,
      address,
      entitlement: decision.entitlement,
    });
    if (error) console.error("could not record lookup", error.message);
    return true;
  }

  // Free tier: the check (resolveAccess) and the claim happen in separate
  // requests, so two concurrent first-views could otherwise both observe an
  // unused lookup. `claim_free_lookup` folds the check and insert into one
  // atomic, per-email-locked statement.
  const { data: claimed, error } = await supabaseService().rpc("claim_free_lookup", {
    p_email: decision.email,
    p_bbl: bbl,
    p_address: address,
    p_account_id: decision.accountId,
  });

  if (error) {
    console.error("could not claim free lookup", error.message);
    return true;
  }

  return Boolean(claimed);
}
