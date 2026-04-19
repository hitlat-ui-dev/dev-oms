import mongoose, { Schema, model, models } from "mongoose";

const TransporterSchema = new Schema({
  name: { type: String, required: true, unique: true },
  address: { type: String, default: "" },
  deliveryArea: { type: String, default: "" },
  contacts: [
    {
      person: { type: String, default: "" },
      mobile: { type: String, default: "" },
    }
  ],
}, { timestamps: true });

export default models.Transporter || model("Transporter", TransporterSchema);