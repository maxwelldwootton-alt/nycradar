import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { GUIDES, getGuide } from "@/lib/guides";
import { buttonClass } from "@/components/ui/styles";

export function generateStaticParams() {
  return GUIDES.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) return { title: "Guide not found · ViolationRadar" };
  return {
    title: `${guide.title} · ViolationRadar`,
    description: guide.description,
    alternates: { canonical: `/guides/${guide.slug}` },
    openGraph: {
      type: "article",
      title: guide.title,
      description: guide.description,
    },
  };
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: guide.title,
    description: guide.description,
    dateModified: guide.updated,
  };

  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-6 pt-16 pb-20 sm:pt-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Link
        href="/guides"
        className={buttonClass({ variant: "ghost", size: "sm" })}
      >
        ← All guides
      </Link>

      <article className="mt-6">
        <h1 className="text-3xl leading-[1.1] font-semibold tracking-tight text-balance text-ink sm:text-4xl">
          {guide.title}
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-pretty text-ink-body">
          {guide.description}
        </p>

        <div className="mt-10 space-y-8">
          {guide.sections.map((section, i) => (
            <div key={i}>
              {section.heading && (
                <h2 className="text-xl font-semibold tracking-tight text-ink">
                  {section.heading}
                </h2>
              )}
              <div className={section.heading ? "mt-3 space-y-3" : "space-y-3"}>
                {section.paragraphs.map((p, j) => (
                  <p key={j} className="leading-relaxed text-ink-body">
                    {p}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </article>

      <section className="mt-12 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-accent-soft bg-accent-soft p-5">
        <p className="text-sm text-ink-body">
          Check any NYC address for open DOB, HPD, and ECB/OATH violations.
        </p>
        <Link href="/" className={buttonClass({ variant: "accent" })}>
          Run a free lookup
        </Link>
      </section>
    </main>
  );
}
