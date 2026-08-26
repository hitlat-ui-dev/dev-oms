import { NextResponse } from "next/server";
import mongoose from "mongoose";
import CourierRunLog from "@/models/CourierRunLog";
import Seller from "@/models/Seller";

// POST /api/courier/update-matched-institute - called from the Courier
// Tracking page when staff spot a wrong auto-match and correct it. The
// replacement must be an actual Seller record (picked from a dropdown, not
// free text) so the corrected name always matches a real institute and its
// WhatsApp number stays in sync.
export async function POST(req: Request) {
  try {
    if (mongoose.connection.readyState !== 1 && process.env.MONGODB_URI) {
      await mongoose.connect(process.env.MONGODB_URI);
    }

    const { date, docketNo, sellerId } = await req.json();
    if (!date || !docketNo || !sellerId) {
      return NextResponse.json({ error: "date, docketNo and sellerId are required." }, { status: 400 });
    }

    const seller = await Seller.findById(sellerId).lean() as any;
    if (!seller) {
      return NextResponse.json({ error: `No seller found for id=${sellerId}.` }, { status: 404 });
    }

    const log = await CourierRunLog.findOne({ date });
    if (!log) {
      return NextResponse.json({ error: `No courier run found for date=${date}.` }, { status: 404 });
    }

    const parcel = (log.matched || []).find((m: any) => m.docketNo === docketNo);
    if (!parcel) {
      return NextResponse.json({ error: `No matched parcel with docketNo=${docketNo} in this run.` }, { status: 404 });
    }

    const newWhatsappNumber = (seller.whatsappNumber || "").trim();

    parcel.instituteName = seller.instituteName;
    parcel.sellerId = String(seller._id);
    parcel.buyerName = seller.buyerName || undefined;
    parcel.whatsappNumber = newWhatsappNumber || undefined;
    // Only auto-flip the sendable/no-number state - never touch a parcel
    // that's already queued/sent/failed, since that reflects a real send
    // attempt that happened under the old (wrong) label.
    if (parcel.whatsappStatus === "NO_NUMBER" || parcel.whatsappStatus === "NOT_SENT") {
      parcel.whatsappStatus = newWhatsappNumber ? "NOT_SENT" : "NO_NUMBER";
    }

    await log.save();

    return NextResponse.json({ success: true, matched: parcel });
  } catch (error: any) {
    console.error("POST update-matched-institute error:", error);
    return NextResponse.json({ error: error.message || "Failed to update institute" }, { status: 500 });
  }
}
