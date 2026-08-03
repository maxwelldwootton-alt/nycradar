/**
 * The wordmark glyph — concentric sweeps with a contact on the outer band.
 *
 * Inline SVG rather than an asset: it inherits `currentColor`, so it needs no
 * light/dark variant and no network request, and it stays crisp at the 20px the
 * header renders it at.
 */

export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M4 14a6 6 0 0 1 6 6" />
      <path d="M4 9a11 11 0 0 1 11 11" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="12.5" cy="11.5" r="1.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Glyph plus name, as used in the header and footer. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Logo className="h-5 w-5 text-accent" />
      <span className="font-semibold tracking-tight text-ink">
        ViolationRadar
      </span>
    </span>
  );
}
