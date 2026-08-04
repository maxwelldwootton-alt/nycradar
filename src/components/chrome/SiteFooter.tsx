import Link from "next/link";
import { Wordmark } from "@/components/ui/Logo";
import { focusRing } from "@/components/ui/styles";

/**
 * The short disclaimer here is the one the landing page used to carry inline.
 *
 * It is *not* a substitute for `<Disclaimer>`: FR7/§10 require the full wording,
 * with the data-as-of date, on every report surface — screen, PDF and shared
 * link — and that component still renders on all of them.
 */
export function SiteFooter() {
  return (
    // Only a modest top margin: the layout's `flex-1` already pushes this to
    // the bottom on short pages, so a large one double-counts the gap.
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Wordmark />
          <nav className="flex items-center gap-5 text-sm text-ink-body">
            <Link
              href="/"
              className={`rounded-md motion-safe:transition-colors hover:text-ink ${focusRing}`}
            >
              Search a property
            </Link>
            <Link
              href="/guides"
              className={`rounded-md motion-safe:transition-colors hover:text-ink ${focusRing}`}
            >
              Guides
            </Link>
            {/* Reachable from every page on purpose: a single-report buyer has
                no account to sign into, so if their delivery email is lost this
                link is the only way back to what they paid for. */}
            <Link
              href="/purchase/recover"
              className={`rounded-md motion-safe:transition-colors hover:text-ink ${focusRing}`}
            >
              Find my report
            </Link>
            <Link
              href="/login"
              className={`rounded-md motion-safe:transition-colors hover:text-ink ${focusRing}`}
            >
              Sign in
            </Link>
          </nav>
        </div>

        <p className="mt-6 max-w-3xl text-xs leading-relaxed text-ink-muted">
          Reports are compiled from public NYC Open Data records published by the
          Department of Buildings, Housing Preservation &amp; Development, and
          the Office of Administrative Trials and Hearings. They are
          informational only: they do not constitute legal advice, are not a
          title search, and should not be the sole basis for a transaction
          decision.
        </p>
      </div>
    </footer>
  );
}
