import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";
import DDEntry, { TENDER_STATUSES } from "@/models/DDEntry";

async function connectMongoose() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

// Enforced status lifecycle - only these forward moves are allowed via this
// route. "refund_credited" is deliberately excluded here: it can only be
// reached through /api/dd-entries/[id]/confirm-match, so it's never set
// without a matched bank statement entry attached.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  issued: ["sent"],
  sent: ["pending_return", "returned_cancelled"],
  pending_return: ["returned_cancelled"],
  returned_cancelled: [],
  refund_credited: [],
};

// GET /api/dd-entries/:id
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    await connectMongoose();

    const entry = await DDEntry.findById(id).populate("firmBankAccount").lean();
    if (!entry) return NextResponse.json({ error: "DD entry not found" }, { status: 404 });
    return NextResponse.json(entry);
  } catch (error: any) {
    console.error("DD entry GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to load DD entry" }, { status: 500 });
  }
}

// PUT /api/dd-entries/:id — edits + status/tenderStatus transitions.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    await connectMongoose();

    const body = await req.json();
    const entry = await DDEntry.findById(id);
    if (!entry) return NextResponse.json({ error: "DD entry not found" }, { status: 404 });

    const update: any = {};

    // Plain field edits (allowed at any stage — correcting a typo shouldn't
    // require walking the status machine).
    if (body.ddNumber !== undefined) update.ddNumber = String(body.ddNumber).trim();
    if (body.ddDate !== undefined) update.ddDate = new Date(body.ddDate);
    if (body.amount !== undefined) update.amount = Number(body.amount);
    if (body.payeeName !== undefined) update.payeeName = String(body.payeeName).trim();
    if (body.tenderReference !== undefined) update.tenderReference = String(body.tenderReference).trim();
    if (body.purpose !== undefined) update.purpose = body.purpose;
    if (body.issuanceCharge !== undefined) update.issuanceCharge = Number(body.issuanceCharge) || 0;
    if (body.notes !== undefined) update.notes = body.notes;
    if (body.courierSentDate !== undefined) update.courierSentDate = body.courierSentDate ? new Date(body.courierSentDate) : null;
    if (body.courierTrackingNumber !== undefined) update.courierTrackingNumber = body.courierTrackingNumber;

    // Tender outcome is a separate axis from the DD's own status - can be
    // updated any time (this is what the Pending Return Report watches for).
    if (body.tenderStatus !== undefined) {
      if (!TENDER_STATUSES.includes(body.tenderStatus)) {
        return NextResponse.json({ error: `tenderStatus must be one of: ${TENDER_STATUSES.join(", ")}` }, { status: 400 });
      }
      update.tenderStatus = body.tenderStatus;
    }

    // DD lifecycle status - forward-only, one step at a time (see ALLOWED_TRANSITIONS).
    if (body.status !== undefined && body.status !== entry.status) {
      const allowed = ALLOWED_TRANSITIONS[entry.status] || [];
      if (!allowed.includes(body.status)) {
        return NextResponse.json(
          {
            error:
              body.status === "refund_credited"
                ? "refund_credited can only be set by confirming a bank statement match — use POST /api/dd-entries/:id/confirm-match."
                : `Cannot move from "${entry.status}" to "${body.status}". Allowed next step(s): ${allowed.length ? allowed.join(", ") : "none (terminal status)"}.`,
          },
          { status: 400 }
        );
      }
      update.status = body.status;

      if (body.status === "sent" && !entry.courierSentDate && update.courierSentDate === undefined) {
        update.courierSentDate = new Date();
      }
      if (body.status === "returned_cancelled") {
        update.returnedDate = body.returnedDate ? new Date(body.returnedDate) : new Date();
        // Cancellation charge is entered right here, alongside the status
        // change, per the Bank Charges Tracking requirement.
        if (body.cancellationCharge !== undefined) {
          update.cancellationCharge = Number(body.cancellationCharge) || 0;
        }
      }
    }

    Object.assign(entry, update);
    await entry.save();

    return NextResponse.json(entry);
  } catch (error: any) {
    console.error("DD entry PUT error:", error);
    return NextResponse.json({ error: error.message || "Failed to update DD entry" }, { status: 500 });
  }
}
