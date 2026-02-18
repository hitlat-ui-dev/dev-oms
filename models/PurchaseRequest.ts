import mongoose, { Schema, model, models } from "mongoose";

const PurchaseRequestSchema = new Schema({
  itemName: { type: String, required: true },
  unit: { type: String, required: true },
  qty: { type: Number, required: true },
  remark: { type: String, default: "" },
  status: { 
    type: String, 
    enum: ["Purchase Request", "Purchase Placed", "Purchase Received", "Canceled", "On Hold", "Return to Vendor"],
    default: "Purchase Request" 
  },
}, { timestamps: true });

export default models.PurchaseRequest || model("PurchaseRequest", PurchaseRequestSchema);