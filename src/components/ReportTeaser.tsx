import Link from "next/link";
import type { ViolationReport } from "@/lib/nyc/types";
import { formatAgencyList } from "@/lib/nyc/classify";
import { Disclaimer, formatDataAsOf } from "./Disclaimer";
import { Notice } from "./ui/Notice";
import { StatCard } from "./ui/StatCard";
import { buttonClass } from "./ui/styles";

/**
 * The gated view (Flow A step 2, Flow B1).
 *
 * Shows genuine headline counts — enough to prove the report is real and
 * establish whether there is anything to worry about — while withholding the
 * per-violation detail that makes it actionable.
 */

const INCLUDED = [
  "Every violation by agency, with issue date, status and severity class",
  "Outstanding balances and docketed judgments, itemised",
  "PDF export and a shareable read-only link",
];

function Check() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-0.5 size-4 shrink-0 text-accent"
    >
      <path d="m3 8.5 3.5 3.5L13 5" />
    </svg>
  );
}

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
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          {property.address ?? `Block ${property.block}, Lot ${property.lot}`}
        </h1>
        <p className="mt-1.5 text-sm text-ink-body">
          {property.borough}
          {property.zip && ` ${property.zip}`} · BBL{" "}
          <span className="font-mono">{property.bbl}</span>
        </p>
        <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-body">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
          Data as of {formatDataAsOf(report.dataAsOf)}
        </p>
      </header>

      {/* Deliberately un-toned, unlike the full report's cards: colouring a
          non-zero balance or judgment count here would answer the question the
          report is being sold to answer. */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Open violations"
          value={summary.openViolations.toLocaleString()}
        />
        <StatCard label="Total on record" value={summary.totalViolations.toLocaleString()} />
        <StatCard
          label="Outstanding balance"
          value={summary.totalBalanceDue.toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
          })}
        />
        <StatCard
          label="Docketed judgments"
          value={summary.docketedJudgments.toLocaleString()}
        />
      </div>

      {/* The teaser sells on these counts, so an outage that suppresses them
          has to be disclosed here too — not only behind the paywall. */}
      {report.unavailableSources.length > 0 && (
        <Notice tone="critical" role="alert" className="mt-5">
          <strong className="font-semibold">
            {formatAgencyList(report.unavailableSources)} data could not be
            retrieved.
          </strong>{" "}
          These counts are incomplete. Reload in a few minutes for a full picture.
        </Notice>
      )}

      <section className="mt-8 rounded-2xl border border-line-strong bg-surface p-6">
        <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
          Preview
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">
          Unlock the full report
        </h2>
        <p className="mt-1 text-sm text-ink-body">{reason}</p>

        <ul className="mt-4 space-y-2">
          {INCLUDED.map((item) => (
            <li key={item} className="flex gap-2.5 text-sm text-ink-body">
              <Check />
              {item}
            </li>
          ))}
        </ul>

        {!signedIn ? (
          <div className="mt-6">
            <Link
              href={`/login?next=/report/${property.bbl}`}
              className={buttonClass({ variant: "accent", size: "lg" })}
            >
              Get your free report
            </Link>
            <p className="mt-2 text-xs text-ink-muted">
              One free report per email every 30 days. No card required.
            </p>
          </div>
        ) : (
          // Both paid paths side by side (Flow B1 step 2) — the one-time option
          // exists for someone mid-transaction who cannot wait 30 days.
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <form action="/api/checkout/single" method="post">
              <input type="hidden" name="bbl" value={property.bbl} />
              <button
                type="submit"
                className={buttonClass({
                  variant: "outline",
                  size: "lg",
                  full: true,
                  className: "flex-col items-start gap-0.5",
                })}
              >
                <span className="font-semibold">$49 — this report</span>
                <span className="text-xs font-normal text-ink-muted">
                  One-time. PDF and shareable link included.
                </span>
              </button>
            </form>
            <form action="/api/checkout/subscription" method="post">
              <button
                type="submit"
                className={buttonClass({
                  variant: "accent",
                  size: "lg",
                  full: true,
                  className: "flex-col items-start gap-0.5",
                })}
              >
                <span className="font-semibold">$199/mo — unlimited</span>
                <span className="text-xs font-normal opacity-80">
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
