import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// One GeM portal login (User ID + Password + Mail ID) per firm, per USER -
// this is a personal vault, not a shared team resource: every team member
// gets their own set, scoped by username, invisible to everyone else. Kept
// in its own collection rather than on the companies document so this page
// can stay focused/lightweight and doesn't have to also satisfy Company
// Setup's GSTIN/PAN requirements just to save a credential.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const username = (searchParams.get("username") || "").trim();
    if (!username) {
      return NextResponse.json({ error: "username is required" }, { status: 400 });
    }
    const client = await clientPromise;
    const db = client.db();
    const creds = await db.collection("gem_credentials").find({ username }).sort({ firmCode: 1 }).toArray();
    return NextResponse.json(creds);
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const username = String(body.username || "").trim();
    const firmCode = String(body.firmCode || "").trim().toUpperCase();
    if (!username) {
      return NextResponse.json({ error: "username is required" }, { status: 400 });
    }
    if (!firmCode) {
      return NextResponse.json({ error: "Firm is required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();

    const update = {
      username,
      firmCode,
      gemUserId: String(body.gemUserId || "").trim(),
      gemPassword: String(body.gemPassword || ""),
      gemMailId: String(body.gemMailId || "").trim(),
      updatedAt: new Date(),
    };

    await db.collection("gem_credentials").updateOne(
      { username, firmCode },
      { $set: update, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to save credentials" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const username = (searchParams.get("username") || "").trim();
    const firmCode = (searchParams.get("firmCode") || "").trim().toUpperCase();
    if (!username || !firmCode) {
      return NextResponse.json({ error: "username and firmCode are required" }, { status: 400 });
    }
    const client = await clientPromise;
    const db = client.db();
    await db.collection("gem_credentials").deleteOne({ username, firmCode });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to delete credentials" }, { status: 500 });
  }
}
