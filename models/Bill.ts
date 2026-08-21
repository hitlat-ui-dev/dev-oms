// @/models/Bill.ts
// A generated GeM bill (Tax Invoice or Bill of Supply). Snapshots firm + buyer
// details at generation time (so later edits to Company/Seller don't change
// an already-issued bill) and links back to the SellerOrder line items it covers.
import mongoose, { Schema, model, models } from "mongoose";

const BillItemSchema = new Schema(
  {
    srNo: { type: Number, required: true },
    sellerOrderId: { type: Schema.Types.ObjectId, ref: "SellerOrder", required: true },
    itemName: { type: String, required: true },
    hsnSac: { type: String, default: "" },
    qty: { type: Number, required: true },
    unit: { type: String, default: "" },
    rate: { type: Number, required: true },
    discount: { type: Number, default: 0 }, // flat per-line discount amount
    gstPercent: { type: Number, default: 0 },
    taxableAmount: { type: Number, required: true }, // (qty*rate) - discount
    gstAmount: { type: Number, default: 0 },
    amount: { type: Number, required: true }, // taxableAmount + gstAmount
  },
  { _id: false }
);

const BillSchema = new Schema(
  {
    firmCode: { type: String, required: true, uppercase: true },
    invoiceNumber: { type: String, required: true },
    numberMode: { type: String, enum: ["auto", "manual"], required: true },
    billType: { type: String, enum: ["TAX_INVOICE", "BILL_OF_SUPPLY"], required: true },
    gstSplit: { type: String, enum: ["CGST_SGST", "IGST", "UNKNOWN"], required: true },
    invoiceDate: { type: Date, required: true },
    placeOfSupply: { type: String, default: "" },
    contractNo: { type: String, default: "" },

    firmSnapshot: {
      name: { type: String, required: true },
      address: { type: String, default: "" },
      state: { type: String, default: "" },
      gstin: { type: String, default: null },
      pan: { type: String, default: null },
      mobile: { type: String, default: "" },
      contactEmail: { type: String, default: "" },
      bank: {
        bankName: { type: String, default: "" },
        accountNo: { type: String, default: "" },
        ifsc: { type: String, default: "" },
        branch: { type: String, default: "" },
      },
    },

    buyerSnapshot: {
      instituteName: { type: String, required: true },
      buyerName: { type: String, default: "" },
      address: { type: String, default: "" },
      place: { type: String, default: "" },
      state: { type: String, default: "" },
    },

    items: [BillItemSchema],

    subTotal: { type: Number, required: true }, // sum of taxableAmount
    totalDiscount: { type: Number, default: 0 },
    totalGst: { type: Number, default: 0 },
    cgstAmount: { type: Number, default: 0 },
    sgstAmount: { type: Number, default: 0 },
    igstAmount: { type: Number, default: 0 },
    grandTotal: { type: Number, required: true },

    // R2 object key for the OMS-generated PDF (bills R2 account, lib/r2Bills.ts) -
    // a stable key, not a signed URL, since signed URLs expire; download
    // links are generated on demand from this key.
    r2Key: { type: String, default: "" },
    fileUrl: { type: String, default: "" }, // reserved for a future public URL, unused while the bucket is private

    // The OFFICIAL, e-signed invoice document GeM itself generates once a
    // bill's OTP verification completes - fetched and stored by the GeM
    // Bill Auto-Submit extension after a successful submission. Distinct
    // from r2Key (our own PDF), and may remain empty for bills never
    // submitted through the extension (or submitted before this existed).
    gemDocumentR2Key: { type: String, default: "" },
    gemSubmittedAt: { type: Date, default: null },

    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

BillSchema.index({ firmCode: 1, invoiceNumber: 1 }, { unique: true });
BillSchema.index({ firmCode: 1, invoiceDate: -1 });
BillSchema.index({ contractNo: 1 });

export default models.Bill || model("Bill", BillSchema);
