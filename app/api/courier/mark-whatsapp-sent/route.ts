import { NextResponse } from "next/server";
import mongoose from "mongoose";
import CourierRunLog from "@/models/CourierRunLog";

// POST /api/courier/mark-whatsapp-sent - called by the local whatsapp-bridge/
// service after it attempts to send one message, reporting back whether it
// worked. Identifies the exact parcel by { date, docketNo } inside that
// day's CourierRunLog.matched[] array.
export async function POST(req: Request) {
  try {
    const secret = req.headers.get("x-bridge-secret");
    if (!secret || secret !== process.env.COURIER_BRIDGE_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (mongoose.connection.readyState !== 1 && process.env.MONGODB_URI) {
      await mongoose.connect(process.env.MONGODB_URI);
    }

    const body = await req.json();
    const { date, docketNo, status } = body;

    if (!date || !docketNo || (status !== "SENT" && status !== "FAILED")) {
      return NextResponse.json({ error: "date, docketNo, and status ('SENT'|'FAILED') are required." }, { status: 400 });
    }

    const result = await CourierRunLog.updateOne(
      { date, "matched.docketNo": docketNo },
      { $set: { "matched.$.whatsappStatus": status } }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: `No matched parcel found for date=${date}, docketNo=${docketNo}.` }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("POST mark-whatsapp-sent error:", error);
    return NextResponse.json({ error: error.message || "Failed to mark parcel status" }, { status: 500 });
  }
}
