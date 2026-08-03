import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getSharedReport, ShareUnavailableError } from "@/lib/nyc/share";
import { ReportView } from "@/components/ReportView";

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
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-400">
        You are viewing a shared, read-only report generated on{" "}
        {new Date(shared.createdAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
        . The figures below reflect city data as of the date shown on the report.
      </p>

      <div className="mt-6">
        <ReportView report={shared.report} />
      </div>

      {/* Organic growth loop (Flow C): the recipient is a prospect. */}
      <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-6 dark:border-slate-700">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Powered by <strong>ViolationRadar</strong> — violation reports for any NYC property.
        </p>
        <Link
          href="/"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          Run your own lookup
        </Link>
      </footer>
    </main>
  );
}
