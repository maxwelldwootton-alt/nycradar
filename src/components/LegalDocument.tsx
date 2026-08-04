import { Notice } from "@/components/ui/Notice";
import { LEGAL, legalDetailsConfigured } from "@/lib/legal";

/**
 * Shared shell for Terms and Privacy.
 *
 * The two documents share a layout, a last-updated line, and the draft banner;
 * only the body differs. Keeping the chrome here means a change to the banner
 * wording cannot land on one page and miss the other.
 */
export function LegalDocument({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-6 pt-16 pb-20 sm:pt-24">
      <h1 className="text-4xl leading-[1.08] font-semibold tracking-tight text-balance text-ink">
        {title}
      </h1>
      <p className="mt-3 text-sm text-ink-muted">
        Last updated {LEGAL.lastUpdated}
      </p>
      <p className="mt-5 text-lg leading-relaxed text-pretty text-ink-body">{intro}</p>

      {!legalDetailsConfigured() && (
        // Visible, not a code comment: an unfinished policy that looks
        // finished is worse than no policy, and the bracketed placeholders
        // below are easy to skim past.
        <Notice tone="caution" role="alert" className="mt-8">
          <strong className="font-semibold">Draft — not yet in effect.</strong>{" "}
          This document still contains placeholders in square brackets and has
          not been reviewed by counsel. It is published for development purposes
          and is not a binding agreement.
        </Notice>
      )}

      <div className="mt-10 space-y-8 text-ink-body [&_a]:text-accent [&_a]:underline [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-ink [&_li]:leading-relaxed [&_p]:leading-relaxed [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
        {children}
      </div>
    </main>
  );
}
