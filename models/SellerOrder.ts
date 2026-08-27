// @/models/SellerOrder.ts
import mongoose, { Schema, model, models } from "mongoose";

const SellerOrderSchema = new Schema({
  orderNo: { type: String, unique: true },
  firmCode: { type: String, required: true },
  // Set when an outside party (not this firm itself) actually supplied/
  // handled the order, but it's billed/paperworked under this firm's GST -
  // kept separate from firmCode so billing/company lookups always resolve
  // to a real, fully-configured firm instead of a placeholder "tag" company.
  subParty: { type: String, default: "" },
  // Not required: 357 existing orders (mostly GeM auto-imports, matched by
  // institute name only, no linked Seller record) legitimately have this
  // null - app/api/seller-orders/route.ts's POST already works around
  // Mongoose's required check for that case with a raw insertOne, but the
  // Partial Ship / Return Order flows in [id]/route.ts still create their
  // split-off order via SellerOrder.create(), which does run this
  // validator and was rejecting every split/return on a null-sellerId
  // order with "sellerId: Path `sellerId` is required."
  sellerId: { type: Schema.Types.ObjectId, ref: "Seller", default: null },
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
  // Set once a Bill is generated covering this order (one Bill can cover
  // multiple SellerOrder docs sharing the same contractNo) - prevents the
  // same line item being billed twice.
  billId: { type: Schema.Types.ObjectId, ref: "Bill", default: null },
  invoiceNumber: { type: String, default: "" },
  // Lets an order be removed from the "Un-billed Contracts" list without an
  // actual Bill ever being generated for it - either because it was already
  // invoiced outside OMS (e.g. directly in Miracle, before this bill feature
  // existed) or because no bill is needed for it at all. Deliberately kept
  // separate from billId/Bill so these never get mixed into real invoice
  // history, numbering, or GST reporting.
  billExempt: { type: Boolean, default: false },
  billExemptReason: { type: String, enum: ["ALREADY_BILLED_EXTERNAL", "NOT_REQUIRED", null], default: null },
  billExemptNote: { type: String, default: "" },
  billExemptAt: { type: Date, default: null },
  billExemptBy: { type: String, default: "" },
  // Advance Order Merge System: an order created before the buyer's official
  // GeM order exists (material shipped on trust, firmCode is literally
  // "ADVANCE") is flagged isAdvance=true. Once the real GeM order later
  // appears, POST /api/seller-orders/merge folds the two into a single
  // surviving record and deletes the other - merged stays false forever on
  // an advance entry that never got matched (that's the "still outstanding"
  // signal the Advance-Pending filter uses), and mergedFromOrderId is set on
  // the SURVIVING record only, as an audit trail + the "Merged from Advance" tag.
  isAdvance: { type: Boolean, default: false },
  merged: { type: Boolean, default: false },
  mergedFromOrderId: { type: Schema.Types.ObjectId, ref: "SellerOrder", default: null },
}, { timestamps: true }); // Automatically adds createdAt and updatedAt

SellerOrderSchema.index({ firmCode: 1, createdAt: -1 });
SellerOrderSchema.index({ sellerId: 1, createdAt: -1 });
SellerOrderSchema.index({ sku: 1, status: 1 });
SellerOrderSchema.index({ paymentStatus: 1, firmCode: 1 });
SellerOrderSchema.index({ createdAt: -1 });
SellerOrderSchema.index({ contractNo: 1, firmCode: 1 });
SellerOrderSchema.index({ billId: 1 });
SellerOrderSchema.index({ firmCode: 1, billExempt: 1 });
SellerOrderSchema.index({ isAdvance: 1, merged: 1, instituteName: 1 });

export default models.SellerOrder || model("SellerOrder", SellerOrderSchema);