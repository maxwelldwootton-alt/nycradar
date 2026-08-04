/**
 * Shareable read-only reports (FR6, Flow C).
 *
 * A share link stores a **snapshot** of the report rather than regenerating it
 * on view. A broker who forwards a report to a seller has described specific
 * numbers; regenerating on open could show different ones as city data moves,
 * with no indication anything changed. The snapshot also preserves the original
 * data-as-of date, which is what the disclaimer refers to.
 */

import "server-only";
import { randomBytes } from "node:crypto";
import { supabaseService, hasServiceRole } from "@/lib/supabase/server";
import type { ViolationReport } from "./types";

export class ShareUnavailableError extends Error {
  constructor() {
    super("Shareable links require SUPABASE_SERVICE_ROLE_KEY to be configured.");
    this.name = "ShareUnavailableError";
  }
}

/** 160 bits, url-safe. Long enough that tokens are not guessable. */
function newToken(): string {
  return randomBytes(20).toString("base64url");
}

export async function createShareLink(
  report: ViolationReport,
  opts: { accountId?: string | null } = {},
): Promise<{ token: string }> {
  if (!hasServiceRole()) throw new ShareUnavailableError();

  const token = newToken();
  const { error } = await supabaseService()
    .from("reports")
    .insert({
      token,
      bbl: report.property.bbl,
      address: report.property.address,
      snapshot: report,
      data_as_of: report.dataAsOf,
      account_id: opts.accountId ?? null,
    });

  if (error) throw new Error(`Could not create share link: ${error.message}`);
  return { token };
}

export interface SharedReport {
  report: ViolationReport;
  createdAt: string;
}

export async function getSharedReport(token: string): Promise<SharedReport | null> {
  if (!hasServiceRole()) throw new ShareUnavailableError();

  const { data, error } = await supabaseService()
    .from("reports")
    .select("snapshot, created_at, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error) throw new Error(`Could not load shared report: ${error.message}`);
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  // Snapshots are frozen JSON, so any field added to `ViolationReport` after a
  // link was created is simply absent from older rows — the cast alone would
  // hand consumers an `undefined` where they expect an array. Backfill rather
  // than 404 an otherwise-valid link.
  const snapshot = data.snapshot as ViolationReport;

  return {
    report: { ...snapshot, unavailableSources: snapshot.unavailableSources ?? [] },
    createdAt: data.created_at as string,
  };
}
