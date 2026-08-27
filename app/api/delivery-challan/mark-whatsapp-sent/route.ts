import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// POST /api/delivery-challan/mark-whatsapp-sent - called by the local
// whatsapp-bridge/ service after it attempts to send one Delivery Challan
// PDF, reporting back whether it worked.
export async function POST(req: Request) {
  try {
    const secret = req.headers.get("x-bridge-secret");
    if (!secret || secret !== process.env.COURIER_BRIDGE_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { id, status, errorMessage } = body;

    if (!id || (status !== "SENT" && status !== "FAILED")) {
      return NextResponse.json({ error: "id and status ('SENT'|'FAILED') are required." }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    const result = await db.collection("delivery_challan_whatsapp").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status,
          sentAt: status === "SENT" ? new Date() : null,
          errorMessage: errorMessage || null,
          // PDF payload isn't needed once the send attempt is resolved -
          // dropping it keeps this collection from growing unbounded with
          // large base64 blobs long after they're no longer useful.
          pdfBase64: "",
        },
      }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: `No queued send found for id=${id}.` }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("POST delivery-challan/mark-whatsapp-sent error:", error);
    return NextResponse.json({ error: error.message || "Failed to mark send status" }, { status: 500 });
  }
}
