/**
 * Shared plumbing for the two magic-link landing routes.
 *
 * Both `/auth/confirm` (token hash — the flow the email templates use) and
 * `/auth/callback` (PKCE — kept for links already sitting in inboxes) need the
 * same three things, and getting any of them wrong is what made a failed
 * sign-in look like a dead link.
 */

import "server-only";
import { NextResponse } from "next/server";
import { supabaseService, hasServiceRole } from "@/lib/supabase/server";

export { safeNextPath } from "./next-path";

/**
 * Send the user back to sign in **without losing where they were going**.
 *
 * Dropping `next` here is what stranded a user who had asked for a specific
 * report: the retry started from a bare `/login`, so the second (successful)
 * link delivered them to the homepage instead of the report they wanted.
 */
export function loginRedirect(
  origin: string,
  next: string,
  reason: string,
): NextResponse {
  const target = new URL("/login", origin);
  if (next !== "/") target.searchParams.set("next", next);
  target.searchParams.set("error", reason);
  return NextResponse.redirect(target);
}

/**
 * Ensure the signed-in user has an `accounts` row — billing state and lookup
 * history both hang off it.
 *
 * Never throws: the user has already authenticated by this point, so failing
 * the sign-in over a bookkeeping row would be the wrong trade. The row is
 * created lazily elsewhere if this misses.
 */
export async function ensureAccount(id: string, email: string): Promise<void> {
  if (!hasServiceRole()) return;

  const { error } = await supabaseService()
    .from("accounts")
    .upsert({ id, email }, { onConflict: "id", ignoreDuplicates: true });

  if (error) console.error("account upsert failed", error.message);
}
