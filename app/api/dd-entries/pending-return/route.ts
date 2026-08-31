import { NextResponse } from "next/server";
import mongoose from "mongoose";
import clientPromise from "@/lib/mongodb";
import DDEntry from "@/models/DDEntry";

async function connectMongoose() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

// GET /api/dd-entries/pending-return?thresholdDays=30&firmCode=
// The "DD abhi tak wapas nahi aaya" alert list: tender has ended (won/lost/
// cancelled/disqualified) but the DD itself is still sitting with the buyer
// (status sent/pending_return, i.e. not yet returned_cancelled/refund_credited).
// Sorted oldest-pending-first so the most overdue ones surface at the top.
export async function GET(req: Request) {
  try {
    await connectMongoose();
    const { searchParams } = new URL(req.url);
    const thresholdDays = Number(searchParams.get("thresholdDays")) || 30;
    const firmCode = (searchParams.get("firmCode") || "").trim().toUpperCase();

    const entries = await DDEntry.find({
      tenderStatus: { $in: ["won", "lost", "cancelled", "disqualified"] },
      status: { $in: ["sent", "pending_return"] },
    })
      .populate("firmBankAccount")
      .lean();

    const now = Date.now();
    const rows = entries
      .filter((e: any) => !firmCode || e.firmBankAccount?.firmCode === firmCode)
      .map((e: any) => {
        // "Pending since" the DD left our hands (courier sent), falling back
        // to the DD's own issue date for any old entry that predates courier tracking.
        const since = e.courierSentDate || e.ddDate || e.createdAt;
        const pendingDays = Math.floor((now - new Date(since).getTime()) / 86400000);
        return { ...e, pendingSince: since, pendingDays, overdue: pendingDays >= thresholdDays };
      })
      .sort((a, b) => b.pendingDays - a.pendingDays);

    return NextResponse.json({ thresholdDays, count: rows.length, entries: rows });
  } catch (error: any) {
    console.error("DD pending-return GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to load pending-return report" }, { status: 500 });
  }
}
