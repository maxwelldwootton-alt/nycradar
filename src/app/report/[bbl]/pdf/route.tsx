import { renderToBuffer } from "@react-pdf/renderer";
import { generateReport } from "@/lib/nyc/report";
import { getProperty } from "@/lib/nyc/property";
import { normalizeBbl } from "@/lib/nyc/bbl";
import { ReportDocument } from "@/lib/pdf/ReportDocument";
import { resolveAccess } from "@/lib/auth/entitlement";

export const dynamic = "force-dynamic";
// PDF generation for a large property is well over the default budget.
export const maxDuration = 120;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bbl: string }> },
) {
  const { bbl: raw } = await params;
  const bbl = normalizeBbl(raw);
  if (!bbl) {
    return new Response("Invalid BBL", { status: 400 });
  }

  // Gate the PDF exactly as the page is gated. Without this the paywall is
  // trivially bypassed by requesting the export URL directly.
  const access = await resolveAccess(bbl);
  if (!access.canViewFullReport) {
    return new Response("This report requires a free lookup or a subscription.", {
      status: 402,
    });
  }

  try {
    const property = await getProperty(bbl).catch(() => null);
    const report = await generateReport(bbl, { property: property ?? undefined });
    const buffer = await renderToBuffer(<ReportDocument report={report} />);

    const slug = (property?.address ?? bbl)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="violation-report-${slug}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("PDF generation failed", err);
    return new Response("Could not generate the PDF report", { status: 502 });
  }
}
