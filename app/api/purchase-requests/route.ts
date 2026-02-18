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