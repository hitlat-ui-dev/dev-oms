import mongoose, { Schema, model, models } from "mongoose";

const ReceivedPurchaseSchema = new Schema({
  originalOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequest' },
  itemName: { type: String, required: true },
  receivedQty: { type: Number, required: true },
  orderQty: { type: Number },
  unit: { type: String },
  vendor: { type: String },
  rate: { type: Number },
  remark: { type: String },
  status: { type: String, default: "Received Purchase" },
  receivedAt: { type: Date, default: Date.now }
}, { 
  // This explicitly names the collection in MongoDB
  collection: 'Received purchase' 
});

export default models.ReceivedPurchase || model("ReceivedPurchase", ReceivedPurchaseSchema);