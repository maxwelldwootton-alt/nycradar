import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getCachedReport, withProperty } from "@/lib/nyc/report";
import { persistReport } from "@/lib/nyc/persistence";
import { getProperty } from "@/lib/nyc/property";
import { normalizeBbl } from "@/lib/nyc/bbl";
import { ReportView } from "@/components/ReportView";
import { ReportTeaser } from "@/components/ReportTeaser";
import { ReportActions } from "@/components/ReportActions";
import { recordLookup, resolveAccess } from "@/lib/auth/entitlement";
import { guardPublicReportRender } from "@/lib/rate-limit";
import { TemporarilyUnavailable } from "@/components/TemporarilyUnavailable";
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

  // Entitlement is resolved *before* the report is fetched rather than
  // alongside it, so the limiter can run while declining to fetch is still an
  // option. `robots.txt` disallows this route, but a scraper enumerating BBLs
  // here would otherwise trigger six SODA calls per lot — a teaser is rendered
  // from a full report, so an anonymous view costs exactly what a paid one
  // does. This is the only surface where that's true: the indexable
  // `/p/{borough}/{slug}` pages read the nightly summary table instead.
  //
  // The cost is one serialized database round trip for signed-in users, which
  // is the cheaper half of this page by a wide margin.
  const [property, access] = await Promise.all([
    getProperty(bbl).catch(() => null),
    resolveAccess(bbl),
  ]);

  // Entitled users are never throttled — they have paid for this specific
  // lookup, or are inside a subscription that promises unlimited ones.
  if (!access.canViewFullReport && !(await guardPublicReportRender(await headers(), bbl))) {
    return <TemporarilyUnavailable />;
  }

  const cachedReport = await getCachedReport(bbl);
  const report = withProperty(cachedReport, property);

  // Bookkeeping only — deferred, best-effort, and a no-op for incomplete
  // reports. Nothing on this page waits on it.
  persistReport(report);

  let canViewFullReport = access.canViewFullReport;
  let reason = access.reason;

  if (canViewFullReport) {
    // Must happen exactly once per full view — this is what enforces FR4. For
    // the free tier this is also the claim itself: a false return means a
    // concurrent request for another property just spent the last free
    // lookup, so this view must not render as full after all.
    const claimed = await recordLookup({
      bbl,
      address: property?.address ?? null,
      decision: access,
    });
    if (!claimed) {
      canViewFullReport = false;
      reason = "You have used your free lookup for this 30-day period.";
    }
  }

  return (
    <main id="main" className="mx-auto w-full max-w-4xl px-6 py-10">
      <Link href="/" className={buttonClass({ variant: "ghost", size: "sm" })}>
        ← New search
      </Link>

      <div className="mt-6">
        {canViewFullReport ? (
          <>
            <ReportView report={report} />
            <ReportActions bbl={bbl} />
          </>
        ) : (
          <ReportTeaser
            report={report}
            reason={reason}
            signedIn={Boolean(access.email)}
          />
        )}
      </div>
    </main>
  );
}
