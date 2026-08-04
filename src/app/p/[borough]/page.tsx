import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import {
  BOROUGH_SLUGS,
  boroughLabel,
  listBoroughProperties,
} from "@/lib/nyc/seo-summary";
import { buttonClass, cardClass } from "@/components/ui/styles";

/**
 * Borough index — the internal link graph for the property landing pages.
 *
 * A large page set listed only in a sitemap tends to go uncrawled; sitemaps
 * are a hint, links are the actual discovery path. These paginated hubs give
 * every property page at least one real inbound link.
 *
 * Ordered by violation count, which puts the pages most worth crawling on the
 * earliest, most-crawled pages of the index.
 */

export const revalidate = 86400;

const PER_PAGE = 100;

export function generateStaticParams() {
  return BOROUGH_SLUGS.map((borough) => ({ borough }));
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ borough: string }>;
  searchParams: Promise<{ page?: string }>;
}): Promise<Metadata> {
  const { borough } = await params;
  const label = boroughLabel(borough);
  if (!label) return { title: "Not found · ViolationRadar" };

  const page = pageNumber((await searchParams).page);
  const suffix = page > 1 ? ` — page ${page}` : "";

  return {
    title: `${label} properties with open violations${suffix} · ViolationRadar`,
    description: `Browse ${label} properties with DOB, HPD and ECB/OATH violations on record, ordered by total violations.`,
    // Paginated pages are distinct URLs and each carries its own canonical;
    // pointing them all at page 1 would drop the deeper listings — and the
    // property links they carry — out of the index entirely.
    alternates: {
      canonical: page > 1 ? `/p/${borough}?page=${page}` : `/p/${borough}`,
    },
  };
}

function pageNumber(raw: string | undefined): number {
  const n = Number(raw ?? "1");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export default async function BoroughHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ borough: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { borough } = await params;
  const label = boroughLabel(borough);
  if (!label) notFound();

  const page = pageNumber((await searchParams).page);
  const { items, total } = await listBoroughProperties(borough, {
    page,
    perPage: PER_PAGE,
  });

  if (items.length === 0 && page > 1) notFound();

  const lastPage = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-6 py-10">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <Link href="/" className="hover:text-ink">
          Search
        </Link>
      </nav>

      <header className="mt-4">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          {label} properties with violations on record
        </h1>
        <p className="mt-3 max-w-2xl leading-relaxed text-ink-body">
          Every {label} tax lot with at least one DOB, HPD or ECB/OATH violation
          in the city&rsquo;s public records, ordered by total violations. Figures
          are counts only — the full record for any property is one click away.
        </p>
      </header>

      {items.length === 0 ? (
        <p className="mt-10 text-ink-body">
          No properties have been indexed for {label} yet.
        </p>
      ) : (
        <ul className="mt-8 space-y-2">
          {items.map((item) => (
            <li key={item.slug}>
              <Link
                href={`/p/${borough}/${item.slug}`}
                className={cardClass({
                  className: "flex items-center justify-between gap-4 p-4",
                })}
              >
                <span className="font-medium text-ink">
                  {item.address ?? item.slug}
                </span>
                <span className="shrink-0 text-sm text-ink-body tabular-nums">
                  {item.totalViolations.toLocaleString()} total ·{" "}
                  {item.openViolations.toLocaleString()} open
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <nav
          aria-label="Pagination"
          className="mt-8 flex items-center justify-between gap-4"
        >
          {page > 1 ? (
            <Link
              href={page === 2 ? `/p/${borough}` : `/p/${borough}?page=${page - 1}`}
              className={buttonClass({ variant: "outline", size: "sm" })}
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-ink-muted">
            Page {page.toLocaleString()} of {lastPage.toLocaleString()}
          </span>
          {page < lastPage ? (
            <Link
              href={`/p/${borough}?page=${page + 1}`}
              className={buttonClass({ variant: "outline", size: "sm" })}
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
