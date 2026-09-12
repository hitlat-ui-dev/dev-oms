import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";

// GET /api/dispatch-labels/[id] - single record for the public receipt page
// (app/dispatch/page.tsx?id=...), used by the "View" link on the Dispatch
// History table. No auth check - deliberately public, same as every other
// route in this app; the same page is what a courier/recipient reaches by
// scanning the QR on a parcel they are already holding.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid dispatch label id" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();
    const label = await db.collection("dispatchLabels").findOne({ _id: new ObjectId(id) });

    if (!label) {
      return NextResponse.json({ error: "Dispatch label not found" }, { status: 404 });
    }

    return NextResponse.json(label);
  } catch (error: any) {
    console.error("Dispatch label fetch error:", error);
    return NextResponse.json({ error: error.message || "Failed to load dispatch label" }, { status: 500 });
  }
}
