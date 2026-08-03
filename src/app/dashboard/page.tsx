import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/session";
import { supabaseService, hasServiceRole } from "@/lib/supabase/server";
import { SearchBox } from "@/components/SearchBox";
import { Badge } from "@/components/ui/Badge";
import { buttonClass, cardClass, focusRingInset } from "@/components/ui/styles";

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
    <main id="main" className="mx-auto w-full max-w-4xl px-6 py-12">
      <div
        className={cardClass({
          className: "flex flex-wrap items-center justify-between gap-4 p-5",
        })}
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Dashboard</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-body">
            {user.email}
            {subscribed ? (
              <>
                <Badge tone="accent">Unlimited lookups</Badge>
                {account?.current_period_end && (
                  <span className="text-ink-muted">
                    renews{" "}
                    {new Date(account.current_period_end).toLocaleDateString("en-US")}
                  </span>
                )}
              </>
            ) : (
              <Badge tone="accent">
                Free tier · {freeRemaining} lookup{freeRemaining === 1 ? "" : "s"} left
              </Badge>
            )}
          </p>
        </div>

        {subscribed ? (
          <form action="/api/billing/portal" method="post">
            <button type="submit" className={buttonClass({ variant: "outline" })}>
              Manage billing
            </button>
          </form>
        ) : (
          <form action="/api/checkout/subscription" method="post">
            <button type="submit" className={buttonClass({ variant: "accent" })}>
              Upgrade — $199/mo
            </button>
          </form>
        )}
      </div>

      <div className="mt-8">
        <SearchBox />
      </div>

      <section className="mt-12">
        <h2 className="text-lg font-semibold tracking-tight text-ink">Recent lookups</h2>
        {lookups.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">
            Nothing yet. Search an address above to run your first report.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {lookups.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/report/${l.bbl}`}
                  className={`flex items-center justify-between gap-4 px-4 py-3.5 motion-safe:transition-colors hover:bg-sunken ${focusRingInset}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">
                      {l.address ?? `BBL ${l.bbl}`}
                    </span>
                    <span className="block font-mono text-sm text-ink-muted">
                      {l.bbl}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-ink-muted">
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
