/**
 * Sign out.
 *
 * POST-only and deliberately so: a GET route here would let any third-party
 * page log a visitor out with an `<img src>`, and would be followed by link
 * prefetchers. The dashboard posts a form to it.
 */

import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase/session";

export async function POST(request: Request) {
  const supabase = await supabaseSession();
  await supabase.auth.signOut();

  // 303 so the browser follows with GET rather than re-POSTing to `/`.
  return NextResponse.redirect(new URL("/", request.url), 303);
}
