import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import {
  getPropertySummary,
  boroughLabel,
  type PropertySummary,
} from "@/lib/nyc/seo-summary";
import { GUIDES } from "@/lib/guides";
import { StatCard } from "@/components/ui/StatCard";
import { buttonClass, cardClass } from "@/components/ui/styles";
import { Disclaimer, formatDataAsOf } from "@/components/Disclaimer";
import { SITE_URL } from "@/lib/site";

/**
 * Public, indexable violation summary for one property.
 *
 * This is the search-landing counterpart to the paid `/report/[bbl]`, which is
 * `noindex` by design. It reads only the nightly `property_seo_summaries`
 * table — never Socrata — because every crawler hit would otherwise be a cache
 * miss against a rate-limited API.
 *
 * It shows counts and nothing else: no per-violation detail, no balances, no
 * judgment dates. Those are the paid product, and the CTA points at it.
 */

// Content changes only when the nightly refresh runs.
export const revalidate = 86400;

function displayName(summary: PropertySummary): string {
  return (
    summary.address ?? `Block ${summary.block}, Lot ${summary.lot}, ${summary.boroughLabel}`
  );
}

/**
 * Guides relevant to what this property actually has on record.
 *
 * Contextual rather than a fixed footer block: a page whose only unique text
 * is an address and three numbers reads as auto-generated, and linking the
 * same four articles everywhere reinforces that rather than fixing it.
 */
function relevantGuides(summary: PropertySummary) {
  const slugs: string[] = [];
  if (summary.hpdTotal > 0) slugs.push("hpd-violations-explained");
  if (summary.ecbOathTotal > 0) slugs.push("ecb-oath-judgments-explained");
  if (summary.dobTotal > 0) slugs.push("dob-violations-before-buying");
  slugs.push("pre-closing-due-diligence-checklist");
  return GUIDES.filter((g) => slugs.includes(g.slug)).slice(0, 3);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ borough: string; slug: string }>;
}): Promise<Metadata> {
  const { borough, slug } = await params;
  const summary = await getPropertySummary(borough, slug);
  if (!summary) return { title: "Property not found · ViolationRadar" };

  const name = displayName(summary);
  const description = `${name}, ${summary.boroughLabel}: ${summary.totalViolations.toLocaleString()} DOB, HPD and ECB/OATH violations on record, ${summary.openViolations.toLocaleString()} still open. Free summary of NYC public violation records.`;

  return {
    title: `${name} — violations & compliance record · ViolationRadar`,
    description,
    alternates: { canonical: `/p/${borough}/${slug}` },
    openGraph: {
      type: "article",
      title: `${name} — NYC violation record`,
      description,
    },
  };
}

export default async function PropertyLandingPage({
  params,
}: {
  params: Promise<{ borough: string; slug: string }>;
}) {
  const { borough, slug } = await params;
  const summary = await getPropertySummary(borough, slug);
  if (!summary) notFound();

  const name = displayName(summary);
  const label = boroughLabel(borough) ?? summary.boroughLabel;
  const guides = relevantGuides(summary);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Place",
    name,
    url: `${SITE_URL}/p/${borough}/${slug}`,
    address: {
      "@type": "PostalAddress",
      streetAddress: summary.address ?? undefined,
      addressLocality: label,
      addressRegion: "NY",
      postalCode: summary.zip ?? undefined,
      addressCountry: "US",
    },
  };

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-6 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <Link href="/" className="hover:text-ink">
          Search
        </Link>
        {" / "}
        <Link href={`/p/${borough}`} className="hover:text-ink">
          {label}
        </Link>
      </nav>

      <header className="mt-4">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">{name}</h1>
        <p className="mt-1.5 text-sm text-ink-body">
          {label}
          {summary.zip && ` ${summary.zip}`} · Block {summary.block}, Lot{" "}
          {summary.lot} · BBL <span className="font-mono">{summary.bbl}</span>
        </p>
        <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-body">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
          Records as of {formatDataAsOf(summary.computedAt)}
        </p>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="Open violations"
          value={summary.openViolations.toLocaleString()}
        />
        <StatCard
          label="Total on record"
          value={summary.totalViolations.toLocaleString()}
        />
        <StatCard label="DOB" value={summary.dobTotal.toLocaleString()} />
        <StatCard label="HPD" value={summary.hpdTotal.toLocaleString()} />
        <StatCard label="ECB / OATH" value={summary.ecbOathTotal.toLocaleString()} />
      </div>

      {(summary.bldgClass || summary.unitsRes !== null || summary.yearBuilt) && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold tracking-wide text-ink-muted uppercase">
            About this property
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            {summary.bldgClass && (
              <div>
                <dt className="text-ink-muted">Building class</dt>
                <dd className="mt-0.5 font-medium text-ink">{summary.bldgClass}</dd>
              </div>
            )}
            {summary.yearBuilt ? (
              <div>
                <dt className="text-ink-muted">Year built</dt>
                <dd className="mt-0.5 font-medium text-ink">{summary.yearBuilt}</dd>
              </div>
            ) : null}
            {summary.unitsRes !== null && (
              <div>
                <dt className="text-ink-muted">Residential units</dt>
                <dd className="mt-0.5 font-medium text-ink">{summary.unitsRes}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      <section className="mt-8 rounded-2xl border border-line-strong bg-surface p-6">
        <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
          Summary only
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">
          See every violation on this property
        </h2>
        <p className="mt-1 text-sm text-ink-body">
          The full report lists each violation by agency with issue dates,
          severity, outstanding balances and any docketed judgments — the
          records that can attach as liens at closing.
        </p>
        <div className="mt-6">
          <Link
            href={`/report/${summary.bbl}`}
            className={buttonClass({ variant: "accent", size: "lg" })}
          >
            View the full report
          </Link>
        </div>
      </section>

      {guides.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold tracking-wide text-ink-muted uppercase">
            Understanding these records
          </h2>
          <div className="mt-3 space-y-3">
            {guides.map((guide) => (
              <Link
                key={guide.slug}
                href={`/guides/${guide.slug}`}
                className={cardClass({ className: "block p-4" })}
              >
                <h3 className="font-medium text-ink">{guide.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-body">
                  {guide.description}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <Disclaimer dataAsOf={summary.computedAt} />
    </main>
  );
}
