import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getCachedReport, withProperty } from "@/lib/nyc/report";
import { getProperty } from "@/lib/nyc/property";
import { normalizeBbl } from "@/lib/nyc/bbl";
import { guardPublicReportRender } from "@/lib/rate-limit";
import { captureError } from "@/lib/observability/capture";
import { TemporarilyUnavailable } from "@/components/TemporarilyUnavailable";
import type { ViolationReport } from "@/lib/nyc/types";
import { Disclaimer, formatDataAsOf } from "@/components/Disclaimer";
import { StatCard } from "@/components/ui/StatCard";
import { buttonClass } from "@/components/ui/styles";

/**
 * Public, indexable violation summary for a single BBL — the counterpart to
 * `/report/[bbl]`, which is deliberately noindexed because it's paywalled.
 *
 * Shows only `property` and `summary.{total,open}Violations` plus per-agency
 * counts — never `sections[].violations`, balances, or judgment counts. Those
 * stay behind `/report/[bbl]`, which is what this page links to. No
 * `resolveAccess`/`recordLookup` call: this route has no entitlement to
 * resolve and isn't a billable lookup.
 *
 * No `generateStaticParams` — pages render on first request for a given BBL
 * rather than pre-building across ~850K NYC tax lots.
 */

/**
 * Dynamic rather than ISR, because the rate limiter needs the client's IP and
 * reading it opts the route out of static rendering.
 *
 * That is a smaller loss than it looks. The expensive part of this page was
 * never the React render — it is the six SODA calls behind it, and those are
 * still held for an hour by `getCachedReport`, which is where the caching that
 * matters actually lives. What page-level ISR bought was a saved render on
 * repeat views; what it cost was the ability to bound how many *distinct*
 * properties an anonymous caller can make us fetch, which on a route that
 * answers for all ~858K tax lots is the exposure that matters.
 */
export const dynamic = "force-dynamic";

/**
 * One rate-limit decision per request.
 *
 * `generateMetadata` and the page component both load the report, and without
 * memoization they would each consume budget and could reach opposite verdicts
 * — a rate-limited page rendering under a normal-looking title, or vice versa.
 * React's `cache` scopes the decision to the request, so both see one answer
 * and it is charged once.
 */
const renderAllowed = cache(async (bbl: string): Promise<boolean> => {
  return guardPublicReportRender(await headers(), bbl);
});

/**
 * Three outcomes, kept distinct on purpose.
 *
 * "We declined to fetch this" and "the city has no such lot" must not collapse
 * into the same 404: one is temporary and must not be indexed, the other is
 * permanent and legitimately is a 404.
 */
type LoadResult =
  | { status: "ok"; report: ViolationReport }
  | { status: "rate_limited" }
  | { status: "unavailable" };

function addressOrBlockLot(property: {
  address: string | null;
  block: number;
  lot: number;
  borough: string;
}): string {
  return property.address ?? `Block ${property.block}, Lot ${property.lot}, ${property.borough}`;
}

async function loadReport(bbl: string): Promise<LoadResult> {
  // Checked before the fetch, not after — a limiter that runs once the city
  // APIs have already been called has protected nothing.
  if (!(await renderAllowed(bbl))) return { status: "rate_limited" };

  try {
    const [property, cachedReport] = await Promise.all([
      getProperty(bbl).catch(() => null),
      getCachedReport(bbl),
    ]);
    return { status: "ok", report: withProperty(cachedReport, property) };
  } catch (err) {
    captureError(err, { tag: "property_page", bbl });
    return { status: "unavailable" };
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ bbl: string }>;
}): Promise<Metadata> {
  const { bbl: raw } = await params;
  const bbl = normalizeBbl(raw);
  if (!bbl) return { title: "Property not found · ViolationRadar" };

  const result = await loadReport(bbl);

  // A throttled or degraded render must never be indexed — it has no content,
  // and letting a crawler cache "temporarily unavailable" under this URL is
  // worse than the fetch the limiter just declined to make.
  if (result.status !== "ok") {
    return {
      title:
        result.status === "rate_limited"
          ? "Temporarily unavailable · ViolationRadar"
          : "Property not found · ViolationRadar",
      robots: { index: false, follow: false },
    };
  }

  const report = result.report;
  const address = addressOrBlockLot(report.property);
  const description = `${address}: ${report.summary.totalViolations.toLocaleString()} DOB, HPD and ECB/OATH violations on record, ${report.summary.openViolations.toLocaleString()} open. See the full breakdown on ViolationRadar.`;

  return {
    title: `${address} — NYC violation summary · ViolationRadar`,
    description,
    alternates: { canonical: `/property/${bbl}` },
    openGraph: {
      type: "article",
      title: `${address} — NYC violation summary`,
      description,
    },
  };
}

export default async function PropertyPage({
  params,
}: {
  params: Promise<{ bbl: string }>;
}) {
  const { bbl: raw } = await params;
  const bbl = normalizeBbl(raw);
  if (!bbl) notFound();

  const result = await loadReport(bbl);
  if (result.status === "rate_limited") return <TemporarilyUnavailable />;
  if (result.status === "unavailable") notFound();

  const report = result.report;
  const { property, sections, summary } = report;
  const address = addressOrBlockLot(property);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Place",
    name: address,
    address: {
      "@type": "PostalAddress",
      streetAddress: property.address ?? undefined,
      addressLocality: property.borough,
      addressRegion: "NY",
      postalCode: property.zip ?? undefined,
      addressCountry: "US",
    },
  };

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-6 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Link href="/" className={buttonClass({ variant: "ghost", size: "sm" })}>
        ← Search another property
      </Link>

      <header className="mt-6">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">{address}</h1>
        <p className="mt-1.5 text-sm text-ink-body">
          {property.borough}
          {property.zip && ` ${property.zip}`} · BBL{" "}
          <span className="font-mono">{property.bbl}</span>
        </p>
        <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-body">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
          Data as of {formatDataAsOf(report.dataAsOf)}
        </p>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Open violations" value={summary.openViolations.toLocaleString()} />
        <StatCard label="Total on record" value={summary.totalViolations.toLocaleString()} />
        {sections.map((section) => (
          <StatCard
            key={section.agency}
            label={`${section.agency} violations`}
            value={section.total.toLocaleString()}
          />
        ))}
      </div>

      <section className="mt-8 rounded-2xl border border-line-strong bg-surface p-6">
        <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
          Summary
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">
          Get the full violation report
        </h2>
        <p className="mt-1 text-sm text-ink-body">
          See every violation by agency, with issue dates, severity, outstanding
          balances and docketed judgments.
        </p>
        <div className="mt-6">
          <Link
            href={`/report/${bbl}`}
            className={buttonClass({ variant: "accent", size: "lg" })}
          >
            View full report
          </Link>
        </div>
      </section>

      <Disclaimer dataAsOf={report.dataAsOf} />
    </main>
  );
}
