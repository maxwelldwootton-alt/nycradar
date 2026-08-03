import type { AgencySection, NormalizedViolation, ViolationReport } from "@/lib/nyc/types";
import { severityLabel } from "@/lib/nyc/classify";
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
      </td>
      <td className="py-2.5 text-right whitespace-nowrap tabular-nums text-ink">
        {v.balanceDue ? money(v.balanceDue) : "—"}
      </td>
    </tr>
  );
}

function AgencyBlock({ section }: { section: AgencySection }) {
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
          {/* Bleeds to the viewport edge on phones, so a wide table scrolls in
              its own right rather than being clipped inside the page gutter. */}
          <div className="mt-3 -mx-6 overflow-x-auto px-6 sm:mx-0 sm:px-0">
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
                {section.violations.slice(0, 100).map((v) => (
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
