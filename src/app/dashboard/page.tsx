import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/session";
import { supabaseService, hasServiceRole } from "@/lib/supabase/server";
import { SearchBox } from "@/components/SearchBox";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard · ViolationRadar" };

const ACTIVE = new Set(["active", "trialing", "past_due"]);

interface LookupRow {
  id: number;
  bbl: string;
  address: string | null;
  created_at: string;
  entitlement: string;
}

/** Subscriber dashboard: search, lookup history, report re-access (FR8). */
export default async function DashboardPage() {
  const user = await currentUser().catch(() => null);
  if (!user) redirect("/login?next=/dashboard");

  let account: { subscription_status: string | null; current_period_end: string | null } | null =
    null;
  let lookups: LookupRow[] = [];
  let freeRemaining = 0;

  if (hasServiceRole()) {
    const db = supabaseService();

    const [{ data: acct }, { data: history }, { data: remaining }] = await Promise.all([
      db
        .from("accounts")
        .select("subscription_status, current_period_end")
        .eq("id", user.id)
        .maybeSingle(),
      db
        .from("lookups")
        .select("id, bbl, address, created_at, entitlement")
        .eq("account_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
      db.rpc("free_lookups_remaining", { p_email: user.email }),
    ]);

    account = acct ?? null;
    lookups = (history ?? []) as LookupRow[];
    freeRemaining = typeof remaining === "number" ? remaining : 0;
  }

  const subscribed = Boolean(
    account?.subscription_status && ACTIVE.has(account.subscription_status),
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {user.email}
            {" · "}
            {subscribed ? (
              <>
                Unlimited lookups
                {account?.current_period_end &&
                  ` · renews ${new Date(account.current_period_end).toLocaleDateString("en-US")}`}
              </>
            ) : (
              <>
                Free tier · {freeRemaining} lookup{freeRemaining === 1 ? "" : "s"}{" "}
                remaining this period
              </>
            )}
          </p>
        </div>

        {subscribed ? (
          <form action="/api/billing/portal" method="post">
            <button
              type="submit"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Manage billing
            </button>
          </form>
        ) : (
          <form action="/api/checkout/subscription" method="post">
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
            >
              Upgrade — $199/mo
            </button>
          </form>
        )}
      </div>

      <div className="mt-8">
        <SearchBox />
      </div>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Recent lookups
        </h2>
        {lookups.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Nothing yet. Search an address above to run your first report.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
            {lookups.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/report/${l.bbl}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <span>
                    <span className="block font-medium text-slate-900 dark:text-slate-100">
                      {l.address ?? `BBL ${l.bbl}`}
                    </span>
                    <span className="block text-sm text-slate-500 dark:text-slate-400">
                      BBL {l.bbl}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">
                    {new Date(l.created_at).toLocaleDateString("en-US")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
