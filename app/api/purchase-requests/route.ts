import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import PurchaseRequest from "@/models/PurchaseRequest";
import mongoose from "mongoose";

async function connectDB() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

export async function POST(req: Request) {
  try {
    await connectDB();
    const data = await req.json();
    const newRequest = await PurchaseRequest.create(data);
    return NextResponse.json(newRequest, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to save request" }, { status: 500 });
  }
}

export async function GET() {
  try {
    await connectDB();
    const requests = await PurchaseRequest.find({}).sort({ createdAt: -1 });
    return NextResponse.json(requests);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch requests" }, { status: 500 });
  }
}