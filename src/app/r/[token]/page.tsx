import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getSharedReport, ShareUnavailableError } from "@/lib/nyc/share";
import { ReportView } from "@/components/ReportView";
import { Notice } from "@/components/ui/Notice";
import { buttonClass } from "@/components/ui/styles";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared violation report · ViolationRadar",
  // Shared links are unlisted by design — recipients get them directly.
  robots: { index: false, follow: false },
};

export default async function SharedReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let shared;
  try {
    shared = await getSharedReport(token);
  } catch (err) {
    if (err instanceof ShareUnavailableError) notFound();
    throw err;
  }
  if (!shared) notFound();

  return (
    <main id="main" className="mx-auto w-full max-w-4xl px-6 py-10">
      <Notice>
        You are viewing a shared, read-only report generated on{" "}
        {new Date(shared.createdAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
        . The figures below reflect city data as of the date shown on the report.
      </Notice>

      <div className="mt-6">
        <ReportView report={shared.report} />
      </div>

      {/* Organic growth loop (Flow C): the recipient is a prospect.
          A CTA band rather than a <footer> — the layout already renders the
          site footer below this, and two footers would read as a mistake. */}
      <section className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-accent-soft bg-accent-soft p-5">
        <p className="text-sm text-ink-body">
          Powered by <strong className="text-ink">ViolationRadar</strong> —
          violation reports for any NYC property.
        </p>
        <Link href="/" className={buttonClass({ variant: "accent" })}>
          Run your own lookup
        </Link>
      </section>
    </main>
  );
}
