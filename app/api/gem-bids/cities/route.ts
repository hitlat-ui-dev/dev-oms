import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// A per-state cache of GeM's own Consignee City list, so the Start Sync
// modal on the GeM Bids page can show a real multi-select checkbox list
// instead of a free-text box. The OMS can't fetch this from GeM directly
// (bidplus.gem.gov.in blocks non-browser requests, per the extension's
// README) — the cache is instead populated by the GeM Bid Exporter
// extension's own "Load All Cities From GeM" button, which already reads
// the real dropdown out of a live, logged-in browser tab and posts the
// result here (see popup.js's btnLoadCities handler).
const CITY_CACHE_COLLECTION = "gem_bid_city_cache";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const state = (searchParams.get("state") || "").trim();
    if (!state) {
      return NextResponse.json({ error: "state is required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const doc = await db.collection(CITY_CACHE_COLLECTION).findOne({ state });
    return NextResponse.json({ cities: (doc && doc.cities) || [], updatedAt: (doc && doc.updatedAt) || null });
  } catch (error: unknown) {
    console.error("GeM bid cities GET error:", error);
    const message = error instanceof Error ? error.message : "Failed to load city cache";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: body { state, cities: string[] } — upserts this state's cached city
// list. Called by the extension after a successful "Load All Cities From
// GeM", not by the OMS UI itself.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { state, cities } = body;
    if (!state || typeof state !== "string" || !state.trim()) {
      return NextResponse.json({ error: "state is required" }, { status: 400 });
    }
    if (!Array.isArray(cities)) {
      return NextResponse.json({ error: "cities must be an array" }, { status: 400 });
    }
    const cleaned: string[] = Array.from(
      new Set(
        (cities as unknown[])
          .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
          .map((c) => c.trim())
      )
    );

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    await db
      .collection(CITY_CACHE_COLLECTION)
      .updateOne({ state: state.trim() }, { $set: { cities: cleaned, updatedAt: new Date() } }, { upsert: true });

    return NextResponse.json({ cities: cleaned });
  } catch (error: unknown) {
    console.error("GeM bid cities POST error:", error);
    const message = error instanceof Error ? error.message : "Failed to save city cache";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
