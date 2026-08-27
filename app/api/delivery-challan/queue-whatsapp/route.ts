import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// POST /api/delivery-challan/queue-whatsapp - called from the Orders page's
// "Send DC WhatsApp" button (Delivery tab). Queues one institute's Delivery
// Challan PDF (already rendered client-side, same jsPDF logic as the
// existing "Download Delivery Challan" button, just per-institute instead of
// combined) for the local whatsapp-bridge/ service to actually send - mirrors
// the courier-tracking WhatsApp queue's pull model (Vercel can't reach the
// bridge's PC directly).
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { instituteName, whatsappNumber, sellerId, orderNos, fileName, pdfBase64, requestedBy } = body;

    if (!instituteName || !whatsappNumber || !pdfBase64 || !fileName) {
      return NextResponse.json(
        { error: "instituteName, whatsappNumber, fileName, and pdfBase64 are required." },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    const doc = {
      instituteName,
      whatsappNumber,
      sellerId: sellerId || null,
      orderNos: Array.isArray(orderNos) ? orderNos : [],
      fileName,
      pdfBase64,
      status: "PENDING" as const,
      requestedBy: requestedBy || "",
      requestedAt: new Date(),
      sentAt: null,
      errorMessage: null,
    };

    const result = await db.collection("delivery_challan_whatsapp").insertOne(doc);

    return NextResponse.json({ success: true, id: result.insertedId });
  } catch (error: any) {
    console.error("POST delivery-challan/queue-whatsapp error:", error);
    return NextResponse.json({ error: error.message || "Failed to queue Delivery Challan WhatsApp send" }, { status: 500 });
  }
}
