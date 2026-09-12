// @/models/DcItemMaster.ts
// The reusable item list behind the Delivery Challan screen's typeahead.
//
// Deliberately NOT models/Item.ts: a stock Item needs a unique SKU, a
// category and a stock ledger, none of which a challan line has - a DC
// commonly lists packing material, samples or loose goods that were never
// stocked. This is just a name + its usual unit, shared across firms the
// same way Unit is, so an item typed once on any firm's challan is offered
// on every later one.
import { Schema, model, models } from "mongoose";

const DcItemMasterSchema = new Schema(
  {
    itemName: { type: String, required: true, trim: true },
    // Lowercased itemName - the actual uniqueness key, so "Carton Box" and
    // "carton box" can't both end up in the dropdown.
    nameKey: { type: String, required: true, lowercase: true, trim: true, unique: true },
    unit: { type: String, default: "" },
    // How many challan lines have used this item - drives "most used first"
    // ordering in the dropdown so the everyday items stay at the top.
    usageCount: { type: Number, default: 0 },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

DcItemMasterSchema.index({ itemName: 1 });

export default models.DcItemMaster || model("DcItemMaster", DcItemMasterSchema, "dc_item_masters");
