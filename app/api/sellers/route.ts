import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import Seller from "@/models/Seller";
import mongoose from "mongoose";

async function connectDB() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

/**
 * GET: Fetch all sellers for the table
 */
export async function GET() {
  try {
    await connectDB();
    const sellers = await Seller.find({}).sort({ createdAt: -1 });
    return NextResponse.json(sellers, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch sellers" }, { status: 500 });
  }
}

/**
 * POST: Create a new seller OR Update an existing one
 */
export async function POST(req: Request) {
  try {
    await connectDB();
    const data = await req.json();

    // 1. Validation: Ensure required fields exist
    if (!data.instituteName) {
      return NextResponse.json({ error: "Institute Name is required" }, { status: 400 });
    }

    // 2. Prepare Data (Cleaning nulls/undefined to empty strings)
    const sellerData = {
      instituteName: data.instituteName.trim(),
      buyerName: data.buyerName?.trim() || "",
      mobile: data.mobile?.trim() || "",
      address: data.address?.trim() || "",
      place: data.place?.trim() || ""
    };

    // 3. Update if _id exists, else Create
    if (data._id && mongoose.Types.ObjectId.isValid(data._id)) {
      const updatedSeller = await Seller.findByIdAndUpdate(
        data._id,
        { $set: sellerData },
        { new: true, runValidators: true }
      );
      
      if (!updatedSeller) {
        return NextResponse.json({ error: "Seller not found" }, { status: 404 });
      }
      
      return NextResponse.json(updatedSeller, { status: 200 });
    }

    // Create new record
    const newSeller = await Seller.create(sellerData);
    return NextResponse.json(newSeller, { status: 201 });

  } catch (error: any) {
    console.error("Database Error Details:", error.message);
    return NextResponse.json(
      { error: error.message || "Failed to save seller information" }, 
      { status: 500 }
    );
  }
}

/**
 * PUT: Explicit Update method
 * (Optional: You can use this if you prefer calling method: "PUT" in frontend)
 */
export async function PUT(req: Request) {
  try {
    await connectDB();
    const data = await req.json();
    const { _id, ...updateData } = data;

    const updated = await Seller.findByIdAndUpdate(_id, updateData, { new: true });
    return NextResponse.json(updated, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}