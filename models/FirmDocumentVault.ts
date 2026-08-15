import mongoose, { Schema, model, models } from "mongoose";

// One vault per firm — dynamic (user-typed) document fields plus the fixed
// sign/stamp/letterhead slots the Bid Document Maker overlays onto every
// generated output. Only the R2 object key is stored here; the actual file
// bytes live in Cloudflare R2 (see lib/cloudflareR2.ts).
const FirmDocumentVaultSchema = new Schema(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Company", required: true, unique: true },
    documents: [
      {
        name: { type: String, required: true, trim: true },
        r2Key: { type: String, required: true },
        originalFileName: { type: String, default: "" },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    letterheadKey: { type: String, default: null },
    signKey: { type: String, default: null },
    stampKey: { type: String, default: null },
  },
  { timestamps: true }
);

export default models.FirmDocumentVault || model("FirmDocumentVault", FirmDocumentVaultSchema);
