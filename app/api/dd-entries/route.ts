import { NextResponse } from "next/server";
import mongoose from "mongoose";
import clientPromise from "@/lib/mongodb";
import DDEntry, { DD_PURPOSES } from "@/models/DDEntry";
import FirmBankAccount from "@/models/FirmBankAccount";

async function connectMongoose() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

// GET /api/dd-entries?firmCode=&bankAccountId=&status=&tenderStatus=&from=&to=
export async function GET(req: Request) {
  try {
    await connectMongoose();
    const { searchParams } = new URL(req.url);
    const firmCode = (searchParams.get("firmCode") || "").trim().toUpperCase();
    const bankAccountId = searchParams.get("bankAccountId");
    const status = searchParams.get("status");
    const tenderStatus = searchParams.get("tenderStatus");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const filter: any = {};
    if (bankAccountId) {
      filter.firmBankAccount = bankAccountId;
    } else if (firmCode) {
      const accountIds = (await FirmBankAccount.find({ firmCode }).select("_id").lean()).map((a: any) => a._id);
      filter.firmBankAccount = { $in: accountIds };
    }
    if (status) filter.status = status;
    if (tenderStatus) filter.tenderStatus = tenderStatus;
    if (from || to) {
      filter.ddDate = {};
      if (from) filter.ddDate.$gte = new Date(`${from}T00:00:00`);
      if (to) filter.ddDate.$lte = new Date(`${to}T23:59:59`);
    }

    const entries = await DDEntry.find(filter).populate("firmBankAccount").sort({ ddDate: -1, createdAt: -1 }).lean();
    return NextResponse.json(entries);
  } catch (error: any) {
    console.error("DD entries GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to load DD entries" }, { status: 500 });
  }
}

// POST /api/dd-entries — create a new DD entry (from OCR-prefilled or manual data).
// Always starts at status="issued" - the lifecycle only advances via PUT.
export async function POST(req: Request) {
  try {
    await connectMongoose();
    const body = await req.json();
    const {
      ddNumber, ddDate, amount, payeeName, firmBankAccount,
      tenderReference, purpose, scannedDocumentUrl, issuanceCharge, notes, createdBy,
    } = body;

    if (!ddNumber || !ddDate || amount === undefined || amount === null || !payeeName || !firmBankAccount || !tenderReference) {
      return NextResponse.json(
        { error: "ddNumber, ddDate, amount, payeeName, firmBankAccount and tenderReference are required." },
        { status: 400 }
      );
    }
    if (purpose && !DD_PURPOSES.includes(purpose)) {
      return NextResponse.json({ error: `purpose must be one of: ${DD_PURPOSES.join(", ")}` }, { status: 400 });
    }
    const bankAccount = await FirmBankAccount.findById(firmBankAccount);
    if (!bankAccount) {
      return NextResponse.json({ error: "firmBankAccount not found." }, { status: 404 });
    }

    const entry = await DDEntry.create({
      ddNumber: String(ddNumber).trim(),
      ddDate: new Date(ddDate),
      amount: Number(amount),
      payeeName: String(payeeName).trim(),
      firmBankAccount,
      tenderReference: String(tenderReference).trim(),
      purpose: purpose || "EMD",
      scannedDocumentUrl: scannedDocumentUrl || "",
      issuanceCharge: Number(issuanceCharge) || 0,
      notes: notes || "",
      createdBy: createdBy || "",
      status: "issued",
      tenderStatus: "ongoing",
    });

    return NextResponse.json(entry, { status: 201 });
  } catch (error: any) {
    console.error("DD entries POST error:", error);
    return NextResponse.json({ error: error.message || "Failed to create DD entry" }, { status: 500 });
  }
}
