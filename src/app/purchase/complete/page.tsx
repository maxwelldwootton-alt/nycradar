import Link from "next/link";
import { stripe, isStripeConfigured } from "@/lib/stripe/client";
import { supabaseService, hasServiceRole } from "@/lib/supabase/server";
import { buttonClass, cardClass } from "@/components/ui/styles";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Purchase complete · ViolationRadar",
  alternates: { canonical: "/purchase/complete" },
};

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
    <main id="main" className="mx-auto w-full max-w-xl px-6 py-20">
      <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-ink">
        {pending && (
          // The webhook is the source of truth and may not have landed; the dot
          // is what says "still working" rather than "stuck".
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 animate-pulse rounded-full bg-accent"
          />
        )}
        {pending ? "Finishing your purchase…" : "Your report is ready"}
      </h1>

      {pending ? (
        <p className="mt-3 text-ink-body">
          Payment confirmations can take a few seconds to arrive. Refresh this
          page shortly — a link to your report will appear here, and we&apos;ll
          email it to you as well.
        </p>
      ) : (
        <>
          <p className="mt-3 text-ink-body">
            Thanks. Your full report is available at the link below. Bookmark it —
            it stays accessible without an account.
          </p>
          {shareToken ? (
            <Link
              href={`/r/${shareToken}`}
              className={buttonClass({ variant: "accent", size: "lg", className: "mt-6" })}
            >
              Open your report
            </Link>
          ) : bbl ? (
            <Link
              href={`/report/${bbl}`}
              className={buttonClass({ variant: "accent", size: "lg", className: "mt-6" })}
            >
              Open your report
            </Link>
          ) : null}
        </>
      )}

      {/* Post-purchase upsell (Flow B1 step 4). */}
      <section className={cardClass({ className: "mt-10 p-5" })}>
        <h2 className="font-semibold text-ink">
          Checking more than one address this month?
        </h2>
        <p className="mt-1 text-sm text-ink-body">
          Unlimited lookups, PDF export and shareable links are $199/month.
        </p>
        <form action="/api/checkout/subscription" method="post" className="mt-3">
          <button type="submit" className={buttonClass({ variant: "outline" })}>
            Switch to unlimited
          </button>
        </form>
      </section>
    </main>
  );
}
