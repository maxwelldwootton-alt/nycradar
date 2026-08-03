/**
 * Class-string builders for the handful of shapes that repeat across the app.
 *
 * These return strings rather than rendering components on purpose: the same
 * button styling has to land on <button>, <a>, next/link, and on submit buttons
 * inside the existing `<form action="/api/…">` POSTs. A string composes with all
 * of them without wrapping anything.
 *
 * No clsx/cva here — every variant below is a fixed lookup, so a dependency
 * would only buy conditional-class merging the app doesn't need.
 */

/**
 * The focus affordance, applied to everything interactive.
 *
 * `focus-visible:` rather than `focus:` so a mouse click doesn't leave a ring
 * behind. The app previously set an unconditional `outline-none` and tinted the
 * border on focus, which removes the browser's indicator and replaces it with
 * roughly nothing.
 *
 * Outline rather than `ring-*` on purpose: a ring needs its offset colour to
 * match whatever is behind the element, so the same class is wrong on a card
 * that it is right on the page. `outline-offset` composites over any
 * background, so one string works everywhere.
 */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * Text fields use `focus:` rather than `focus-visible:` — a caret alone is a
 * weak indication of which field is live, including for mouse users.
 */
export const focusRingField =
  "focus:outline-2 focus:outline-offset-2 focus:outline-accent";

/**
 * For rows inside a clipping container (the search results panel, the
 * dashboard's lookup list). A positive offset would be cropped by the parent's
 * `overflow-hidden`, so the outline is drawn inside the row's own bounds.
 *
 * A separate constant rather than `focusRing` plus an override: both would emit
 * an `outline-offset` declaration and which one won would depend on Tailwind's
 * output order, not on the order they appear in the class string.
 */
export const focusRingInset =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent";

type ButtonVariant = "accent" | "neutral" | "outline" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // Primary action. Accent is reserved for interaction, never for status.
  accent: "bg-accent text-accent-ink hover:bg-accent-hover",
  // The high-contrast neutral fill, for primary actions on accent-free surfaces.
  neutral: "bg-ink text-canvas hover:opacity-90",
  outline: "border border-line-strong text-ink hover:bg-sunken",
  ghost: "text-ink-body hover:bg-sunken hover:text-ink",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-3 text-base",
};

export function buttonClass({
  variant = "neutral",
  size = "md",
  full = false,
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  className?: string;
} = {}): string {
  return [
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium",
    "motion-safe:transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    full ? "w-full" : "",
    focusRing,
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Text inputs and selects. */
export function fieldClass({
  size = "md",
  className = "",
}: { size?: "md" | "lg"; className?: string } = {}): string {
  return [
    "rounded-lg border border-line-strong bg-surface text-ink",
    "placeholder:text-ink-muted motion-safe:transition-colors",
    size === "lg" ? "px-4 py-3.5 text-base" : "px-4 py-3 text-sm",
    focusRingField,
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

/** The standard raised panel: a surface lifted off the canvas by a hairline. */
export function cardClass({
  className = "",
}: { className?: string } = {}): string {
  return ["rounded-xl border border-line bg-surface", className]
    .filter(Boolean)
    .join(" ");
}
