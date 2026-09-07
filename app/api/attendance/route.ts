import { NextResponse } from "next/server";
import mongoose from "mongoose";
import Attendance from "@/models/Attendance";

async function connectMongoose() {
  if (mongoose.connection.readyState !== 1 && process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

// GET /api/attendance?date=YYYY-MM-DD  - one day's marked records
// GET /api/attendance?month=YYYY-MM    - a whole month, for the register view
export async function GET(req: Request) {
  try {
    await connectMongoose();
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");
    const month = searchParams.get("month");

    if (date) {
      if (!DATE_RE.test(date)) {
        return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
      }
      const records = await Attendance.find({ date }).lean();
      return NextResponse.json(records);
    }

    if (month) {
      if (!MONTH_RE.test(month)) {
        return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
      }
      // Plain string range - works because the date format is fixed-width, and
      // avoids a regex scan across the whole collection.
      const records = await Attendance.find({
        date: { $gte: `${month}-01`, $lte: `${month}-31` },
      })
        .sort({ date: 1 })
        .lean();
      return NextResponse.json(records);
    }

    return NextResponse.json({ error: "date or month is required" }, { status: 400 });
  } catch (error: any) {
    console.error("GET attendance error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch attendance" }, { status: 500 });
  }
}

// POST /api/attendance - save (or re-save) a whole day in one go.
//
// Body: { date, markedBy, records: [{ employeeId, employeeName, status,
//         inTime, outTime, overtimeHours, note }] }
//
// The daily register is edited as a sheet, not row by row, so this takes the
// whole day at once. Each row is an upsert keyed on {employeeId, date}, which
// makes re-saving the same day an edit rather than a duplicate - and makes the
// whole request safely repeatable if someone double-clicks Save.
export async function POST(req: Request) {
  try {
    await connectMongoose();
    const body = await req.json();

    const date = (body?.date || "").toString();
    if (!DATE_RE.test(date)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    }

    const records = Array.isArray(body?.records) ? body.records : [];
    if (records.length === 0) {
      return NextResponse.json({ error: "records array is empty" }, { status: 400 });
    }

    const markedBy = (body?.markedBy || "").toString();
    const markedAt = new Date();

    const ops = records
      .filter((r: any) => r?.employeeId && r?.status)
      .map((r: any) => ({
        updateOne: {
          filter: { employeeId: String(r.employeeId), date },
          update: {
            $set: {
              employeeId: String(r.employeeId),
              employeeName: String(r.employeeName || ""),
              date,
              status: String(r.status),
              inTime: String(r.inTime || ""),
              outTime: String(r.outTime || ""),
              overtimeHours: Number(r.overtimeHours) || 0,
              note: String(r.note || ""),
              markedBy,
              markedAt,
            },
          },
          upsert: true,
        },
      }));

    if (ops.length === 0) {
      return NextResponse.json({ error: "No valid records (employeeId + status required)" }, { status: 400 });
    }

    const result = await Attendance.bulkWrite(ops);
    return NextResponse.json({
      success: true,
      saved: ops.length,
      created: result.upsertedCount,
      updated: result.modifiedCount,
    });
  } catch (error: any) {
    console.error("POST attendance error:", error);
    return NextResponse.json({ error: error.message || "Failed to save attendance" }, { status: 500 });
  }
}
