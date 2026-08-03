import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase/session";
import { ensureAccount, loginRedirect, safeNextPath } from "@/lib/auth/magic-link";

/**
 * Magic-link landing (PKCE flow).
 *
 * Superseded by `/auth/confirm`, which the email templates now point at. This
 * route stays because links minted before that switch are still sitting in
 * inboxes and stay valid for a while — removing it would break them.
 *
 * Note the failure mode this route is prone to, and why we moved off it: the
 * PKCE code verifier lives in a cookie belonging to the browser that requested
 * the link, so opening the email in a different browser fails the exchange
 * locally, without ever reaching Supabase.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));

  if (!code) {
    return loginRedirect(url.origin, next, "missing_code");
  }

  const supabase = await supabaseSession();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user?.email) {
    console.error("magic link code exchange failed", {
      code: error?.code,
      status: error?.status,
      message: error?.message,
    });
    return loginRedirect(url.origin, next, error?.code ?? "invalid_link");
  }

  await ensureAccount(data.user.id, data.user.email);

  return NextResponse.redirect(new URL(next, url.origin));
}
