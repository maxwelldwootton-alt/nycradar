/**
 * Display tone for a violation's severity class.
 *
 * The underlying scales are real — HPD grades A/B/C/I and ECB grades 1/2/3 —
 * but the report rendered `severityLabel()` as flat muted text, so "Class C —
 * immediately hazardous" and "Class A — non-hazardous" looked the same.
 *
 * This lives in the UI layer rather than beside `severityLabel` in
 * src/lib/nyc/classify.ts on purpose: that module encodes report-engine
 * semantics and is covered by tests/classify.test.ts. How a class is *coloured*
 * is a display concern and shouldn't be able to break the engine's test suite.
 *
 * Both the web report and the PDF import this. They must agree — a PDF that
 * flags different rows than the page it came from is exactly the drift the PDF
 * document's header comment warns about — so there is one copy, not two.
 */

import type { Agency } from "@/lib/nyc/types";

export type Tone = "neutral" | "caution" | "critical";

export function severityTone(agency: Agency, severity: string | null): Tone {
  if (!severity) return "neutral";
  const s = severity.toUpperCase().trim();

  if (agency === "HPD") {
    if (s === "C") return "critical"; // immediately hazardous
    if (s === "B") return "caution"; // hazardous
    return "neutral"; // A (non-hazardous), I (information order)
  }

  // ECB and OATH both carry a numeric class, sometimes embedded in a longer
  // code — the same digit extraction `severityLabel` performs.
  const digit = s.match(/(\d)/)?.[1];
  if (digit === "1") return "critical"; // immediately hazardous
  if (digit === "2") return "caution"; // major
  return "neutral"; // 3 (lesser), or an unrecognised code
}
