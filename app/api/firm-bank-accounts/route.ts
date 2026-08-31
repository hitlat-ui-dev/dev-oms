import { NextResponse } from "next/server";
import mongoose from "mongoose";
import clientPromise from "@/lib/mongodb";
import FirmBankAccount from "@/models/FirmBankAccount";

async function connectMongoose() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

// GET /api/firm-bank-accounts?firmCode=XXX
export async function GET(req: Request) {
  try {
    await connectMongoose();
    const { searchParams } = new URL(req.url);
    const firmCode = (searchParams.get("firmCode") || "").trim().toUpperCase();

    const filter: any = {};
    if (firmCode) filter.firmCode = firmCode;

    const accounts = await FirmBankAccount.find(filter).sort({ firmCode: 1 }).lean();
    return NextResponse.json(accounts);
  } catch (error: any) {
    console.error("Firm bank accounts GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to load firm bank accounts" }, { status: 500 });
  }
}

// POST /api/firm-bank-accounts — { firmCode, bankName, accountNumber, branchName? }
export async function POST(req: Request) {
  try {
    await connectMongoose();
    const body = await req.json();
    const { firmCode, bankName, accountNumber, branchName } = body;

    if (!firmCode || !bankName || !accountNumber) {
      return NextResponse.json({ error: "firmCode, bankName and accountNumber are required." }, { status: 400 });
    }

    const account = await FirmBankAccount.create({
      firmCode: String(firmCode).trim().toUpperCase(),
      bankName: String(bankName).trim(),
      accountNumber: String(accountNumber).trim(),
      branchName: branchName ? String(branchName).trim() : "",
    });

    return NextResponse.json(account, { status: 201 });
  } catch (error: any) {
    console.error("Firm bank accounts POST error:", error);
    return NextResponse.json({ error: error.message || "Failed to create firm bank account" }, { status: 500 });
  }
}
