/**
 * The callout box, which had five ad-hoc implementations across the app
 * (report warnings, the login error, the search's nearby-only caveat, the
 * shared-report banner, the truncation note) with five different paddings.
 *
 * Tone is semantic, not decorative: `caution` means the reader may need to act,
 * `critical` means something failed, `neutral` means context. Accent is absent —
 * in this system it marks things you can click.
 */

export type NoticeTone = "neutral" | "caution" | "critical";

const TONES: Record<NoticeTone, string> = {
  neutral: "border-line bg-sunken text-ink-body",
  caution: "border-caution-line/70 bg-caution-soft text-caution",
  critical: "border-critical-line/70 bg-critical-soft text-critical",
};

export function Notice({
  children,
  tone = "neutral",
  role,
  className = "",
}: {
  children: React.ReactNode;
  tone?: NoticeTone;
  role?: "status" | "alert";
  className?: string;
}) {
  return (
    <div
      role={role}
      className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${TONES[tone]} ${className}`}
    >
      {children}
    </div>
  );
}
