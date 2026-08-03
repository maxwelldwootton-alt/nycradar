import { NextResponse } from "next/server";
import { z } from "zod";
import { searchProperties } from "@/lib/nyc/property";

const querySchema = z.object({
  q: z.string().min(1).max(120),
  borough: z.enum(["1", "2", "3", "4", "5"]).nullish(),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get("q") ?? "",
    borough: url.searchParams.get("borough") || null,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid search query" }, { status: 400 });
  }

  try {
    const results = await searchProperties(parsed.data.q, {
      borough: parsed.data.borough ?? null,
      limit: parsed.data.limit,
    });
    return NextResponse.json({ results });
  } catch (err) {
    console.error("search failed", err);
    return NextResponse.json({ error: "Search is unavailable" }, { status: 502 });
  }
}
