/**
 * Minimal Socrata (SODA) client for NYC Open Data.
 *
 * Server-side only — never import this into a client component. An app token
 * is optional but strongly recommended for production: anonymous requests are
 * throttled aggressively.
 */

export const DOMAIN = "https://data.cityofnewyork.us";

export const DATASETS = {
  /** DOB Violations (BIS civil penalties) */
  dob: "3h2n-5cm9",
  /** HPD Housing Maintenance Code Violations */
  hpd: "wvxf-dwi5",
  /** DOB ECB Violations — DOB summonses adjudicated at OATH */
  ecb: "6bgk-3dad",
  /** OATH Hearings Division Case Status — citywide adjudication docket */
  oath: "jz4z-kudi",
  /** PLUTO tax-lot reference, used for address → BBL resolution */
  pluto: "64uk-42ks",
} as const;

export type DatasetKey = keyof typeof DATASETS;

export class SocrataError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly dataset?: string,
  ) {
    super(message);
    this.name = "SocrataError";
  }
}

export interface SocrataQuery {
  $select?: string;
  $where?: string;
  $order?: string;
  $limit?: string | number;
  $offset?: string | number;
  $group?: string;
  $q?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

function appToken(): string | undefined {
  return process.env.SOCRATA_APP_TOKEN || undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Request throttle.
 *
 * A report page issues ~5 calls and then stops, so this was never needed for
 * the interactive path. The bulk SEO refresh is the first caller to make
 * sustained requests — tens of thousands in a run — and anonymous Socrata
 * traffic is throttled aggressively. The defaults are wide enough that the
 * report path behaves exactly as before; the bulk script narrows them.
 */
let maxConcurrency = 8;
let minIntervalMs = 0;

let inFlight = 0;
let lastStartedAt = 0;
const waiters: (() => void)[] = [];

export function configureSocrataThrottle(opts: {
  maxConcurrency?: number;
  minIntervalMs?: number;
}): void {
  if (opts.maxConcurrency !== undefined) {
    maxConcurrency = Math.max(1, opts.maxConcurrency);
  }
  if (opts.minIntervalMs !== undefined) {
    minIntervalMs = Math.max(0, opts.minIntervalMs);
  }
}

async function acquireSlot(): Promise<void> {
  if (inFlight >= maxConcurrency) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  inFlight++;

  if (minIntervalMs > 0) {
    // Space out request *starts*, so a long-running request doesn't cause a
    // burst the moment it lands.
    const wait = lastStartedAt + minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastStartedAt = Date.now();
  }
}

function releaseSlot(): void {
  inFlight--;
  waiters.shift()?.();
}

/**
 * Query a dataset. Retries transient failures with exponential backoff;
 * 400/404 are treated as caller errors and thrown immediately, since retrying
 * a malformed SoQL query only wastes the rate limit.
 */
export async function soda<T = Record<string, unknown>>(
  dataset: DatasetKey,
  query: SocrataQuery,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<T[]> {
  const id = DATASETS[dataset];
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) params.set(k, String(v));
  }
  const url = `${DOMAIN}/resource/${id}.json?${params.toString()}`;

  const headers: Record<string, string> = { Accept: "application/json" };
  const token = appToken();
  if (token) headers["X-App-Token"] = token;

  const retries = opts.retries ?? MAX_RETRIES;
  let delay = 500;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Per attempt, not per call: a retry is another request against the same
      // rate limit and has to queue behind the throttle like any other. The
      // slot is held until the body is consumed, not just until headers
      // arrive — on a 50k-row page the download is most of the work.
      await acquireSlot();
      try {
        const res = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
          cache: "no-store",
        });
        if (res.status === 400 || res.status === 404) {
          const body = await res.text();
          throw new SocrataError(
            `Bad SODA query on ${id}: ${body.slice(0, 300)}`,
            res.status,
            id,
          );
        }
        if (!res.ok) throw new SocrataError(`SODA ${res.status} on ${id}`, res.status, id);
        return (await res.json()) as T[];
      } finally {
        releaseSlot();
      }
    } catch (err) {
      if (err instanceof SocrataError && (err.status === 400 || err.status === 404)) {
        throw err;
      }
      lastErr = err;
      if (attempt === retries) break;
      await sleep(delay);
      delay *= 2;
    }
  }
  throw new SocrataError(
    `SODA request failed for ${id} after ${retries + 1} attempts: ${String(lastErr)}`,
    undefined,
    id,
  );
}

