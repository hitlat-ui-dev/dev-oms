// @/models/SellerOrder.ts
import mongoose, { Schema, model, models } from "mongoose";

const SellerOrderSchema = new Schema({
  firmCode: { type: String, required: true },
  sellerId: { type: Schema.Types.ObjectId, ref: "Seller", required: true },
  instituteName: { type: String, required: true },
  itemId: { type: Schema.Types.ObjectId, ref: "Stock", required: true },
  itemName: { type: String, required: true },
  category: { type: String },
  unit: { type: String },
  contractDate: { type: String },
  contractNo: { type: String }, 
  contractUrl: { type: String },
  orderQty: { type: Number, required: true },
  rate: { type: Number, default: 0 },
  totalAmount: { type: Number, required: true },
  remark: { type: String },
  status: { type: String, default: "Pending" },
}, { timestamps: true }); // Automatically adds createdAt and updatedAt

export default models.SellerOrder || model("SellerOrder", SellerOrderSchema);