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
}, { timestamps: true }); // Automatically adds createdAt and updatedAt

export default models.SellerOrder || model("SellerOrder", SellerOrderSchema);