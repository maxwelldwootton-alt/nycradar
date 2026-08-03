import { NextResponse } from "next/server";
import { z } from "zod";
import { generateReport } from "@/lib/nyc/report";
import { getProperty } from "@/lib/nyc/property";
import { normalizeBbl } from "@/lib/nyc/bbl";
import { createShareLink, ShareUnavailableError } from "@/lib/nyc/share";
import { resolveAccess } from "@/lib/auth/entitlement";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({ bbl: z.string().min(1).max(20) });

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A BBL is required" }, { status: 400 });
  }

  const bbl = normalizeBbl(parsed.data.bbl);
  if (!bbl) {
    return NextResponse.json({ error: "Invalid BBL" }, { status: 400 });
  }

  // A share link is a full report handed to an unauthenticated viewer, so the
  // creator must be entitled to the full report themselves.
  const access = await resolveAccess(bbl);
  if (!access.canViewFullReport) {
    return NextResponse.json(
      { error: "This report requires a free lookup or a subscription." },
      { status: 402 },
    );
  }

  try {
    const property = await getProperty(bbl).catch(() => null);
    const report = await generateReport(bbl, { property: property ?? undefined });
    const { token } = await createShareLink(report, { accountId: access.accountId });

    const base =
      process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
    return NextResponse.json({ url: `${base}/r/${token}`, token });
  } catch (err) {
    if (err instanceof ShareUnavailableError) {
      return NextResponse.json(
        { error: "Sharing is not configured on this deployment." },
        { status: 503 },
      );
    }
    console.error("share link creation failed", err);
    return NextResponse.json(
      { error: "Could not create a shareable link" },
      { status: 502 },
    );
  }
}
