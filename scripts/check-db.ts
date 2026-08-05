/**
 * Deploy gate: does the target database actually have what the app calls?
 *
 *   npm run check:db
 *
 * This exists because "merged" and "deployed" came apart twice, and both times
 * the gap was silent rather than loud:
 *
 *   * `rate_limits` / `sample_properties` were merged and never applied. The
 *     rate limiter fails open by design, so it simply stopped limiting.
 *   * `claim_free_lookup` was merged and never applied. Every free-tier claim
 *     errored, `recordLookup` failed open, nothing was written to `lookups`,
 *     and `free_lookups_remaining` answered 1 forever — an unlimited free tier
 *     that produced no error anyone would ever see.
 *
 * Neither would have been caught by tests, a type check, or a build: the RPC
 * names are string literals, so nothing upstream of the live database knows
 * they are wrong.
 *
 * The check itself lives in SQL (`assert_db_contract`, see the migration of the
 * same name) so it is versioned alongside the schema it describes. This is the
 * thin wrapper that gives it an exit code.
 *
 * Note the bootstrap case: if `assert_db_contract` is *itself* missing, that is
 * a failure too, and the right one — a database too old to describe itself is
 * exactly the state this is looking for.
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });

interface ContractRow {
  object_name: string;
  kind: string;
  present: boolean;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`✗ ${name} is not set. See .env.example.`);
    process.exit(2);
  }
  return value;
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  console.log(`Checking database contract against ${new URL(url).host}…\n`);

  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await db.rpc("assert_db_contract");

  if (error) {
    // Distinguished on purpose: a missing checker and an unreachable database
    // are different problems with different fixes, and collapsing them into
    // one message is how people learn to ignore this output.
    const missingChecker =
      error.code === "PGRST202" ||
      error.code === "42883" ||
      /does not exist|could not find the function/i.test(error.message ?? "");

    if (missingChecker) {
      console.error(
        "✗ assert_db_contract() is missing from this database.\n" +
          "  The database predates the contract check, which means it may also be\n" +
          "  missing objects the app needs. Apply the migrations:\n\n" +
          "      supabase db push\n",
      );
    } else {
      console.error(`✗ Could not run the contract check: ${error.message}`);
    }
    process.exit(1);
  }

  const rows = (data ?? []) as ContractRow[];
  if (rows.length === 0) {
    console.error("✗ Contract check returned nothing — that should be impossible.");
    process.exit(1);
  }

  const missing = rows.filter((r) => !r.present);

  for (const row of rows) {
    console.log(`  ${row.present ? "✓" : "✗"} ${row.kind.padEnd(8)} ${row.object_name}`);
  }

  if (missing.length > 0) {
    console.error(
      `\n✗ ${missing.length} of ${rows.length} required objects are missing:\n` +
        missing.map((m) => `      ${m.kind} ${m.object_name}`).join("\n") +
        "\n\n  The repo and this database have drifted. Apply the migrations:\n\n" +
        "      supabase db push\n",
    );
    process.exit(1);
  }

  console.log(`\n✓ All ${rows.length} required objects present.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
