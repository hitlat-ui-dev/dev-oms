import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import Transporter from "@/models/Transporter";
import mongoose from "mongoose";

async function connectDB() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

export async function GET() {
  await connectDB();
  const data = await Transporter.find({}).sort({ createdAt: -1 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  try {
    await connectDB();
    const body = await req.json();
    const newData = await Transporter.create(body);
    return NextResponse.json(newData, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  try {
    await connectDB();
    const { id, ...updates } = await req.json();
    // Delete name from updates to ensure it's never changed
    delete updates.name; 
    const updated = await Transporter.findByIdAndUpdate(id, updates, { new: true });
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}