import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import Item from "@/models/Item";
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
    const items = await Item.find({}).sort({ createdAt: -1 });
    
    // Logic to generate next SKU
    const lastItem = await Item.findOne().sort({ sku: -1 });
    let nextSku = "S1100";
    if (lastItem && lastItem.sku) {
      const lastNum = parseInt(lastItem.sku.replace("S", ""));
      nextSku = `S${lastNum + 1}`;
    }

    return NextResponse.json({ items, nextSku });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await connectDB();
    const data = await req.json();
    const newItem = await Item.create(data);
    return NextResponse.json(newItem, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Duplicate SKU or Invalid Data" }, { status: 400 });
  }
}