import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// A small, growable list of "outside party" names (e.g. "vinay") that can
// handle an order under one of our firms - kept as a dedicated collection
// (rather than free text on the order) so the Add Order form can offer a
// dropdown instead of risking a typo that silently splits one party's
// orders across two spellings and breaks year-end filtering.
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();
    const parties = await db.collection("order_parties").find({}).sort({ name: 1 }).toArray();
    return NextResponse.json(parties.map((p: any) => p.name));
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(req: Request) {
  try {
    const { name } = await req.json();
    const trimmed = String(name || "").trim().toLowerCase();
    if (!trimmed) {
      return NextResponse.json({ error: "Party name is required" }, { status: 400 });
    }
    const client = await clientPromise;
    const db = client.db();
    const existing = await db.collection("order_parties").findOne({ name: trimmed });
    if (!existing) {
      await db.collection("order_parties").insertOne({ name: trimmed, createdAt: new Date() });
    }
    return NextResponse.json({ success: true, name: trimmed });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to add party" }, { status: 500 });
  }
}
