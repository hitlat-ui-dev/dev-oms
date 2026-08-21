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
  history: [HistorySchema]
}, { timestamps: true });

export default models.Item || model("Item", ItemSchema);