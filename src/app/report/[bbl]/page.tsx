import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { generateReport } from "@/lib/nyc/report";
import { getProperty } from "@/lib/nyc/property";
import { normalizeBbl } from "@/lib/nyc/bbl";
import { ReportView } from "@/components/ReportView";
import { ReportActions } from "@/components/ReportActions";

// Reports hit four live city APIs; nothing here is statically renderable.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ bbl: string }>;
}): Promise<Metadata> {
  const { bbl: raw } = await params;
  const bbl = normalizeBbl(raw);
  if (!bbl) return { title: "Report not found · ViolationRadar" };
  const property = await getProperty(bbl).catch(() => null);
  return {
    title: `${property?.address ?? `BBL ${bbl}`} · Violation report`,
    // Reports are per-property public records but there is no reason to have
    // them indexed; sharing happens through explicit links.
    robots: { index: false, follow: false },
  };
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ bbl: string }>;
}) {
  const { bbl: raw } = await params;
  const bbl = normalizeBbl(raw);
  if (!bbl) notFound();

  // Property metadata is a nicety — a valid BBL with no PLUTO row should still
  // produce a report, since violations can outlive a lot merge.
  const property = await getProperty(bbl).catch(() => null);
  const report = await generateReport(bbl, { property: property ?? undefined });

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <Link
        href="/"
        className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
      >
        ← New search
      </Link>
      <div className="mt-6">
        <ReportView report={report} />
      </div>
      <ReportActions bbl={bbl} />
    </main>
  );
}