/**
 * Fetch every matching row, paging until exhausted.
 *
 * A single `$limit` silently truncates: heavily-cited properties exceed 5,000
 * HPD violations, and a truncated fetch produces an undercount that looks like
 * a real number. Pages are fetched sequentially because Socrata's offset
 * pagination is not stable under concurrent reads.
 */
export async function sodaAll<T = Record<string, unknown>>(
  dataset: DatasetKey,
  query: Omit<SocrataQuery, "$limit" | "$offset">,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<{ rows: T[]; truncated: boolean }> {
  const pageSize = opts.pageSize ?? 5000;
  const maxRows = opts.maxRows ?? 50_000;
  const rows: T[] = [];

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const page = await soda<T>(dataset, {
      ...query,
      $limit: pageSize,
      $offset: offset,
    });
    rows.push(...page);
    if (page.length < pageSize) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/**
 * Page through a dataset, yielding one page at a time.
 *
 * `sodaAll` accumulates every row and stops at `maxRows` (50k by default),
 * which is right for one property's report but wrong for a citywide sweep:
 * the SEO refresh reads millions of rows and needs to fold each page into a
 * running tally and then drop it. Yielding pages keeps peak memory at one
 * page regardless of dataset size.
 *
 * Ordering matters for correctness here. Socrata's offset paging is only
 * stable under an explicit `$order`; without one, rows can repeat or be
 * skipped across pages, which would silently corrupt the counts.
 */
export async function* sodaPages<T = Record<string, unknown>>(
  dataset: DatasetKey,
  query: Omit<SocrataQuery, "$limit" | "$offset"> & { $order: string },
  opts: { pageSize?: number; maxPages?: number } = {},
): AsyncGenerator<T[], void, undefined> {
  const pageSize = opts.pageSize ?? 50_000;
  const maxPages = opts.maxPages ?? Infinity;

  for (let page = 0; page < maxPages; page++) {
    const rows = await soda<T>(dataset, {
      ...query,
      $limit: pageSize,
      $offset: page * pageSize,
    });
    if (rows.length > 0) yield rows;
    if (rows.length < pageSize) return;
  }
}

/** Exact row count via SoQL aggregate — far cheaper than fetching rows. */
export async function sodaCount(
  dataset: DatasetKey,
  where: string,
): Promise<number> {
  const rows = await soda<{ n?: string }>(dataset, {
    $select: "count(1) as n",
    $where: where,
  });
  const n = rows[0]?.n;
  return n === undefined ? 0 : parseInt(n, 10) || 0;
}

/**
 * Read a dataset's `rowsUpdatedAt` from the portal's own metadata.
 *
 * This is the authoritative freshness signal for FR7 — we report the city's
 * timestamp, not our fetch time, so "data as of" never overstates freshness.
 * Cached in-process for an hour; the underlying datasets refresh daily.
 */
const metaCache = new Map<string, { at: number; value: string | null }>();
const META_TTL_MS = 60 * 60 * 1000;

export async function datasetUpdatedAt(dataset: DatasetKey): Promise<string | null> {
  const id = DATASETS[dataset];
  const hit = metaCache.get(id);
  if (hit && Date.now() - hit.at < META_TTL_MS) return hit.value;

  try {
    const res = await fetch(`${DOMAIN}/api/views/${id}.json`, {
      headers: appToken() ? { "X-App-Token": appToken()! } : {},
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!res.ok) return hit?.value ?? null;
    const meta = (await res.json()) as { rowsUpdatedAt?: number };
    const value = meta.rowsUpdatedAt
      ? new Date(meta.rowsUpdatedAt * 1000).toISOString()
      : null;
    metaCache.set(id, { at: Date.now(), value });
    return value;
  } catch {
    // Freshness metadata is best-effort; a missing timestamp must not fail a
    // report. The report layer surfaces this as a warning instead.
    return hit?.value ?? null;
  }
}

/** Escape a string literal for use inside a SoQL `$where` clause. */
export function soqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
