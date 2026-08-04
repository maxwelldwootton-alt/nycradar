/**
 * Server-side Supabase clients.
 *
 * Two distinct clients, deliberately separate:
 *   - `supabaseAnon()` respects row level security and is used for reads of
 *     public reference data (properties).
 *   - `supabaseService()` bypasses RLS and must only ever be constructed in
 *     server code — writing the violation cache, recording lookups, applying
 *     Stripe entitlement.
 */

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`,
    );
  }
  return value;
}

let anonClient: SupabaseClient | null = null;

export function supabaseAnon(): SupabaseClient {
  if (!anonClient) {
    anonClient = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      { auth: { persistSession: false } },
    );
  }
  return anonClient;
}

let serviceClient: SupabaseClient | null = null;

/**
 * Bypasses row level security. Only call from server-side code paths, and only
 * where elevated access is genuinely required.
 */
export function supabaseService(): SupabaseClient {
  if (!serviceClient) {
    serviceClient = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } },
    );
  }
  return serviceClient;
}

/** True when a service-role key is configured; lets features degrade rather than crash. */
export function hasServiceRole(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * True when the anon client can be constructed.
 *
 * Build-time code paths (`generateSitemaps`, static metadata) run wherever the
 * build runs, which may not have Supabase env wired. Callers there check this
 * and return empty rather than letting `requireEnv` fail the whole build.
 */
export function hasAnonConfig(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
