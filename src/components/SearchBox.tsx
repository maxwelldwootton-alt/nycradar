"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PropertySearchResult } from "@/lib/nyc/property";
import { normalizeBbl } from "@/lib/nyc/bbl";
import { looksLikeBbl } from "@/lib/nyc/address";
import { Badge } from "@/components/ui/Badge";
import { Notice } from "@/components/ui/Notice";
import { buttonClass, fieldClass, focusRing, focusRingInset } from "@/components/ui/styles";

// `@/lib/nyc/bbl` and `@/lib/nyc/address` are both free of `server-only`
// (unlike `property.ts`, which is imported here for its type alone and erased
// at compile). That is what lets a BBL be resolved in the browser with no
// round trip.

const BOROUGHS = [
  { code: "", label: "All boroughs" },
  { code: "1", label: "Manhattan" },
  { code: "2", label: "Bronx" },
  { code: "3", label: "Brooklyn" },
  { code: "4", label: "Queens" },
  { code: "5", label: "Staten Island" },
];

/**
 * Addresses from the spike's verified test set (see tests/join.live.test.ts and
 * spike/FINDINGS.md) — every one returns a non-empty report from all four
 * sources. Inventing plausible-looking addresses here would be worse than
 * offering none: a suggested query that returns "No properties matched" reads
 * as a broken product on the first interaction.
 */
const EXAMPLES = [
  "109 Washington St, Manhattan",
  "1 John Street, Brooklyn",
  "45-42 Vernon Blvd, Queens",
];

function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="9" cy="9" r="5.5" />
      <path d="m13.2 13.2 3.3 3.3" />
    </svg>
  );
}

function ResultSkeleton() {
  return (
    <ul aria-hidden="true" className="divide-y divide-line">
      {[0, 1, 2].map((i) => (
        <li key={i} className="px-4 py-3.5">
          <div className="h-3.5 w-1/2 animate-pulse rounded bg-sunken" />
          <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-sunken" />
        </li>
      ))}
    </ul>
  );
}

