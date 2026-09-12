// @/models/DeliveryChallan.ts
// A standalone Delivery Challan - a non-commercial dispatch document listing
// what physically went out (item, qty, unit) with no rate or amount anywhere.
//
// Distinct from the order-linked challan the Orders page renders client-side
// (downloadDeliveryChallan): that one is derived from GeM seller orders and is
// never stored. This one is manually composed, gets its own firm-wise,
// financial-year-wise number, and IS stored so it can be listed and
// re-downloaded later.
//
// Like Bill, the firm (and consignee, when one is chosen) is SNAPSHOTTED at
// finalize time, so later edits to Company/Seller never change an already-
// issued challan.
import { Schema, model, models } from "mongoose";

const DcItemSchema = new Schema(
  {
    srNo: { type: Number, required: true },
    // Set when the line came from the DC Item Master dropdown; absent for a
    // line typed straight into the "Add New Item" form.
    itemMasterId: { type: Schema.Types.ObjectId, ref: "DcItemMaster", default: null },
    itemName: { type: String, required: true, trim: true },
    qty: { type: Number, required: true },
    unit: { type: String, default: "" },
  },
  { _id: false }
);

const DeliveryChallanSchema = new Schema(
  {
    // Optional: a challan may be raised with no firm at all, in which case
    // the PDF omits the firm header entirely and the number comes from the
    // shared no-firm series rather than any firm's own.
    firmCode: { type: String, default: "", uppercase: true },

    // Numbering. dcNumber stays null while status is "draft" - a number is
    // only allocated at finalize, so abandoned drafts never burn one and the
    // issued series has no holes in it.
    dcNumber: { type: Number, default: null },
    financialYear: { type: String, required: true }, // "26-27" (short form, as printed)
    dcNumberFormatted: { type: String, default: "" }, // "01/26-27"
    numberMode: { type: String, enum: ["auto", "manual"], default: "auto" },

    date: { type: Date, required: true },

    // Optional consignee. A DC can legitimately go out blank here (the
    // receiver signs by hand), so nothing in this block is required.
    consignee: {
      sellerId: { type: Schema.Types.ObjectId, ref: "Seller", default: null },
      instituteName: { type: String, default: "" },
      buyerName: { type: String, default: "" },
      address: { type: String, default: "" },
      place: { type: String, default: "" },
      state: { type: String, default: "" },
      mobile: { type: String, default: "" },
    },

    firmSnapshot: {
      name: { type: String, default: "" },
      address: { type: String, default: "" },
      state: { type: String, default: "" },
      gstin: { type: String, default: null },
      pan: { type: String, default: null },
      mobile: { type: String, default: "" },
      contactEmail: { type: String, default: "" },
    },

    items: [DcItemSchema],
    totalQty: { type: Number, default: 0 },
    remarks: { type: String, default: "" },

    status: { type: String, enum: ["draft", "finalized"], default: "draft" },

    // R2 object key for the generated PDF (bills R2 bucket, lib/r2Bills.ts) -
    // a stable key rather than a signed URL, since signed URLs expire.
    r2Key: { type: String, default: "" },

    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

// Only FINALIZED challans hold a number, so uniqueness is asserted on those
// alone - a plain unique index would collide across drafts (all dcNumber: null).
DeliveryChallanSchema.index(
  { firmCode: 1, financialYear: 1, dcNumber: 1 },
  { unique: true, partialFilterExpression: { status: "finalized" } }
);
DeliveryChallanSchema.index({ firmCode: 1, date: -1 });

export default models.DeliveryChallan || model("DeliveryChallan", DeliveryChallanSchema, "delivery_challans");
