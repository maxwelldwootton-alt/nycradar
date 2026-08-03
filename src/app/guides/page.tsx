import Link from "next/link";
import type { Metadata } from "next";
import { GUIDES } from "@/lib/guides";
import { cardClass } from "@/components/ui/styles";

export const metadata: Metadata = {
  title: "Guides · ViolationRadar",
  description:
    "Plain-language guides to NYC DOB, HPD, and ECB/OATH violations — what they mean and why they matter before a real estate closing.",
  alternates: { canonical: "/guides" },
};

export default function GuidesIndexPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-6 pt-16 pb-20 sm:pt-24">
      <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
        Guides
      </p>
      <h1 className="mt-3 text-4xl leading-[1.08] font-semibold tracking-tight text-balance text-ink">
        Understanding NYC property violations
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-relaxed text-pretty text-ink-body">
        What DOB, HPD, and ECB/OATH records actually mean, and why they&rsquo;re
        worth checking before you buy, sell, or rent.
      </p>

      <div className="mt-12 space-y-4">
        {GUIDES.map((guide) => (
          <Link
            key={guide.slug}
            href={`/guides/${guide.slug}`}
            className={cardClass({ className: "block p-5" })}
          >
            <h2 className="text-lg font-semibold text-ink">{guide.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-body">
              {guide.description}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
