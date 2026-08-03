import { SearchBox } from "@/components/SearchBox";
import { cardClass } from "@/components/ui/styles";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://nycradar.vercel.app";

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "ViolationRadar",
  url: SITE_URL,
  description:
    "Aggregated DOB, HPD and ECB/OATH violation records for any NYC property — including outstanding penalties and docketed judgments.",
};

/** Inline rather than an icon dependency — three glyphs don't justify a package. */
const ICONS = {
  layers: (
    <path d="M8 1.5 14.5 5 8 8.5 1.5 5 8 1.5ZM2.6 8 8 10.9 13.4 8M2.6 11 8 13.9 13.4 11" />
  ),
  gavel: <path d="M3 13h6M4.5 10.5 9 6M6 4l4 4M9.5 1.5 14 6M11.5 3.5 8 7" />,
  calendar: (
    <path d="M2.5 4.5h11v10h-11v-10ZM5 2.5v3M11 2.5v3M2.5 7.5h11M6 11l1.5 1.5L10.5 9.5" />
  ),
};

const FEATURES = [
  {
    icon: ICONS.layers,
    title: "Three agencies, one lookup",
    body: "DOB civil penalties, HPD housing maintenance violations, and ECB/OATH summonses — matched to the same tax lot and de-duplicated.",
  },
  {
    icon: ICONS.gavel,
    title: "Judgments surfaced first",
    body: "Docketed OATH judgments accrue interest and can become liens. They appear on every report rather than being buried in a docket search.",
  },
  {
    icon: ICONS.calendar,
    title: "Sourced and dated",
    body: "Every report states which public records it drew on and the date the city published them.",
  },
];

export default function Home() {
  return (
    <main id="main" className="mx-auto w-full max-w-5xl px-6 pt-16 pb-20 sm:pt-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
        Pre-closing due diligence
      </p>

      <h1 className="mt-3 max-w-3xl text-4xl leading-[1.08] font-semibold tracking-tight text-balance text-ink sm:text-5xl">
        Every open violation on a NYC property, in one report
      </h1>

      <p className="mt-5 max-w-2xl text-lg leading-relaxed text-pretty text-ink-body">
        DOB, HPD and ECB/OATH records for any address in the five boroughs —
        including outstanding penalties and docketed judgments that can attach as
        liens at closing.
      </p>

      <div className="mt-9 max-w-3xl">
        <SearchBox autoFocus variant="hero" />
      </div>

      <section className="mt-16 grid gap-4 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className={cardClass({ className: "p-5" })}>
            <span
              aria-hidden="true"
              className="mb-3 flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent"
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.25}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-4"
              >
                {f.icon}
              </svg>
            </span>
            <h2 className="text-sm font-semibold text-ink">{f.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-body">{f.body}</p>
          </div>
        ))}
      </section>

      {/* The disclaimer that used to sit here now lives in SiteFooter, so it
          appears on every surface rather than only this page. */}
    </main>
  );
}
