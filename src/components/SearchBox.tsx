"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { PropertySearchResult } from "@/lib/nyc/property";

const BOROUGHS = [
  { code: "", label: "All boroughs" },
  { code: "1", label: "Manhattan" },
  { code: "2", label: "Bronx" },
  { code: "3", label: "Brooklyn" },
  { code: "4", label: "Queens" },
  { code: "5", label: "Staten Island" },
];

export function SearchBox({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [borough, setBorough] = useState("");
  const [results, setResults] = useState<PropertySearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }

    // Debounced so typing doesn't fire a query per keystroke.
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ q: query.trim() });
        if (borough) params.set("borough", borough);
        const res = await fetch(`/api/search?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { results: PropertySearchResult[] };
        setResults(body.results);
        setTouched(true);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError("Search is temporarily unavailable. Please try again.");
        }
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, borough]);

  const nearbyOnly = results.length > 0 && results.every((r) => r.matchType !== "exact");

  return (
    <div className="w-full">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter an address or 10-digit BBL"
          aria-label="Property address or BBL"
          className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none focus:border-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
        <select
          value={borough}
          onChange={(e) => setBorough(e.target.value)}
          aria-label="Borough"
          className="rounded-lg border border-slate-300 bg-white px-3 py-3 text-slate-900 shadow-sm outline-none focus:border-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        >
          {BOROUGHS.map((b) => (
            <option key={b.code} value={b.code}>
              {b.label}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mt-3 text-sm text-red-700 dark:text-red-400">{error}</p>}

      {loading && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Searching…</p>
      )}

      {nearbyOnly && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          No exact match for that address. These are the closest properties on the
          same street — confirm the building before relying on the report.
        </p>
      )}

      {results.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {results.map((r) => (
            <li key={r.bbl}>
              <button
                type="button"
                onClick={() => router.push(`/report/${r.bbl}`)}
                className="flex w-full items-center justify-between gap-4 bg-white px-4 py-3 text-left hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800"
              >
                <span>
                  <span className="block font-medium text-slate-900 dark:text-slate-100">
                    {r.address ?? `BBL ${r.bbl}`}
                  </span>
                  <span className="block text-sm text-slate-500 dark:text-slate-400">
                    BBL {r.bbl}
                    {r.zip && ` · ${r.zip}`}
                    {r.unitsRes ? ` · ${r.unitsRes} residential units` : ""}
                    {r.isCondoBillingLot && " · condo"}
                  </span>
                </span>
                {r.matchType !== "exact" && (
                  <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    nearby
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {touched && !loading && results.length === 0 && query.trim().length >= 3 && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          No properties matched. Try adding the borough, or search by BBL.
        </p>
      )}
    </div>
  );
}
