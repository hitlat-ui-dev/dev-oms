import { NextResponse } from "next/server";
import mongoose from "mongoose";
import CourierRunLog from "@/models/CourierRunLog";

// POST /api/courier/queue-whatsapp - called from the Courier Tracking page
// when the user selects one or more matched parcels and clicks "Send
// WhatsApp". Flips just those parcels from NOT_SENT (or a previously
// FAILED retry) to PENDING - the only status the whatsapp-bridge service
// actually polls for and sends. Sending is always this explicit, manual,
// per-parcel action - it never happens automatically at match time.
export async function POST(req: Request) {
  try {
    if (mongoose.connection.readyState !== 1 && process.env.MONGODB_URI) {
      await mongoose.connect(process.env.MONGODB_URI);
    }

    const body = await req.json();
    const { date, docketNos } = body;

    if (!date || !Array.isArray(docketNos) || docketNos.length === 0) {
      return NextResponse.json({ error: "date and a non-empty docketNos array are required." }, { status: 400 });
    }

    const result = await CourierRunLog.updateOne(
      { date },
      { $set: { "matched.$[elem].whatsappStatus": "PENDING" } },
      {
        arrayFilters: [
          { "elem.docketNo": { $in: docketNos }, "elem.whatsappStatus": { $in: ["NOT_SENT", "FAILED"] } },
        ],
      }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: `No courier run found for date=${date}.` }, { status: 404 });
    }

    // modifiedCount is document-level (always 0 or 1 here, regardless of how
    // many array elements the arrayFilters touched) - not useful as a
    // per-parcel count, so it's omitted rather than reported misleadingly.
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("POST queue-whatsapp error:", error);
    return NextResponse.json({ error: error.message || "Failed to queue WhatsApp sends" }, { status: 500 });
  }
}
