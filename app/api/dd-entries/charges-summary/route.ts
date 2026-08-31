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

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// GET /api/dd-entries/charges-summary?from=&to=
// Per-DD issuance/cancellation/total bank charge breakdown, rolled up by firm,
// plus a grand total across every DD in range.
export async function GET(req: Request) {
  try {
    await connectMongoose();
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const filter: any = {};
    if (from || to) {
      filter.ddDate = {};
      if (from) filter.ddDate.$gte = new Date(`${from}T00:00:00`);
      if (to) filter.ddDate.$lte = new Date(`${to}T23:59:59`);
    }

    const entries = await DDEntry.find(filter).populate("firmBankAccount").sort({ ddDate: -1 }).lean();

    const perDD = entries.map((e: any) => ({
      _id: e._id,
      ddNumber: e.ddNumber,
      ddDate: e.ddDate,
      firmCode: e.firmBankAccount?.firmCode || "Unknown",
      issuanceCharge: round2(e.issuanceCharge || 0),
      cancellationCharge: round2(e.cancellationCharge || 0),
      totalCharge: round2((e.issuanceCharge || 0) + (e.cancellationCharge || 0)),
    }));

    const byFirmMap = new Map<string, { firmCode: string; issuanceCharge: number; cancellationCharge: number; totalCharge: number; count: number }>();
    for (const row of perDD) {
      const existing = byFirmMap.get(row.firmCode) || { firmCode: row.firmCode, issuanceCharge: 0, cancellationCharge: 0, totalCharge: 0, count: 0 };
      existing.issuanceCharge += row.issuanceCharge;
      existing.cancellationCharge += row.cancellationCharge;
      existing.totalCharge += row.totalCharge;
      existing.count += 1;
      byFirmMap.set(row.firmCode, existing);
    }
    const byFirm = Array.from(byFirmMap.values())
      .map((f) => ({ ...f, issuanceCharge: round2(f.issuanceCharge), cancellationCharge: round2(f.cancellationCharge), totalCharge: round2(f.totalCharge) }))
      .sort((a, b) => b.totalCharge - a.totalCharge);

    const grandTotal = {
      issuanceCharge: round2(perDD.reduce((s, r) => s + r.issuanceCharge, 0)),
      cancellationCharge: round2(perDD.reduce((s, r) => s + r.cancellationCharge, 0)),
      totalCharge: round2(perDD.reduce((s, r) => s + r.totalCharge, 0)),
      count: perDD.length,
    };

    return NextResponse.json({ grandTotal, byFirm, perDD });
  } catch (error: any) {
    console.error("DD charges-summary GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to load charges summary" }, { status: 500 });
  }
}
