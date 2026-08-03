import Link from "next/link";
import { stripe, isStripeConfigured } from "@/lib/stripe/client";
import { supabaseService, hasServiceRole } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Purchase complete · ViolationRadar" };

/**
 * Post-purchase landing for the one-time $49 tier.
 *
 * The webhook is the source of truth and may not have landed yet, so this page
 * reads the purchase row and degrades gracefully rather than asserting the
 * payment succeeded on the strength of a redirect.
 */
export default async function PurchaseCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id: sessionId } = await searchParams;

  let shareToken: string | null = null;
  let bbl: string | null = null;
  let pending = true;

  if (sessionId && isStripeConfigured() && hasServiceRole()) {
    try {
      const session = await stripe().checkout.sessions.retrieve(sessionId);
      bbl = session.metadata?.bbl ?? null;

      const { data: purchase } = await supabaseService()
        .from("single_report_purchases")
        .select("status, report_id")
        .eq("stripe_session_id", sessionId)
        .maybeSingle();

      if (purchase?.status === "paid") {
        pending = false;
        if (purchase.report_id) {
          const { data: report } = await supabaseService()
            .from("reports")
            .select("token")
            .eq("id", purchase.report_id)
            .maybeSingle();
          shareToken = report?.token ?? null;
        }
      }
    } catch (err) {
      console.error("could not load purchase", err);
    }
  }

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-20">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
        {pending ? "Finishing your purchase…" : "Your report is ready"}
      </h1>

      {pending ? (
        <p className="mt-3 text-slate-600 dark:text-slate-400">
          Payment confirmations can take a few seconds to arrive. Refresh this
          page shortly — a link to your report will appear here, and we&apos;ll
          email it to you as well.
        </p>
      ) : (
        <>
          <p className="mt-3 text-slate-600 dark:text-slate-400">
            Thanks. Your full report is available at the link below. Bookmark it —
            it stays accessible without an account.
          </p>
          {shareToken ? (
            <Link
              href={`/r/${shareToken}`}
              className="mt-6 inline-block rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
            >
              Open your report
            </Link>
          ) : bbl ? (
            <Link
              href={`/report/${bbl}`}
              className="mt-6 inline-block rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
            >
              Open your report
            </Link>
          ) : null}
        </>
      )}

      {/* Post-purchase upsell (Flow B1 step 4). */}
      <section className="mt-10 rounded-lg border border-slate-200 p-5 dark:border-slate-700">
        <h2 className="font-semibold text-slate-900 dark:text-slate-100">
          Checking more than one address this month?
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Unlimited lookups, PDF export and shareable links are $199/month.
        </p>
        <form action="/api/checkout/subscription" method="post" className="mt-3">
          <button
            type="submit"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Switch to unlimited
          </button>
        </form>
      </section>
    </main>
  );
}