export function SearchBox({
  autoFocus = false,
  variant = "default",
}: {
  autoFocus?: boolean;
  variant?: "default" | "hero";
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [borough, setBorough] = useState("");
  const [results, setResults] = useState<PropertySearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const hero = variant === "hero";

  const searched = query.trim().length >= 3;

  // Below the minimum length the previous query's results are simply not shown
  // (see `visible`), rather than cleared from state inside the effect — the
  // setState-in-effect that lint has been flagging on this file since it was
  // written, and a cascading render on every keystroke under three characters.
  const visible = searched ? results : [];

  useEffect(() => {
    if (!searched) return;

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
        setOpen(true);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError("Search is temporarily unavailable. Please try again.");
        }
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, borough, searched]);

  // Dismiss the results panel on an outside click, the way any overlay should.
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const go = useCallback((bbl: string) => router.push(`/report/${bbl}`), [router]);

  /**
   * Enter and the Search button resolve without waiting for the debounce when
   * they can: a pasted BBL is unambiguous, and if results are already on screen
   * the first one is what the user is looking at.
   */
  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (looksLikeBbl(q)) {
      const bbl = normalizeBbl(q);
      if (bbl) return go(bbl);
    }
    if (visible.length > 0) return go(visible[0].bbl);
  }

  /** Roving real focus — Enter then works on its own, because these are buttons. */
  function focusOption(index: number) {
    // The visible count, not the ref array's: that array is only trimmed on the
    // next render, so a shrinking result set would leave stale slots behind.
    const count = visible.length;
    if (count === 0) return;
    if (index < 0) return inputRef.current?.focus();
    optionRefs.current[index % count]?.focus();
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && visible.length > 0) {
      event.preventDefault();
      setOpen(true);
      focusOption(0);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  function onOptionKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(index - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      inputRef.current?.focus();
    }
  }

  const nearbyOnly = visible.length > 0 && visible.every((r) => r.matchType !== "exact");
  const noMatches = touched && !loading && searched && visible.length === 0;
  const showPanel = open && searched && (loading || visible.length > 0 || noMatches);

  return (
    <div ref={rootRef} className="relative w-full">
      <form
        role="search"
        onSubmit={onSubmit}
        className={
          hero
            ? "flex flex-col gap-2 rounded-2xl border border-line-strong bg-surface p-2 shadow-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent sm:flex-row sm:items-center"
            : "flex flex-col gap-2 sm:flex-row"
        }
      >
        {hero ? (
          <div className="flex min-w-0 flex-1 items-center gap-2.5 px-3">
            <SearchIcon className="size-5 shrink-0 text-ink-muted" />
            <input
              ref={inputRef}
              type="search"
              autoFocus={autoFocus}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setOpen(true)}
              onKeyDown={onInputKeyDown}
              placeholder="Enter an address or 10-digit BBL"
              aria-label="Property address or BBL"
              // The wrapper's focus-within outline is the visible indicator, so
              // suppressing this one does not leave the field unmarked.
              className="w-full min-w-0 bg-transparent py-3 text-base text-ink placeholder:text-ink-muted focus:outline-none"
            />
          </div>
        ) : (
          <input
            ref={inputRef}
            type="search"
            autoFocus={autoFocus}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            onKeyDown={onInputKeyDown}
            placeholder="Enter an address or 10-digit BBL"
            aria-label="Property address or BBL"
            className={fieldClass({ className: "flex-1" })}
          />
        )}

        <select
          value={borough}
          onChange={(e) => setBorough(e.target.value)}
          aria-label="Borough"
          className={
            hero
              ? `rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink-body ${focusRing}`
              : fieldClass()
          }
        >
          {BOROUGHS.map((b) => (
            <option key={b.code} value={b.code}>
              {b.label}
            </option>
          ))}
        </select>

        <button
          type="submit"
          className={buttonClass({
            variant: "accent",
            size: hero ? "lg" : "md",
            className: "shrink-0",
          })}
        >
          Search
        </button>
      </form>

      {hero && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <span>Try</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                setQuery(example);
                setOpen(true);
                inputRef.current?.focus();
              }}
              className={`rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink-body motion-safe:transition-colors hover:border-line-strong hover:text-ink ${focusRing}`}
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {/* Announced rather than merely rendered: a debounced search otherwise
          rewrites the DOM with no indication to a screen reader. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {loading
          ? "Searching"
          : noMatches
            ? "No properties matched"
            : visible.length > 0
              ? `${visible.length} propert${visible.length === 1 ? "y" : "ies"} found`
              : ""}
      </div>

      {error && (
        <Notice tone="critical" role="alert" className="mt-3">
          {error}
        </Notice>
      )}

      {nearbyOnly && open && (
        <Notice tone="caution" className="mt-3">
          No exact match for that address. These are the closest properties on the
          same street — confirm the building before relying on the report.
        </Notice>
      )}

      {/* Overlaid rather than in flow: results used to push the page down on
          every keystroke, moving the content the user was reading. */}
      {showPanel && (
        <div className="absolute inset-x-0 z-20 mt-2 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          {loading && visible.length === 0 ? (
            <ResultSkeleton />
          ) : noMatches ? (
            <p className="px-4 py-3.5 text-sm text-ink-muted">
              No properties matched. Try adding the borough, or search by BBL.
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {visible.map((r, i) => (
                <li key={r.bbl}>
                  <button
                    type="button"
                    ref={(el) => {
                      optionRefs.current[i] = el;
                    }}
                    onClick={() => go(r.bbl)}
                    onKeyDown={(e) => onOptionKeyDown(e, i)}
                    className={`flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left motion-safe:transition-colors hover:bg-sunken focus-visible:bg-sunken ${focusRingInset}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">
                        {r.address ?? `BBL ${r.bbl}`}
                      </span>
                      <span className="block text-sm text-ink-muted">
                        <span className="font-mono">{r.bbl}</span>
                        {r.zip && ` · ${r.zip}`}
                        {r.unitsRes ? ` · ${r.unitsRes} residential units` : ""}
                        {r.isCondoBillingLot && " · condo"}
                      </span>
                    </span>
                    {r.matchType !== "exact" && <Badge>nearby</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
