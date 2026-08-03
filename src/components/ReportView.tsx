import type { AgencySection, NormalizedViolation, ViolationReport } from "@/lib/nyc/types";
import { severityLabel } from "@/lib/nyc/classify";
import { Disclaimer, formatDataAsOf } from "./Disclaimer";

const AGENCY_LABELS: Record<string, string> = {
  DOB: "Department of Buildings",
  HPD: "Housing Preservation & Development",
  ECB: "ECB / OATH summonses (DOB-issued)",
  OATH: "OATH hearings (other agencies)",
};

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function StatCard({
  label,
  value,
  emphasis,
  hint,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  hint?: string;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        emphasis
          ? "border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30"
          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
      }`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          emphasis
            ? "text-amber-900 dark:text-amber-200"
            : "text-slate-900 dark:text-slate-100"
        }`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
    </div>
  );
}

function ViolationRow({ v }: { v: NormalizedViolation }) {
  const label = severityLabel(v.agency, v.severity);
  return (
    <tr className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800">
      <td className="py-2 pr-4 whitespace-nowrap">
        <span
          className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
            v.status === "open"
              ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
          }`}
        >
          {v.status === "open" ? "Open" : v.status === "closed" ? "Closed" : "Unknown"}
        </span>
      </td>
      <td className="py-2 pr-4 whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-400">
        {v.issuedDate ?? "—"}
      </td>
      <td className="py-2 pr-4 text-slate-600 dark:text-slate-400">{label ?? "—"}</td>
      <td className="py-2 pr-4 text-slate-800 dark:text-slate-200">
        {v.description ?? "—"}
        {v.judgmentDocketed && (
          <span className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-300">
            Judgment docketed {v.judgmentDocketed}
          </span>
        )}
        {v.correctionType !== "unknown" && (
          <span className="ml-2 text-xs text-slate-500 dark:text-slate-500">
            ({v.correctionType === "administrative" ? "paperwork" : "physical correction"})
          </span>
        )}
      </td>
      <td className="py-2 text-right whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-300">
        {v.balanceDue ? money(v.balanceDue) : "—"}
      </td>
    </tr>
  );
}

function AgencyBlock({ section }: { section: AgencySection }) {
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-2 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {AGENCY_LABELS[section.agency] ?? section.agency}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          <strong className="tabular-nums">{section.open.toLocaleString()}</strong> open of{" "}
          <span className="tabular-nums">{section.total.toLocaleString()}</span> total
          {section.balanceDue > 0 && <> · {money(section.balanceDue)} outstanding</>}
          {section.recoveredByBin && (
            <> · matched by building ID</>
          )}
        </p>
      </div>

      {section.total === 0 ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          No records found for this property.
        </p>
      ) : (
        <>
          {section.truncated && (
            <p className="mt-3 rounded bg-slate-100 p-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              Showing the {section.violations.length.toLocaleString()} most relevant of{" "}
              {section.total.toLocaleString()} records. Counts above reflect the full total.
            </p>
          )}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
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
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Showing the first 100 of {section.violations.length.toLocaleString()} listed records.
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
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {property.address ?? `Block ${property.block}, Lot ${property.lot}`}
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {property.borough}
          {property.zip && ` ${property.zip}`} · BBL {property.bbl}
          {property.isCondoBillingLot && " · condominium billing lot"}
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
          Data as of {formatDataAsOf(report.dataAsOf)}
        </p>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Open violations" value={summary.openViolations.toLocaleString()} />
        <StatCard label="Total on record" value={summary.totalViolations.toLocaleString()} />
        <StatCard
          label="Outstanding balance"
          value={money(summary.totalBalanceDue)}
          emphasis={summary.totalBalanceDue > 0}
        />
        <StatCard
          label="Docketed judgments"
          value={summary.docketedJudgments.toLocaleString()}
          emphasis={summary.docketedJudgments > 0}
          hint={summary.docketedJudgments > 0 ? "May attach as a lien" : undefined}
        />
      </div>

      {report.warnings.length > 0 && (
        <ul className="mt-5 space-y-2">
          {report.warnings.map((w) => (
            <li
              key={w}
              className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200"
            >
              {w}
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
