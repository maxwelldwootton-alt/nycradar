import type { AgencySection, NormalizedViolation, ViolationReport } from "@/lib/nyc/types";
import { formatAgencyList, severityLabel } from "@/lib/nyc/classify";
import { sourceLink } from "@/lib/nyc/source-links";
import { Disclaimer, formatDataAsOf } from "./Disclaimer";
import { Badge } from "./ui/Badge";
import { Notice } from "./ui/Notice";
import { StatCard } from "./ui/StatCard";
import { severityTone } from "./ui/severity";

const AGENCY_LABELS: Record<string, string> = {
  DOB: "Department of Buildings",
  HPD: "Housing Preservation & Development",
  ECB: "ECB / OATH summonses (DOB-issued)",
  OATH: "OATH hearings (other agencies)",
};

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function statusLabel(status: NormalizedViolation["status"]): string {
  return status === "open" ? "Open" : status === "closed" ? "Closed" : "Unknown";
}

function correctionNote(correctionType: NormalizedViolation["correctionType"]): string | null {
  if (correctionType === "unknown") return null;
  return correctionType === "administrative" ? "paperwork" : "physical correction";
}

/**
 * The phone presentation of a violation.
 *
 * The table below needs 44rem to lay out five columns and forces a horizontal
 * scroll on a 390px screen — which on a due-diligence document means the
 * balance column, the one a reader is looking for, sits off-screen by default.
 * Same data, stacked.
 */
/**
 * Link out to the city's own record for this violation.
 *
 * Renders nothing at all when the source's URL pattern has not been verified
 * against a live record — see `source-links.ts`. On a due-diligence report a
 * dead link is worse than no link, so the absent state is the safe default and
 * every row currently takes it.
 *
 * `rel="noopener"` because these open in a new tab: the reader is mid-report
 * and shouldn't lose it to a city portal. `noreferrer` is deliberately not
 * set — passing the referrer is harmless here and some city portals behave
 * badly without one.
 */
function SourceRecordLink({ v, className = "" }: { v: NormalizedViolation; className?: string }) {
  const link = sourceLink(v);
  if (!link) return null;

  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener"
      className={`inline-block text-accent underline underline-offset-2 hover:no-underline ${className}`}
    >
      {link.label} <span aria-hidden="true">↗</span>
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function ViolationCard({ v }: { v: NormalizedViolation }) {
  const label = severityLabel(v.agency, v.severity);
  const note = correctionNote(v.correctionType);

  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <Badge tone={v.status === "open" ? "critical" : "neutral"}>
          {statusLabel(v.status)}
        </Badge>
        <span className="shrink-0 text-sm font-medium tabular-nums text-ink">
          {v.balanceDue ? money(v.balanceDue) : "—"}
        </span>
      </div>

      <p className="mt-2.5 text-sm leading-relaxed text-ink">{v.description ?? "—"}</p>

      {(label || v.judgmentDocketed) && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {label && <Badge tone={severityTone(v.agency, v.severity)}>{label}</Badge>}
          {v.judgmentDocketed && (
            <Badge tone="caution">Judgment docketed {v.judgmentDocketed}</Badge>
          )}
        </div>
      )}

      <p className="mt-2.5 text-xs text-ink-muted">
        Issued {v.issuedDate ?? "date unavailable"}
        {note && ` · ${note}`}
      </p>

      <SourceRecordLink v={v} className="mt-2.5 text-xs" />
    </li>
  );
}

function ViolationRow({ v }: { v: NormalizedViolation }) {
  const label = severityLabel(v.agency, v.severity);
  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="py-2.5 pr-4 whitespace-nowrap">
        <Badge tone={v.status === "open" ? "critical" : "neutral"}>
          {v.status === "open" ? "Open" : v.status === "closed" ? "Closed" : "Unknown"}
        </Badge>
      </td>
      <td className="py-2.5 pr-4 whitespace-nowrap tabular-nums text-ink-muted">
        {v.issuedDate ?? "—"}
      </td>
      <td className="py-2.5 pr-4">
        {label ? (
          // The class carries real weight — HPD C and ECB 1 are "immediately
          // hazardous" — and used to render as the same grey as everything else.
          <Badge tone={severityTone(v.agency, v.severity)}>{label}</Badge>
        ) : (
          <span className="text-ink-muted">—</span>
        )}
      </td>
      <td className="py-2.5 pr-4 text-ink">
        {v.description ?? "—"}
        {v.judgmentDocketed && (
          <Badge tone="caution" className="ml-2">
            Judgment docketed {v.judgmentDocketed}
          </Badge>
        )}
        {v.correctionType !== "unknown" && (
          <span className="ml-2 text-xs text-ink-muted">
            ({v.correctionType === "administrative" ? "paperwork" : "physical correction"})
          </span>
        )}
        <SourceRecordLink v={v} className="ml-2 text-xs" />
      </td>
      <td className="py-2.5 text-right whitespace-nowrap tabular-nums text-ink">
        {v.balanceDue ? money(v.balanceDue) : "—"}
      </td>
    </tr>
  );
}

