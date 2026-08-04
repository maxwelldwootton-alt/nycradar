/**
 * Persist a generated report's rows to Postgres.
 *
 * Nothing reads these tables yet — serving is handled by `getCachedReport`'s
 * in-memory Next data cache. This exists because `violations` and
 * `property_fetches` were schema with no writer, and because the v2 alerts
 * feature ("tell me when this property picks up a new violation") is a diff
 * against history that has to start accumulating before it can be diffed.
 *
 * Three rules, all of them load-bearing:
 *
 *   1. Best-effort. A failed write must never fail a report the user is
 *      already looking at — this is bookkeeping, not the product.
 *   2. Complete reports only. Writing a report generated during a DOB outage
 *      would record "no DOB violations" as fact, and a later alerts diff would
 *      read the agency's recovery as a burst of brand-new violations.
 *   3. Deferred. Runs via `after()` so it lands outside the response.
 */

import "server-only";
import { after } from "next/server";
import { supabaseService, hasServiceRole } from "@/lib/supabase/server";
import { isReportComplete } from "./report";
import type { ViolationReport } from "./types";

/**
 * Supabase caps request bodies, and a Co-op City-scale lot can carry thousands
 * of rows with `raw` JSON attached. Chunking keeps any single statement small
 * enough that one oversized property cannot fail the whole write.
 */
const CHUNK = 500;

/** Dates arrive from Socrata as full timestamps; the columns are `date`. */
function toDate(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

async function persist(report: ViolationReport): Promise<void> {
  const db = supabaseService();
  const bbl = report.property.bbl;

  const rows = report.sections.flatMap((section) =>
    section.violations.map((v) => ({
      agency: v.agency,
      source_dataset: v.sourceDataset,
      source_id: v.sourceId,
      dedup_key: v.dedupKey,
      bbl: v.bbl,
      bin: v.bin,
      issued_date: toDate(v.issuedDate),
      status: v.status,
      raw_status: v.rawStatus,
      severity: v.severity,
      description: v.description,
      balance_due: v.balanceDue,
      penalty_imposed: v.penaltyImposed,
      judgment_docketed: toDate(v.judgmentDocketed),
      issuing_agency: v.issuingAgency,
      correction_type: v.correctionType,
      matched_by: v.matchedBy,
      raw: v.raw,
      fetched_at: report.generatedAt,
    })),
  );

  for (let i = 0; i < rows.length; i += CHUNK) {
    // Conflict target is the natural key, so re-fetching a property updates
    // statuses and balances in place rather than duplicating its history.
    const { error } = await db
      .from("violations")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "source_dataset,source_id" });
    if (error) {
      console.error(`could not persist violations for ${bbl}`, error.message);
      return;
    }
  }

  // Provenance: the portal's own rowsUpdatedAt per dataset, plus how many rows
  // we saw. `row_count` is the section total, not the detail-row count, so a
  // capped section records what exists rather than what we displayed.
  const totalsByDataset = new Map<string, number>();
  for (const section of report.sections) {
    for (const v of section.violations) {
      totalsByDataset.set(v.sourceDataset, section.total);
    }
  }

  const fetches = Object.entries(report.perSourceUpdatedAt).map(
    ([datasetId, rowsUpdatedAt]) => ({
      bbl,
      dataset_id: datasetId,
      rows_updated_at: rowsUpdatedAt,
      fetched_at: report.generatedAt,
      row_count: totalsByDataset.get(datasetId) ?? 0,
    }),
  );

  if (fetches.length > 0) {
    const { error } = await db
      .from("property_fetches")
      .upsert(fetches, { onConflict: "bbl,dataset_id" });
    if (error) {
      console.error(`could not persist fetch provenance for ${bbl}`, error.message);
    }
  }
}

/**
 * Queue a report for persistence after the response is sent.
 *
 * Safe to call on every report render: incomplete reports and deployments
 * without a service-role key are dropped here rather than at each call site.
 */
export function persistReport(report: ViolationReport): void {
  if (!hasServiceRole() || !isReportComplete(report)) return;

  after(async () => {
    try {
      await persist(report);
    } catch (err) {
      // Deliberately swallowed: this runs after the response, so throwing
      // here would only surface as an unhandled rejection in the logs.
      console.error("report persistence failed", err);
    }
  });
}
