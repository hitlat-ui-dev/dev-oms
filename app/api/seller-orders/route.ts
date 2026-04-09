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

    // --- 1. GENERATE AUTO-INCREMENT ORDER NO ---
    // Find the latest order to get the last number used
    const lastOrder = await SellerOrder.findOne().sort({ createdAt: -1 });
    
    let newOrderNo = "OD0001"; // Default if no orders exist

    if (lastOrder && lastOrder.orderNo) {
      // Remove "OD" prefix, convert to number, and add 1
      const lastNoNumeric = parseInt(lastOrder.orderNo.replace("OD", ""));
      const nextNo = lastNoNumeric + 1;
      
      // Format back to OD + 4 digits (e.g., OD0002)
      newOrderNo = `OD${nextNo.toString().padStart(4, "0")}`;
    }

    // --- 2. CALCULATE TOTAL ---
    const totalAmount = Number(data.orderQty || 0) * Number(data.rate || 0);

    // --- 3. CREATE ORDER ---
    // This will now include orderNo and contractUrl from the data object
    const newOrder = await SellerOrder.create({
      ...data,
      orderNo: newOrderNo,
      totalAmount,
    });

    return NextResponse.json(newOrder, { status: 201 });
  } catch (error: any) {
    console.error("Seller Order POST Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create order" }, 
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    await connectDB();
    // Use .lean() for faster fetching and easier data handling
    const orders = await SellerOrder.find({}).sort({ createdAt: -1 }).lean();
    return NextResponse.json(orders, { status: 200 });
  } catch (error: any) {
    console.error("Seller Order GET Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch orders" }, 
      { status: 500 }
    );
  }
}