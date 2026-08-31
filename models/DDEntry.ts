// @/models/DDEntry.ts
// Tracks the full lifecycle of a tender security-deposit Demand Draft: issued
// -> sent to buyer -> (tender ends) pending_return -> buyer sends it back &
// bank cancels it -> refund amount confirmed credited via bank statement match.
// See app/api/dd-entries/route.ts for the status-transition enforcement.
import { Schema, model, models } from "mongoose";

export const DD_STATUSES = ["issued", "sent", "pending_return", "returned_cancelled", "refund_credited"] as const;
export const TENDER_STATUSES = ["ongoing", "won", "lost", "cancelled", "disqualified"] as const;
export const DD_PURPOSES = ["EMD", "Security Deposit", "Other"] as const;

const DDEntrySchema = new Schema(
  {
    ddNumber: { type: String, required: true, trim: true },
    ddDate: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    payeeName: { type: String, required: true, trim: true },

    firmBankAccount: { type: Schema.Types.ObjectId, ref: "FirmBankAccount", required: true },

    tenderReference: { type: String, required: true, trim: true },
    purpose: { type: String, enum: DD_PURPOSES, default: "EMD" },

    courierSentDate: { type: Date, default: null },
    courierTrackingNumber: { type: String, trim: true, default: "" },

    tenderStatus: { type: String, enum: TENDER_STATUSES, default: "ongoing" },
    status: { type: String, enum: DD_STATUSES, default: "issued" },

    returnedDate: { type: Date, default: null },
    refundCreditDate: { type: Date, default: null },
    // account_statements has one doc per firm+account with an EMBEDDED
    // transactions array (no per-transaction _id), so a matched bank entry
    // is identified by which statement doc it lives in + its txnKey
    // fingerprint (see txnKey() in app/api/account-statements/route.ts),
    // not a standalone ObjectId the way the spec assumed.
    matchedStatementId: { type: Schema.Types.ObjectId, default: null },
    matchedTxnKey: { type: String, default: null },

    scannedDocumentUrl: { type: String, default: "" },

    // Bank charges a fee both when the DD is issued and again when it's
    // cancelled/refunded - tracked separately so neither gets lost.
    issuanceCharge: { type: Number, default: 0, min: 0 },
    cancellationCharge: { type: Number, default: 0, min: 0 },

    notes: { type: String, trim: true, default: "" },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

DDEntrySchema.virtual("totalCharge").get(function (this: any) {
  return (this.issuanceCharge || 0) + (this.cancellationCharge || 0);
});
DDEntrySchema.set("toJSON", { virtuals: true });
DDEntrySchema.set("toObject", { virtuals: true });

DDEntrySchema.index({ firmBankAccount: 1, status: 1 });
DDEntrySchema.index({ tenderStatus: 1, status: 1 });
DDEntrySchema.index({ ddNumber: 1 });

export default models.DDEntry || model("DDEntry", DDEntrySchema);
