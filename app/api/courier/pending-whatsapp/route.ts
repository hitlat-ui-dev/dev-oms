import { NextResponse } from "next/server";
import mongoose from "mongoose";
import CourierRunLog from "@/models/CourierRunLog";

// GET /api/courier/pending-whatsapp - polled by the local whatsapp-bridge/
// service (Vercel can't be reached FROM the bridge's PC the other way
// around, so the bridge pulls work instead of being pushed to). Returns
// every matched parcel across recent runs still waiting to be sent -
// scanning more than just today covers the bridge having been offline for a
// day or more. Secret-protected since this returns institute names/phone
// numbers.
export async function GET(req: Request) {
  try {
    const secret = req.headers.get("x-bridge-secret");
    if (!secret || secret !== process.env.COURIER_BRIDGE_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (mongoose.connection.readyState !== 1 && process.env.MONGODB_URI) {
      await mongoose.connect(process.env.MONGODB_URI);
    }

    // Recent window only (30 days) - anything older is stale enough that a
    // human should be looking at it, not the bridge silently retrying it.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const logs = await CourierRunLog.find({ timestamp: { $gte: cutoff } }).lean();

    const pending: Array<{
      date: string;
      docketNo: string;
      whatsappNumber: string;
      instituteName: string;
      firmName: string;
      buyerName?: string;
      city: string;
    }> = [];

    for (const log of logs) {
      for (const parcel of log.matched || []) {
        if (parcel.whatsappStatus === "PENDING" && parcel.whatsappNumber) {
          pending.push({
            date: log.date,
            docketNo: parcel.docketNo,
            whatsappNumber: parcel.whatsappNumber,
            instituteName: parcel.instituteName,
            firmName: parcel.firmName,
            buyerName: parcel.buyerName,
            city: parcel.city,
          });
        }
      }
    }

    return NextResponse.json({ success: true, pending });
  } catch (error: any) {
    console.error("GET pending-whatsapp error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch pending sends" }, { status: 500 });
  }
}
