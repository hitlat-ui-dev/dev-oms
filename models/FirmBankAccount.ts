// @/models/FirmBankAccount.ts
// Master mapping: which bank account a firm's DDs (Demand Drafts) get issued
// from, so a DD's eventual refund credit can be looked up in the right
// firm's account_statements ledger (see /api/dd-entries/[id]/match-candidates).
import { Schema, model, models } from "mongoose";

const FirmBankAccountSchema = new Schema(
  {
    // Keyed by firmCode (not firmName) to match every other collection in
    // this app (companies.firmCode, SellerOrder.firmCode, etc.) - firmCode
    // is the canonical identifier, firmName is looked up from companies when needed.
    firmCode: { type: String, required: true, trim: true, uppercase: true },
    bankName: { type: String, required: true, trim: true },
    // Full account number is kept (needed to match against account_statements.accountNumber
    // exactly); the UI masks it to last-4 for display, same pattern as the
    // Reconciliation page's account-last-4-digits.
    accountNumber: { type: String, required: true, trim: true },
    branchName: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

FirmBankAccountSchema.index({ firmCode: 1 });

export default models.FirmBankAccount || model("FirmBankAccount", FirmBankAccountSchema);
