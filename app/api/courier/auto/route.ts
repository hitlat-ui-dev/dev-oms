import { NextResponse } from "next/server";
import mongoose from "mongoose";
import CourierRunLog from "@/models/CourierRunLog";
import { processNewCourierParcels } from "@/lib/courier/parseAndMatch";

// PDF fetch + parse + match can take a few seconds - stay under Vercel's
// default 10s function timeout the same way /api/backup/auto does.
export const maxDuration = 60;

export async function GET() {
  try {
    if (mongoose.connection.readyState !== 1 && process.env.MONGODB_URI) {
      await mongoose.connect(process.env.MONGODB_URI);
    }

    const todayDate = new Date().toISOString().split("T")[0];
    const existingLog = await CourierRunLog.findOne({ date: todayDate, status: "SUCCESS" });
    const recentLogs = await CourierRunLog.find().sort({ timestamp: -1 }).limit(10).lean();

    return NextResponse.json({
      success: true,
      todayRunCompleted: !!existingLog,
      todayLog: existingLog || null,
      history: recentLogs,
      gmailConfigured: !!(process.env.GMAIL_API_CLIENT_ID && process.env.GMAIL_API_CLIENT_SECRET && process.env.GMAIL_API_REFRESH_TOKEN),
      courierSenderConfigured: !!process.env.COURIER_SENDER_EMAIL,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (mongoose.connection.readyState !== 1) {
      if (process.env.MONGODB_URI) {
        await mongoose.connect(process.env.MONGODB_URI);
      } else {
        return NextResponse.json({ error: "MONGODB_URI missing" }, { status: 500 });
      }
    }

    const todayDate = new Date().toISOString().split("T")[0];
    const existingLog = await CourierRunLog.findOne({ date: todayDate, status: "SUCCESS" });

    let forceRun = false;
    try {
      const body = await req.json();
      forceRun = !!body?.force;
    } catch {
      // Body empty or invalid JSON, ignore
    }

    if (existingLog && !forceRun) {
      return NextResponse.json({
        skipped: true,
        message: `Courier run already completed for today (${todayDate}).`,
        log: existingLog,
      });
    }

    // Lock today's entry to prevent concurrency collisions (e.g. two staff
    // logging in at nearly the same moment).
    await CourierRunLog.findOneAndUpdate(
      { date: todayDate },
      { status: "IN_PROGRESS", timestamp: new Date(), error: null },
      { upsert: true, new: true }
    );

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Database instance unavailable");
    }

    const result = await processNewCourierParcels(db);

    const updatedLog = await CourierRunLog.findOneAndUpdate(
      { date: todayDate },
      {
        status: "SUCCESS",
        totalParcels: result.totalParcels,
        matchedCount: result.matched.length,
        needsReviewCount: result.needsReview.length,
        matched: result.matched,
        needsReview: result.needsReview,
        timestamp: new Date(),
        error: result.totalParcels === 0 ? "No new courier parcels found since the last fetch." : undefined,
        triggeredBy: forceRun ? "MANUAL_RUN_NOW" : "AUTO_SITE_ACCESS",
      },
      { new: true }
    );

    return NextResponse.json({
      success: true,
      message:
        result.totalParcels === 0
          ? "No new courier mail/parcels found since the last fetch - nothing to process."
          : `Processed ${result.totalParcels} parcels: ${result.matched.length} matched, ${result.needsReview.length} need review.`,
      log: updatedLog,
    });
  } catch (error: any) {
    console.error("Courier auto-run error:", error);

    const todayDate = new Date().toISOString().split("T")[0];
    await CourierRunLog.findOneAndUpdate(
      { date: todayDate },
      { status: "FAILED", error: error.message || "Unknown courier-run error", timestamp: new Date() },
      { upsert: true }
    );

    return NextResponse.json({ error: error.message || "Courier auto-run failed" }, { status: 500 });
  }
}
