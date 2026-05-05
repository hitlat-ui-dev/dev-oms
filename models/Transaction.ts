import mongoose from "mongoose";

const TransactionSchema = new mongoose.Schema({
  sku: { type: String, required: true, index: true }, 
  itemName: { type: String, required: true },
  type: { 
    type: String, 
    enum: ['SELL', 'PURCHASE', 'SELL_RETURN', 'PURCHASE_RETURN'], 
    required: true 
  },
  quantity: { type: Number, required: true }, 
  newStock: { type: Number, required: true }, // Balance after transaction
  
  // The "Details" fields you requested
  orderNo: { type: String },      // For Sells/Returns
  orderDate: { type: Date },      // For Sells
  sellerName: { type: String },   // For Sells/Marketplace details
  vendorName: { type: String },   // For Purchases/Returns
  invoiceNo: { type: String },    // For Purchases
  reason: { type: String },       // For Returns
  
  date: { type: Date, default: Date.now }
});

export default mongoose.models.Transaction || mongoose.model("Transaction", TransactionSchema);