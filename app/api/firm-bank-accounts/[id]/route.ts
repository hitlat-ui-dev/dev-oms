import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";
import FirmBankAccount from "@/models/FirmBankAccount";
import DDEntry from "@/models/DDEntry";

async function connectMongoose() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

// PUT /api/firm-bank-accounts/:id — { firmCode?, bankName?, accountNumber?, branchName? }
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    await connectMongoose();

    const body = await req.json();
    const update: any = {};
    if (body.firmCode !== undefined) update.firmCode = String(body.firmCode).trim().toUpperCase();
    if (body.bankName !== undefined) update.bankName = String(body.bankName).trim();
    if (body.accountNumber !== undefined) update.accountNumber = String(body.accountNumber).trim();
    if (body.branchName !== undefined) update.branchName = String(body.branchName).trim();

    const account = await FirmBankAccount.findByIdAndUpdate(id, { $set: update }, { new: true });
    if (!account) return NextResponse.json({ error: "Firm bank account not found" }, { status: 404 });

    return NextResponse.json(account);
  } catch (error: any) {
    console.error("Firm bank account PUT error:", error);
    return NextResponse.json({ error: error.message || "Failed to update firm bank account" }, { status: 500 });
  }
}

// DELETE /api/firm-bank-accounts/:id — blocked if any DD entry still references it.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    await connectMongoose();

    const inUse = await DDEntry.countDocuments({ firmBankAccount: id });
    if (inUse > 0) {
      return NextResponse.json(
        { error: `Cannot delete — ${inUse} DD entr${inUse === 1 ? "y" : "ies"} still reference this bank account.` },
        { status: 400 }
      );
    }

    const result = await FirmBankAccount.findByIdAndDelete(id);
    if (!result) return NextResponse.json({ error: "Firm bank account not found" }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Firm bank account DELETE error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete firm bank account" }, { status: 500 });
  }
}
