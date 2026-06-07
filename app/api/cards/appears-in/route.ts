import { NextResponse } from "next/server";
import { findCardAppearances } from "@/lib/cardAppearances";

/**
 * GET /api/cards/appears-in?setCode=TWM&number=130&offset=10&limit=10
 *
 * Returns top meta archetype variants that include this exact printing.
 * Used by the card detail page's "Appears in" carousel for lazy-load
 * pagination after the initial server-rendered batch.
 */
export function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const setCode = (searchParams.get("setCode") ?? "").trim();
  const number = (searchParams.get("number") ?? "").trim();
  const offset = Math.max(0, Number(searchParams.get("offset") ?? "0") || 0);
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? "10") || 10));

  if (!setCode || !number) {
    return NextResponse.json({ error: "setCode and number are required" }, { status: 400 });
  }

  const result = findCardAppearances(setCode, number, offset, limit);
  return NextResponse.json(result);
}
