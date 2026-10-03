import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// A single persisted list of "never fetch a bid whose Items contains this
// word" keywords, managed from the Start Sync modal on the GeM Bids page.
// Sent along on every sync/start call as filterExcludeKeywords and, from
// there, written into the extension's own gemItemExcludeKeywords storage
// key (see background.js's pollAndMaybeStartAutoSync) so the exact same
// filterRowsByItemKeywords() check in content.js applies it — no separate
// filtering logic needed on the extension side for this to work.
const SETTINGS_COLLECTION = "gem_bid_settings";
// A plain field, not _id, so this singleton doc doesn't need to fight the
// MongoDB driver's typed _id: ObjectId filter shape.
const SETTINGS_KEY = "excludeKeywords";

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const doc = await db.collection(SETTINGS_COLLECTION).findOne({ key: SETTINGS_KEY });
    return NextResponse.json({ keywords: (doc && doc.keywords) || [] });
  } catch (error: unknown) {
    console.error("GeM bid exclude-keywords GET error:", error);
    const message = error instanceof Error ? error.message : "Failed to load exclude keywords";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: body { keywords: string[] } — replaces the whole list. The modal
// always sends the full array after a local add/remove, so this stays a
// plain upsert rather than needing separate add/remove endpoints.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { keywords } = body;
    if (!Array.isArray(keywords)) {
      return NextResponse.json({ error: "keywords must be an array" }, { status: 400 });
    }
    const cleaned: string[] = Array.from(
      new Set(
        (keywords as unknown[])
          .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
          .map((k) => k.trim())
      )
    );

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    await db
      .collection(SETTINGS_COLLECTION)
      .updateOne({ key: SETTINGS_KEY }, { $set: { keywords: cleaned, updatedAt: new Date() } }, { upsert: true });

    return NextResponse.json({ keywords: cleaned });
  } catch (error: unknown) {
    console.error("GeM bid exclude-keywords POST error:", error);
    const message = error instanceof Error ? error.message : "Failed to save exclude keywords";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