function AgencyBlock({ section }: { section: AgencySection }) {
  // Hoisted so the card list, the table and the "showing the first 100" note
  // below can't disagree about how many rows were actually rendered.
  const rows = section.violations.slice(0, 100);

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
        <h2 className="text-lg font-semibold text-ink">
          {AGENCY_LABELS[section.agency] ?? section.agency}
        </h2>
        <p className="text-sm text-ink-body">
          <strong className="tabular-nums text-ink">{section.open.toLocaleString()}</strong>{" "}
          open of <span className="tabular-nums">{section.total.toLocaleString()}</span>{" "}
          total
          {section.balanceDue > 0 && <> · {money(section.balanceDue)} outstanding</>}
          {section.recoveredByBin && <> · matched by building ID</>}
        </p>
      </div>

      {section.total === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">No records found for this property.</p>
      ) : (
        <>
          {section.truncated && (
            <Notice className="mt-3">
              Showing the {section.violations.length.toLocaleString()} most relevant of{" "}
              {section.total.toLocaleString()} records. Counts above reflect the full
              total.
            </Notice>
          )}
          {/* Two presentations of the same rows. Both use `display`, so
              whichever is hidden leaves the accessibility tree entirely and a
              screen reader is never offered the list twice. */}
          <ul className="mt-3 space-y-2 sm:hidden">
            {rows.map((v) => (
              <ViolationCard key={`${v.sourceDataset}-${v.sourceId}`} v={v} />
            ))}
          </ul>

          <div className="mt-3 hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs tracking-wide text-ink-muted uppercase">
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Issued</th>
                  <th className="pb-2 pr-4 font-medium">Class</th>
                  <th className="pb-2 pr-4 font-medium">Description</th>
                  <th className="pb-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <ViolationRow key={`${v.sourceDataset}-${v.sourceId}`} v={v} />
                ))}
              </tbody>
            </table>
          </div>
          {section.violations.length > 100 && (
            <p className="mt-2 text-xs text-ink-muted">
              Showing the first 100 of {section.violations.length.toLocaleString()} listed
              records.
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function ReportView({ report }: { report: ViolationReport }) {
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
          {property.isCondoBillingLot && " · condominium billing lot"}
        </p>
        {/* Promoted out of fine print: which day the city's data was published
            is the report's central freshness claim, not a footnote. */}
        <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-body">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
          Data as of {formatDataAsOf(report.dataAsOf)}
        </p>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Open violations"
          value={summary.openViolations.toLocaleString()}
          tone={summary.openViolations > 0 ? "critical" : "neutral"}
        />
        <StatCard label="Total on record" value={summary.totalViolations.toLocaleString()} />
        <StatCard
          label="Outstanding balance"
          value={money(summary.totalBalanceDue)}
          tone={summary.totalBalanceDue > 0 ? "caution" : "neutral"}
        />
        <StatCard
          label="Docketed judgments"
          value={summary.docketedJudgments.toLocaleString()}
          tone={summary.docketedJudgments > 0 ? "caution" : "neutral"}
          hint={summary.docketedJudgments > 0 ? "May attach as a lien" : undefined}
        />
      </div>

      {/* Above the warnings and at a higher severity: everything else in that
          list qualifies the numbers, this one says the numbers are incomplete. */}
      {report.unavailableSources.length > 0 && (
        <Notice tone="critical" role="alert" className="mt-5">
          <strong className="font-semibold">
            {formatAgencyList(report.unavailableSources)} data could not be
            retrieved.
          </strong>{" "}
          The counts below exclude {report.unavailableSources.length === 1 ? "it" : "them"}{" "}
          and understate what this property may carry. Reload in a few minutes.
        </Notice>
      )}

      {report.warnings.length > 0 && (
        <ul className="mt-5 space-y-2">
          {report.warnings.map((w) => (
            <li key={w}>
              <Notice>{w}</Notice>
            </li>
          ))}
        </ul>
      )}

      {report.sections.map((s) => (
        <AgencyBlock key={s.agency} section={s} />
      ))}

      <Disclaimer dataAsOf={report.dataAsOf} />
    </article>
  );
}
