/**
 * The small status/severity pill used in report tables and search results.
 *
 * Tones map to the app's semantics: critical = open or immediately hazardous,
 * caution = judgments and lesser-but-real severity, neutral = informational.
 * Accent is absent by design — it means "interactive", not "important".
 */

export type BadgeTone = "neutral" | "caution" | "critical" | "accent";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-sunken text-ink-body",
  caution: "bg-caution-soft text-caution ring-1 ring-caution-line/60",
  critical: "bg-critical-soft text-critical ring-1 ring-critical-line/60",
  accent: "bg-accent-soft text-accent",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
