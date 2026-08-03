import Link from "next/link";
import type { ViolationReport } from "@/lib/nyc/types";
import { Disclaimer, formatDataAsOf } from "./Disclaimer";

/**
 * The gated view (Flow A step 2, Flow B1).
 *
 * Shows genuine headline counts — enough to prove the report is real and
 * establish whether there is anything to worry about — while withholding the
 * per-violation detail that makes it actionable.
 */
export function ReportTeaser({
  report,
  reason,
  signedIn,
}: {
  report: ViolationReport;
  reason: string;
  signedIn: boolean;
}) {
  const { property, summary } = report;

  return (
    <article>
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {property.address ?? `Block ${property.block}, Lot ${property.lot}`}
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {property.borough}
          {property.zip && ` ${property.zip}`} · BBL {property.bbl}
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
          Data as of {formatDataAsOf(report.dataAsOf)}
        </p>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Open violations", value: summary.openViolations.toLocaleString() },
          { label: "Total on record", value: summary.totalViolations.toLocaleString() },
          {
            label: "Outstanding balance",
            value: summary.totalBalanceDue.toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
            }),
          },
          { label: "Docketed judgments", value: summary.docketedJudgments.toLocaleString() },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {s.label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <section className="mt-8 rounded-xl border border-slate-300 bg-slate-50 p-6 dark:border-slate-600 dark:bg-slate-900/60">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Unlock the full report
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{reason}</p>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
          The full report lists every violation by agency with issue dates, status,
          severity, outstanding balances and docketed judgments — plus PDF export
          and a shareable link.
        </p>

        {!signedIn ? (
          <div className="mt-5">
            <Link
              href={`/login?next=/report/${property.bbl}`}
              className="inline-block rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              Get your free report
            </Link>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-500">
              One free report per email every 30 days. No card required.
            </p>
          </div>
        ) : (
          // Both paid paths side by side (Flow B1 step 2) — the one-time option
          // exists for someone mid-transaction who cannot wait 30 days.
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <form action="/api/checkout/single" method="post">
              <input type="hidden" name="bbl" value={property.bbl} />
              <button
                type="submit"
                className="w-full rounded-lg border border-slate-300 px-5 py-3 text-left hover:bg-white dark:border-slate-600 dark:hover:bg-slate-800"
              >
                <span className="block font-semibold text-slate-900 dark:text-slate-100">
                  $49 — this report
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  One-time. PDF and shareable link included.
                </span>
              </button>
            </form>
            <form action="/api/checkout/subscription" method="post">
              <button
                type="submit"
                className="w-full rounded-lg bg-slate-900 px-5 py-3 text-left text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                <span className="block font-semibold">$199/mo — unlimited</span>
                <span className="block text-xs opacity-80">
                  Every property, no limits. Cancel anytime.
                </span>
              </button>
            </form>
          </div>
        )}
      </section>

      <Disclaimer dataAsOf={report.dataAsOf} />
    </article>
  );
}
