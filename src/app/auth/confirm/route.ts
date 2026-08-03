import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseSession } from "@/lib/supabase/session";
import { ensureAccount, loginRedirect, safeNextPath } from "@/lib/auth/magic-link";

/**
 * Magic-link landing (token hash flow) — the destination our email templates
 * point at.
 *
 * This replaces the PKCE `?code=` exchange for emailed links. PKCE stores a
 * code verifier in a cookie belonging to the browser that *requested* the
 * link, so opening the email anywhere else — iOS Mail's in-app browser, a
 * desktop after requesting on a phone — cannot complete the exchange. It fails
 * client-side without even reaching Supabase, which is exactly the dead-end a
 * user hit in production.
 *
 * A token hash carries no such dependency: it is verified server-side against
 * Supabase, so the link works from any browser. It remains single-use and
 * short-lived, which is what keeps that safe.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  // Magic Link emails send `email`; first-time signups come through the
  // Confirm Signup template as `signup`. Trust the template and default to the
  // common case.
  const type = (url.searchParams.get("type") ?? "email") as EmailOtpType;
  // Present only while the email templates still use `{{ .ConfirmationURL }}`.
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));

  if (!tokenHash && !code) {
    return loginRedirect(url.origin, next, "missing_token");
  }

  const supabase = await supabaseSession();

  // Accepting both shapes keeps the code change and the dashboard template
  // change order-independent. Sign-in now points here, but an un-updated
  // template still appends `?code=`; without this fallback, deploying before
  // editing the templates would break sign-in outright rather than leaving it
  // on the older, less robust path.
  const { data, error } = tokenHash
    ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    : await supabase.auth.exchangeCodeForSession(code!);

  if (error || !data.user?.email) {
    // Logged because a silently-swallowed error here previously left no trace
    // of why a sign-in failed.
    console.error("magic link verification failed", {
      method: tokenHash ? "token_hash" : "pkce_code",
      code: error?.code,
      status: error?.status,
      message: error?.message,
      type,
    });
    return loginRedirect(url.origin, next, error?.code ?? "invalid_link");
  }

  await ensureAccount(data.user.id, data.user.email);

  return NextResponse.redirect(new URL(next, url.origin));
}
