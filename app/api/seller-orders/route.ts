import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import SellerOrder from "@/models/SellerOrder";
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

    // Server-side calculation of total to prevent tampering
    const totalAmount = Number(data.orderQty || 0) * Number(data.rate || 0);

    const newOrder = await SellerOrder.create({
      ...data,
      totalAmount,
    });

    return NextResponse.json(newOrder, { status: 201 });
  } catch (error: any) {
    console.error("Seller Order Error:", error);
    return NextResponse.json({ error: error.message || "Failed to create order" }, { status: 500 });
  }
}

export async function GET() {
  try {
    await connectDB();
    const orders = await SellerOrder.find({}).sort({ createdAt: -1 });
    return NextResponse.json(orders, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}