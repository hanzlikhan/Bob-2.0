import { NextResponse } from "next/server";
import { getRunHistory } from "@/lib/supabase/client";

export const runtime = "nodejs";

/**
 * GET /api/history?limit=20&offset=0
 *
 * List recent pipeline runs with pagination.
 *
 * @returns {{ runs: object[], total: number, limit: number, offset: number }}
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    // ── Parse and validate pagination params ──────────────────────────────────
    let limit = parseInt(searchParams.get("limit") || "20", 10);
    let offset = parseInt(searchParams.get("offset") || "0", 10);

    if (isNaN(limit) || limit < 1) limit = 20;
    if (isNaN(offset) || offset < 0) offset = 0;
    if (limit > 100) limit = 100; // Cap at 100

    const result = await getRunHistory({ limit, offset });

    return NextResponse.json({
      ...result,
      limit,
      offset,
    });
  } catch (err) {
    console.error("[api/history] error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to fetch history" },
      { status: 500 }
    );
  }
}
