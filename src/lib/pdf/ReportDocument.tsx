/**
 * PDF rendering of a violation report (FR6).
 *
 * Kept deliberately close to the on-screen report: brokers forward this to
 * clients, and a PDF that disagrees with the web page it came from would
 * undermine the whole product. The disclaimer and data-as-of date appear on
 * every page, not just the first, because pages get separated once printed.
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { ViolationReport } from "@/lib/nyc/types";
import { severityLabel } from "@/lib/nyc/classify";
import { severityTone, type Tone } from "@/components/ui/severity";

/**
 * Every colour here names the `--token` in src/app/globals.css it mirrors, so
 * the two cannot drift silently. The PDF is a print artefact and therefore
 * tracks the *light* scheme only — there is no dark paper.
 *
 * Typeface is Geist, matching the site. It is read off disk rather than
 * fetched — see src/lib/pdf/fonts.ts for why, and for the tracing config that
 * keeps the files present in the deployed bundle.
 */
const styles = StyleSheet.create({
  page: {
    paddingTop: 42, paddingBottom: 70, paddingHorizontal: 42,
    fontFamily: "Geist", fontSize: 9, color: "#0f172a", // --ink
  },
  brandBar: { height: 2, backgroundColor: "#1d4ed8", marginBottom: 10 }, // --accent
  brand: { fontSize: 8, fontWeight: 700, color: "#1e40af", letterSpacing: 0.6, marginBottom: 3 }, // --accent-hover, for print headroom
  h1: { fontSize: 16, fontWeight: 700, marginBottom: 3 },
  sub: { fontSize: 9, color: "#475569" }, // --ink-body
  statRow: { flexDirection: "row", gap: 8, marginTop: 14, marginBottom: 6 },
  stat: { flex: 1, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 4, padding: 8 }, // --line
  statCaution: { borderColor: "#fcd34d", backgroundColor: "#fffbeb" }, // --caution-line / --caution-soft
  statCritical: { borderColor: "#fca5a5", backgroundColor: "#fee2e2" }, // --critical-line / --critical-soft
  statLabel: { fontSize: 6.5, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }, // --ink-muted
  statValue: { fontSize: 14, fontWeight: 700, marginTop: 2 },
  statValueCaution: { color: "#b45309" }, // --caution
  statValueCritical: { color: "#b91c1c" }, // --critical
  notice: {
    marginTop: 8, padding: 6, borderRadius: 3,
    // Neutral, matching the web report: blue now means "interactive" system-wide.
    backgroundColor: "#f1f5f9", color: "#475569", fontSize: 8, // --sunken / --ink-body
  },
  h2: {
    fontSize: 11, fontWeight: 700, marginTop: 18, marginBottom: 2,
    borderBottomWidth: 1, borderBottomColor: "#e2e8f0", paddingBottom: 3,
  },
  sectionMeta: { fontSize: 8, color: "#475569", marginBottom: 5 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#f1f5f9", paddingVertical: 3 },
  th: { fontSize: 6.5, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3 },
  cStatus: { width: 38 },
  cDate: { width: 52 },
  cClass: { width: 70 },
  cDesc: { flex: 1, paddingRight: 6 },
  cAmt: { width: 52, textAlign: "right" },
  open: { color: "#b91c1c", fontWeight: 700 }, // --critical
  critical: { color: "#b91c1c", fontWeight: 700 },
  caution: { color: "#b45309", fontWeight: 700 }, // --caution
  muted: { color: "#64748b" },
  footer: {
    position: "absolute", bottom: 26, left: 42, right: 42,
    fontSize: 6.5, color: "#64748b", lineHeight: 1.4,
    borderTopWidth: 1, borderTopColor: "#e2e8f0", paddingTop: 6,
  },
  footerBrand: { color: "#1e40af", fontWeight: 700 },
});

/** Same tone decision the web report uses — imported, not re-implemented. */
const SEVERITY_STYLES: Record<Tone, typeof styles.muted> = {
  neutral: styles.muted,
  caution: styles.caution,
  critical: styles.critical,
};

function money(n: number | null): string {
  if (!n) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(iso: string | null): string {
  if (!iso) return "date unavailable";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York",
  });
}

const AGENCY_LABELS: Record<string, string> = {
  DOB: "Department of Buildings",
  HPD: "Housing Preservation & Development",
  ECB: "ECB / OATH summonses (DOB-issued)",
  OATH: "OATH hearings (other agencies)",
};

/** Bounded so a Co-op City-scale property cannot produce a 400-page PDF. */
const MAX_ROWS_PER_SECTION = 60;

