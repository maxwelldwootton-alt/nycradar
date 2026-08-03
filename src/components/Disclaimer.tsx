/**
 * Required on every report surface — screen, PDF, and shared link (FR7, §10).
 *
 * The wording deliberately avoids any implication of certification, guarantee,
 * or completeness, and states the data-as-of date so freshness expectations are
 * explicit. Per PRD §12 this language should be reviewed by a real estate
 * attorney before public launch; treat it as provisional until that happens.
 */

export function formatDataAsOf(iso: string | null): string {
  if (!iso) return "date unavailable";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

export function Disclaimer({ dataAsOf }: { dataAsOf: string | null }) {
  return (
    <section
      aria-label="Important information about this report"
      className="mt-10 rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400"
    >
      <h2 className="mb-2 font-semibold text-slate-700 dark:text-slate-300">
        Important information
      </h2>
      <p>
        This report is compiled from public New York City Open Data records
        published by the Department of Buildings, Housing Preservation &amp;
        Development, and the Office of Administrative Trials and Hearings, as of{" "}
        <strong>{formatDataAsOf(dataAsOf)}</strong>. City systems are updated on
        their own schedules and this report may not reflect very recent activity.
      </p>
      <p className="mt-3">
        This report is informational only. It does not constitute legal advice,
        is not a title search, and should not be the sole basis for a real estate
        transaction decision. Verify any finding that matters to your transaction
        independently or through a licensed professional before relying on it at
        closing.
      </p>
    </section>
  );
}
