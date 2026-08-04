import Link from "next/link";
import { buttonClass } from "./ui/styles";

/**
 * Shown when the public render budget is spent (see `src/lib/rate-limit.ts`).
 *
 * States what happened rather than rendering an empty report. On a
 * due-diligence product a page showing zero violations because a limiter fired
 * is the same dangerous falsehood as one showing zero because an API timed
 * out — "we didn't look" must never be presented as "there's nothing there".
 */
export function TemporarilyUnavailable() {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-6 py-20">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        Temporarily unavailable
      </h1>
      <p className="mt-3 leading-relaxed text-ink-body">
        We&rsquo;re handling an unusual volume of requests and have paused new
        property lookups for a moment. Nothing about this property was checked,
        so nothing here should be read as a clean record. Please try again
        shortly.
      </p>
      <div className="mt-6">
        <Link href="/" className={buttonClass({ variant: "accent" })}>
          Back to search
        </Link>
      </div>
    </main>
  );
}