export function ReportDocument({ report }: { report: ViolationReport }) {
  const { property, summary } = report;
  const title = property.address ?? `Block ${property.block}, Lot ${property.lot}`;

  return (
    <Document title={`${title} — violation report`}>
      <Page size="LETTER" style={styles.page} wrap>
        <View>
          <View style={styles.brandBar} />
          <Text style={styles.brand}>VIOLATIONRADAR</Text>
          <Text style={styles.h1}>{title}</Text>
          <Text style={styles.sub}>
            {property.borough}
            {property.zip ? ` ${property.zip}` : ""} · BBL {property.bbl}
            {property.isCondoBillingLot ? " · condominium billing lot" : ""}
          </Text>
          <Text style={styles.sub}>Data as of {formatDate(report.dataAsOf)}</Text>
        </View>

        {/* Tones match ReportView's stat cards exactly — a PDF that emphasises
            different figures than the page it came from is the drift this file
            exists to avoid. */}
        <View style={styles.statRow}>
          <View style={[styles.stat, ...(summary.openViolations > 0 ? [styles.statCritical] : [])]}>
            <Text style={styles.statLabel}>Open violations</Text>
            <Text
              style={[
                styles.statValue,
                ...(summary.openViolations > 0 ? [styles.statValueCritical] : []),
              ]}
            >
              {summary.openViolations.toLocaleString()}
            </Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Total on record</Text>
            <Text style={styles.statValue}>{summary.totalViolations.toLocaleString()}</Text>
          </View>
          <View style={[styles.stat, ...(summary.totalBalanceDue > 0 ? [styles.statCaution] : [])]}>
            <Text style={styles.statLabel}>Outstanding balance</Text>
            <Text
              style={[
                styles.statValue,
                ...(summary.totalBalanceDue > 0 ? [styles.statValueCaution] : []),
              ]}
            >
              {money(summary.totalBalanceDue)}
            </Text>
          </View>
          <View style={[styles.stat, ...(summary.docketedJudgments > 0 ? [styles.statCaution] : [])]}>
            <Text style={styles.statLabel}>Docketed judgments</Text>
            <Text
              style={[
                styles.statValue,
                ...(summary.docketedJudgments > 0 ? [styles.statValueCaution] : []),
              ]}
            >
              {summary.docketedJudgments.toLocaleString()}
            </Text>
          </View>
        </View>

        {report.warnings.map((w) => (
          <Text key={w} style={styles.notice}>
            {w}
          </Text>
        ))}

        {report.sections.map((section) => (
          <View key={section.agency}>
            <Text style={styles.h2}>{AGENCY_LABELS[section.agency] ?? section.agency}</Text>
            <Text style={styles.sectionMeta}>
              {section.open.toLocaleString()} open of {section.total.toLocaleString()} total
              {section.balanceDue > 0 ? ` · ${money(section.balanceDue)} outstanding` : ""}
              {section.recoveredByBin ? " · matched by building ID" : ""}
            </Text>

            {section.total === 0 ? (
              <Text style={styles.muted}>No records found for this property.</Text>
            ) : (
              <View>
                <View style={styles.tr}>
                  <Text style={[styles.th, styles.cStatus]}>Status</Text>
                  <Text style={[styles.th, styles.cDate]}>Issued</Text>
                  <Text style={[styles.th, styles.cClass]}>Class</Text>
                  <Text style={[styles.th, styles.cDesc]}>Description</Text>
                  <Text style={[styles.th, styles.cAmt]}>Balance</Text>
                </View>
                {section.violations.slice(0, MAX_ROWS_PER_SECTION).map((v) => (
                  <View key={`${v.sourceDataset}-${v.sourceId}`} style={styles.tr} wrap={false}>
                    <Text style={[styles.cStatus, ...(v.status === "open" ? [styles.open] : [styles.muted])]}>
                      {v.status === "open" ? "Open" : v.status === "closed" ? "Closed" : "—"}
                    </Text>
                    <Text style={[styles.cDate, styles.muted]}>{v.issuedDate ?? "—"}</Text>
                    <Text
                      style={[
                        styles.cClass,
                        SEVERITY_STYLES[severityTone(v.agency, v.severity)],
                      ]}
                    >
                      {severityLabel(v.agency, v.severity) ?? "—"}
                    </Text>
                    <Text style={styles.cDesc}>
                      {v.description ?? "—"}
                      {v.judgmentDocketed ? `  [judgment docketed ${v.judgmentDocketed}]` : ""}
                    </Text>
                    <Text style={styles.cAmt}>{money(v.balanceDue)}</Text>
                  </View>
                ))}
                {section.violations.length > MAX_ROWS_PER_SECTION && (
                  <Text style={[styles.muted, { marginTop: 4 }]}>
                    Showing {MAX_ROWS_PER_SECTION} of {section.total.toLocaleString()} records.
                    The full list is available in the online report.
                  </Text>
                )}
              </View>
            )}
          </View>
        ))}

        {/* Repeated on every page: printed pages get separated from each other. */}
        <Text style={styles.footer} fixed>
          <Text style={styles.footerBrand}>ViolationRadar</Text>
          {" · "}Compiled from public NYC Open Data records published by DOB, HPD and
          OATH as of {formatDate(report.dataAsOf)}. Informational only. Not legal advice, not a
          title search, and not a substitute for independent verification before closing.
          Report generated {formatDate(report.generatedAt)}.
        </Text>
      </Page>
    </Document>
  );
}
