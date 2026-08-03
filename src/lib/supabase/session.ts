/**
 * Request-scoped Supabase client bound to the user's auth cookies.
 *
 * Distinct from `supabaseAnon()` (no user) and `supabaseService()` (bypasses
 * RLS). Use this anywhere the acting identity matters.
 */

import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function supabaseSession() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies; middleware refreshes the
            // session instead, so this is safe to ignore here.
          }
        },
      },
    },
  );
}

/** The signed-in user, or null. Never throws on an expired session. */
export async function currentUser() {
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
