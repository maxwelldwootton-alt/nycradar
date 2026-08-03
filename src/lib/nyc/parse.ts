/**
 * Field parsers for NYC source data.
 *
 * Date formats differ across the four datasets: DOB and ECB store compact
 * `YYYYMMDD` strings, HPD and OATH store ISO datetimes. Both are common enough
 * that a single tolerant parser is worth having.
 */

/** Parse `YYYYMMDD`, ISO, or ISO-datetime into an ISO date (`YYYY-MM-DD`). */
export function parseCityDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === "") return null;

  // Compact YYYYMMDD (DOB, ECB)
  if (/^\d{8}$/.test(s)) {
    const y = s.slice(0, 4);
    const m = s.slice(4, 6);
    const d = s.slice(6, 8);
    const year = parseInt(y, 10);
    const month = parseInt(m, 10);
    const day = parseInt(d, 10);
    // The source contains corrupt dates (e.g. year 5201) — reject rather than
    // surface an impossible date on a report.
    if (year < 1900 || year > 2100) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${y}-${m}-${d}`;
  }

  // ISO / ISO-datetime (HPD, OATH)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const year = parseInt(m[1], 10);
    if (year < 1900 || year > 2100) return null;
    return `${m[1]}-${m[2]}-${m[3]}`;
  }

  return null;
}

export function parseNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Money fields arrive as strings and are frequently absent or blank. */
export function parseMoney(raw: unknown): number | null {
  const n = parseNumber(raw);
  if (n === null) return null;
  return Math.round(n * 100) / 100;
}

export function cleanText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  // Source descriptions carry heavy internal padding from fixed-width extracts.
  const s = String(raw).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}
