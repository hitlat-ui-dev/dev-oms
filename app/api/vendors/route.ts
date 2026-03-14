import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import Vendor from "@/models/Vendor";
import mongoose from "mongoose";

async function connectDB() {
  // Using clientPromise ensures the underlying driver is ready
  await clientPromise; 
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

export async function POST(req: Request) {
  try {
    await connectDB();
    const data = await req.json();

    // 1. Manually ensure optional fields are handled if missing in the payload
    const vendorData = {
      name: data.name,
      place: data.place,
      mobile: data.mobile || "",  // Defaults to empty string if not provided
      address: data.address || "", // Defaults to empty string if not provided
    };

    // 2. Validate mandatory fields before calling the model to prevent unhandled crashes
    if (!vendorData.name || !vendorData.place) {
      return NextResponse.json({ error: "Name and Place are required" }, { status: 400 });
    }

    const newVendor = await Vendor.create(vendorData);
    
    return NextResponse.json({ success: true, data: newVendor }, { status: 201 });
  } catch (error: any) {
    console.error("Vendor Save Error:", error);
    
    // 3. Detailed error reporting for debugging
    return NextResponse.json(
      { error: error.message || "Failed to save vendor" }, 
      { status: 500 }
    );
  }
}