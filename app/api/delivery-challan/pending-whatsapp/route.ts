import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// GET /api/delivery-challan/pending-whatsapp - polled by the local
// whatsapp-bridge/ service, same secret-gated pull model as
// /api/courier/pending-whatsapp. Returns the full pdfBase64 payload since the
// bridge needs it to actually send the file.
export async function GET(req: Request) {
  try {
    const secret = req.headers.get("x-bridge-secret");
    if (!secret || secret !== process.env.COURIER_BRIDGE_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    const pending = await db
      .collection("delivery_challan_whatsapp")
      .find({ status: "PENDING" })
      .sort({ requestedAt: 1 })
      .toArray();

    return NextResponse.json({ success: true, pending });
  } catch (error: any) {
    console.error("GET delivery-challan/pending-whatsapp error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch pending sends" }, { status: 500 });
  }
}
