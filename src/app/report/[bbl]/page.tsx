import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { generateReport } from "@/lib/nyc/report";
import { getProperty } from "@/lib/nyc/property";
import { normalizeBbl } from "@/lib/nyc/bbl";
import { ReportView } from "@/components/ReportView";
import { ReportTeaser } from "@/components/ReportTeaser";
import { ReportActions } from "@/components/ReportActions";
import { recordLookup, resolveAccess } from "@/lib/auth/entitlement";
import { buttonClass } from "@/components/ui/styles";

// Reports hit four live city APIs; nothing here is statically renderable.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

  const [report, access] = await Promise.all([
    generateReport(bbl, { property: property ?? undefined }),
    resolveAccess(bbl),
  ]);

  if (access.canViewFullReport) {
    // Must happen exactly once per full view — this is what enforces FR4.
    await recordLookup({ bbl, address: property?.address ?? null, decision: access });
  }

  return (
    <main id="main" className="mx-auto w-full max-w-4xl px-6 py-10">
      <Link href="/" className={buttonClass({ variant: "ghost", size: "sm" })}>
        ← New search
      </Link>

      <div className="mt-6">
        {access.canViewFullReport ? (
          <>
            <ReportView report={report} />
            <ReportActions bbl={bbl} />
          </>
        ) : (
          <ReportTeaser
            report={report}
            reason={access.reason}
            signedIn={Boolean(access.email)}
          />
        )}
      </div>
    </main>
  );
}
