import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// GET /api/delivery-challan/whatsapp-status - shown on the Courier Tracking
// page's separate "Delivery Challan WhatsApp Status" section. No secret gate
// (viewed by logged-in OMS staff, not polled by the bridge) - pdfBase64 is
// left out of the projection since it's large and the UI never needs it.
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    const records = await db
      .collection("delivery_challan_whatsapp")
      .find({}, { projection: { pdfBase64: 0 } })
      .sort({ requestedAt: -1 })
      .limit(100)
      .toArray();

    return NextResponse.json({ success: true, records });
  } catch (error: any) {
    console.error("GET delivery-challan/whatsapp-status error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch status" }, { status: 500 });
  }
}
