import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import Company from "@/models/Company";
import mongoose from "mongoose";

async function connectDB() {
  // Uses your existing clientPromise logic
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

// GET: To display the list in your table
export async function GET() {
  try {
    await connectDB();
    const companies = await Company.find({}).sort({ createdAt: -1 });
    return NextResponse.json(companies);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch companies" }, { status: 500 });
  }
}

// POST: To save new companies
export async function POST(req: Request) {
  try {
    await connectDB();
    const data = await req.json();
    
    // Ensure data is saved in Uppercase for consistency
    const newCompany = await Company.create({
      firmName: data.firmName.toUpperCase(),
      firmCode: data.firmCode.toUpperCase()
    });
    
    return NextResponse.json(newCompany, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to save company" }, { status: 500 });
  }
}