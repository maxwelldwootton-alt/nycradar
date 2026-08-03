import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase/session";
import { supabaseService, hasServiceRole } from "@/lib/supabase/server";

/**
 * Magic-link landing. Exchanges the code for a session and ensures an
 * `accounts` row exists, which is what billing and lookup history hang off.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  // Only allow same-origin redirects — `next` comes from the URL.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", url.origin));
  }

  const supabase = await supabaseSession();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user?.email) {
    return NextResponse.redirect(new URL("/login?error=invalid_link", url.origin));
  }

  if (hasServiceRole()) {
    const { error: upsertError } = await supabaseService()
      .from("accounts")
      .upsert(
        { id: data.user.id, email: data.user.email },
        { onConflict: "id", ignoreDuplicates: true },
      );
    // A failure here must not block sign-in; the row is created lazily
    // elsewhere if needed.
    if (upsertError) console.error("account upsert failed", upsertError.message);
  }

  return NextResponse.redirect(new URL(safeNext, url.origin));
}
