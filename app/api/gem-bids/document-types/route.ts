import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// A single shared list of "document type" names — one master vocabulary
// used in two places: the Edit Bid modal's "Document required from seller"
// multi-select (GemBidTable.tsx) and Bid Document Maker's per-firm document
// vault (document-maker/page.tsx, its "Field name" input). Keeping them on
// the same list is the point — a bid can say it needs "PAN Card" and a
// firm's vault can have a document literally named "PAN Card", so Document
// Maker can eventually match required-vs-available by that shared name.
const SETTINGS_COLLECTION = "gem_bid_settings";
const SETTINGS_KEY = "documentTypes";

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const doc = await db.collection(SETTINGS_COLLECTION).findOne({ key: SETTINGS_KEY });
    return NextResponse.json({ documentTypes: (doc && doc.documentTypes) || [] });
  } catch (error: unknown) {
    console.error("GeM bid document-types GET error:", error);
    const message = error instanceof Error ? error.message : "Failed to load document types";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: body { add: string } — appends one new document type name (case-
// insensitive de-dupe against what's already there). Single-item add
// (rather than a full-list replace like the sibling exclude-keywords route)
// because two different pages can each add a name here independently and
// concurrently - a full-list overwrite from one could silently drop
// whatever the other just added.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { add } = body;
    if (!add || typeof add !== "string" || !add.trim()) {
      return NextResponse.json({ error: "add is required" }, { status: 400 });
    }
    const name = add.trim();

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const collection = db.collection(SETTINGS_COLLECTION);

    const existing = await collection.findOne({ key: SETTINGS_KEY });
    const current: string[] = (existing && existing.documentTypes) || [];
    const alreadyThere = current.some((t) => t.toLowerCase() === name.toLowerCase());
    const next = alreadyThere ? current : [...current, name];

    await collection.updateOne(
      { key: SETTINGS_KEY },
      { $set: { documentTypes: next, updatedAt: new Date() } },
      { upsert: true }
    );

    return NextResponse.json({ documentTypes: next });
  } catch (error: unknown) {
    console.error("GeM bid document-types POST error:", error);
    const message = error instanceof Error ? error.message : "Failed to save document type";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
