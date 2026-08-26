import mongoose, { Schema, model, models } from "mongoose";

const HistorySchema = new mongoose.Schema({
  type: { type: String, required: true },
  qty: { type: Number, required: true },
  date: { type: Date, default: Date.now },
  
  // Optional info fields for your tracking
  orderNo: String,
  sellerName: String,
  vendorName: String,
  otherDetails: String,
  byWhom: String,
  rate: Number
});

const ItemSchema = new Schema({
  itemName: { type: String, required: true, trim: true },
  sku: { type: String, required: true, unique: true },
  category: { type: String, required: true },
  unit: { type: String, required: true },
  currentStock: { type: Number, default: 0 },
  location: { type: String, required: false, default: "" },
  // Billing: default HSN/SAC + GST% for this item, used when generating a
  // Tax Invoice. Overridable per line on the Generate Bill screen.
  hsnSac: { type: String, required: false, default: "" },
  gstPercent: { type: Number, required: false, default: 0 },
  // Whether a human has actually verified this item's HSN/GST are correct -
  // hsnSac/gstPercent above may just be an unverified suggestion (see the
  // HSN & GST Review page) until this is true. Wrong HSN/GST on a real tax
  // invoice is a compliance risk, so bills should be able to flag/filter on
  // this rather than silently trusting every value.
  hsnGstConfirmed: { type: Boolean, required: false, default: false },
  // Variant grouping: several items (different color/size) of the same
  // underlying product share one variantGroup value (the sku of whichever
  // item first became the group's anchor) so they can be searched/selected
  // together in Add Order etc., while each still keeps its own SKU and
  // stock quantity - variantGroup links them, it never merges their stock.
  variantGroup: { type: String, required: false, default: "" },
  variantLabel: { type: String, required: false, default: "" },
  history: [HistorySchema]
}, { timestamps: true });

export default models.Item || model("Item", ItemSchema);