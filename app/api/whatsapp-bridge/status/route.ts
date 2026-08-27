import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// Single-document status the local whatsapp-bridge/ service pushes to
// whenever its WhatsApp Web connection state changes (qr/ready/disconnected/
// auth_failure) - lets the Courier Tracking page show login state (and the
// QR itself, when a re-login is needed) without anyone needing terminal
// access to the PC the bridge runs on.
const STATUS_DOC_ID = "whatsapp_bridge_status";

// POST - called by the bridge (secret-gated, same COURIER_BRIDGE_SECRET as
// the courier/delivery-challan queues).
export async function POST(req: Request) {
  try {
    const secret = req.headers.get("x-bridge-secret");
    if (!secret || secret !== process.env.COURIER_BRIDGE_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { status, qrDataUrl } = body;

    if (!["NEEDS_QR", "CONNECTED", "DISCONNECTED"].includes(status)) {
      return NextResponse.json({ error: "status must be NEEDS_QR, CONNECTED, or DISCONNECTED." }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    await db.collection("whatsapp_bridge_status").updateOne(
      { _id: STATUS_DOC_ID as any },
      { $set: { status, qrDataUrl: qrDataUrl || null, updatedAt: new Date() } },
      { upsert: true }
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("POST whatsapp-bridge/status error:", error);
    return NextResponse.json({ error: error.message || "Failed to update bridge status" }, { status: 500 });
  }
}

// GET - polled by the Courier Tracking page, no secret (just login-gated
// like the rest of OMS - the QR itself isn't a credential by itself, only
// scanning it links a device).
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    const doc = await db.collection("whatsapp_bridge_status").findOne({ _id: STATUS_DOC_ID as any });

    return NextResponse.json({
      success: true,
      status: doc?.status || "UNKNOWN",
      qrDataUrl: doc?.qrDataUrl || null,
      updatedAt: doc?.updatedAt || null,
    });
  } catch (error: any) {
    console.error("GET whatsapp-bridge/status error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch bridge status" }, { status: 500 });
  }
}
