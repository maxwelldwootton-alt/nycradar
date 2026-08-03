import { SearchBox } from "@/components/SearchBox";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 sm:text-4xl">
        Every open violation on a NYC property, in one report
      </h1>
      <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
        DOB, HPD and ECB/OATH records for any address in the five boroughs —
        including outstanding penalties and docketed judgments that can attach as
        liens at closing.
      </p>

      <div className="mt-8">
        <SearchBox autoFocus />
      </div>

      <section className="mt-14 grid gap-6 sm:grid-cols-3">
        {[
          {
            title: "Three agencies, one lookup",
            body: "DOB civil penalties, HPD housing maintenance violations, and ECB/OATH summonses — matched to the same tax lot and de-duplicated.",
          },
          {
            title: "Judgments surfaced first",
            body: "Docketed OATH judgments accrue interest and can become liens. They appear on every report rather than being buried in a docket search.",
          },
          {
            title: "Sourced and dated",
            body: "Every report states which public records it drew on and the date the city published them.",
          },
        ].map((f) => (
          <div key={f.title}>
            <h2 className="font-semibold text-slate-900 dark:text-slate-100">{f.title}</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{f.body}</p>
          </div>
        ))}
      </section>

      <p className="mt-14 border-t border-slate-200 pt-6 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-500">
        Reports are compiled from public NYC Open Data records and are
        informational only. They do not constitute legal advice, are not a title
        search, and should not be the sole basis for a transaction decision.
      </p>
    </main>
  );
}
