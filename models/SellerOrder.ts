// @/models/SellerOrder.ts
import mongoose, { Schema, model, models } from "mongoose";

const SellerOrderSchema = new Schema({
  orderNo: { type: String, unique: true },
  firmCode: { type: String, required: true },
  sellerId: { type: Schema.Types.ObjectId, ref: "Seller", required: true },
  instituteName: { type: String, required: true },
  itemId: { type: Schema.Types.ObjectId, ref: "Stock", required: true },
  itemName: { type: String, required: true },
  category: { type: String },
  unit: { type: String },
  sku: { type: String },
  contractDate: { type: String },
  contractNo: { type: String },
  contractUrl: { type: String },
  reQty: { type: Number, required: true },
  rate: { type: Number, default: 0 },
  totalAmount: { type: Number, required: true },
  remark: { type: String },
  status: { type: String, default: "Pending" },
  isPaid: { type: Boolean, default: false },
  transportName: { type: String, default: "" },
  transportRemark: { type: String, default: "" },
  deliveryDate: { type: String, default: "" },
  // Bank reconciliation: amount actually received + any deduction applied
  // against this bill via a confirmed match in bank_reconciliation_matches
  paidAmount: { type: Number, default: 0 },
  deductionAmount: { type: Number, default: 0 },
  deductionType: { type: String, enum: ["TDS", "TDS+GST", "Kasar", null], default: null },
  deductionReason: { type: String, default: "" },
  paymentStatus: { type: String, enum: ["Pending", "Partial", "Paid"], default: "Pending" },
  // Username of the team member who created this order (blank for orders created
  // before this field existed, or via flows that don't yet capture it)
  createdBy: { type: String, default: "" },
  // Marks an order delivered on trust before the buyer's GeM order existed — see
  // advance_order_links collection for which later GeM order(s) cover it, and how much.
  isAdvanceOrder: { type: Boolean, default: false },
}, { timestamps: true }); // Automatically adds createdAt and updatedAt

export default models.SellerOrder || model("SellerOrder", SellerOrderSchema);