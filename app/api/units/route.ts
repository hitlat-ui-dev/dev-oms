import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import Unit from "@/models/Unit";
import mongoose from "mongoose";

async function connectDB() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

export async function GET() {
  try {
    await connectDB();
    const units = await Unit.find({}).sort({ name: 1 });
    return NextResponse.json(units);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch units" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await connectDB();
    const { name } = await req.json();
    
    // Check if unit already exists to prevent duplicates
    const existing = await Unit.findOne({ name: name.trim() });
    if (existing) {
      return NextResponse.json({ error: "Unit already exists" }, { status: 400 });
    }

    const newUnit = await Unit.create({ name: name.trim() });
    return NextResponse.json(newUnit, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create unit" }, { status: 500 });
  }
}