import mongoose, { Schema, model, models } from "mongoose";

const SellerSchema = new Schema({
  instituteName: { 
    type: String, 
    required: true, 
    trim: true 
    // uppercase: true removed
  },
  buyerName: { 
    type: String, 
    required: false, 
    trim: true 
  },
  mobile: { 
    type: String, 
    required: false 
  },
  address: { 
    type: String, 
    required: false 
  },
  place: { 
    type: String, 
    required: false, 
    trim: true 
  },
}, { timestamps: true });

export default models.Seller || model("Seller", SellerSchema);