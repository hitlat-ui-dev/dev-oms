import mongoose, { Schema, model, models } from "mongoose";

const CompanySchema = new Schema({
  firmName: { type: String, required: true, trim: true },
  firmCode: { type: String, required: true, uppercase: true },
  sellerRegisterAddress: { type: String, required: false, trim: true },
  // Separate from sellerRegisterAddress (which serves a different purpose) -
  // this is the dispatch/return address printed on shipping labels.
  dispatchAddress: { type: String, required: false, trim: true },
  mobile: { type: String, required: false, trim: true },

  // ---- Billing: Tax details ----
  // GSTIN is optional - some firms are unregistered. When absent, PAN is
  // the compulsory identifier (enforced in the API route, not here, since
  // existing companies pre-date this field and must stay saveable).
  state: { type: String, required: false, trim: true }, // decides CGST/SGST vs IGST against buyer state
  gstin: { type: String, required: false, trim: true, uppercase: true, default: null },
  pan: { type: String, required: false, trim: true, uppercase: true, default: null },
  isCompositionDealer: { type: Boolean, default: false },

  // ---- Billing: Bank details (printed on invoice) ----
  bank: {
    bankName: { type: String, required: false, trim: true },
    accountNo: { type: String, required: false, trim: true },
    ifsc: { type: String, required: false, trim: true, uppercase: true },
    branch: { type: String, required: false, trim: true },
  },

  contactEmail: { type: String, required: false, trim: true },
  // GeM OTP arrives on this Gmail account - used by the bill auto-submit
  // extension's login_hint for silent/pre-filled auth.
  gmailAccountEmail: { type: String, required: false, trim: true },

  // ---- Billing: per-firm, per-FY invoice numbering (AUTO + MANUAL sync) ----
  invoiceNumbering: {
    prefix: { type: String, default: "" },
    // One entry per financial year (e.g. "2025-26"). A manual entry advances
    // lastNumber too, so the next AUTO bill always continues past it.
    history: [
      {
        fy: { type: String, required: true },
        lastNumber: { type: Number, required: true, default: 0 },
      },
    ],
  },

  isActive: { type: Boolean, default: true },
}, { timestamps: true });

export default models.Company || model("Company", CompanySchema);