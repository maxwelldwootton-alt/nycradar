/**
 * The headline figures at the top of a report.
 *
 * Extracted from ReportView, which defined it privately while ReportTeaser
 * carried a second copy inline — the two had already drifted (the teaser's
 * tiles had no emphasis state at all, so a property with a docketed judgment
 * looked identical to a clean one until you paid).
 */

import type { Tone } from "./severity";

const TONES: Record<Tone, { frame: string; value: string }> = {
  neutral: { frame: "border-line bg-surface", value: "text-ink" },
  caution: {
    frame: "border-caution-line/70 bg-caution-soft",
    value: "text-caution",
  },
  critical: {
    frame: "border-critical-line/70 bg-critical-soft",
    value: "text-critical",
  },
};

export function StatCard({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  tone?: Tone;
  hint?: string;
}) {
  const styles = TONES[tone];

  return (
    <div className={`rounded-xl border p-4 ${styles.frame}`}>
      <div className="text-xs font-medium tracking-wide text-ink-muted uppercase">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${styles.value}`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-ink-muted">{hint}</div>}
    </div>
  );
}
