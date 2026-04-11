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
    // Sort by orderNo in descending order (-1) to get the HIGHEST existing number
    const lastOrder = await SellerOrder.findOne({}, { orderNo: 1 })
      .sort({ orderNo: -1 });
    
    let newOrderNo = "OD0001";

    if (lastOrder && lastOrder.orderNo) {
      // Use regex to find digits only (handles OD0001 -> 1)
      const lastNoMatch = lastOrder.orderNo.match(/\d+/);
      const lastNoNumeric = lastNoMatch ? parseInt(lastNoMatch[0]) : 0;
      const nextNo = lastNoNumeric + 1;
      
      newOrderNo = `OD${nextNo.toString().padStart(4, "0")}`;
    }

    // --- 2. EXTRA SAFETY CHECK ---
    // If the generated number still exists (can happen if a record was manually edited)
    // We increment until we find a free slot.
    let isDuplicate = await SellerOrder.exists({ orderNo: newOrderNo });
    while (isDuplicate) {
      const lastNoNumeric = parseInt(newOrderNo.replace("OD", ""));
      newOrderNo = `OD${(lastNoNumeric + 1).toString().padStart(4, "0")}`;
      isDuplicate = await SellerOrder.exists({ orderNo: newOrderNo });
    }

    // --- 3. CALCULATE TOTAL ---
    const totalAmount = Number(data.orderQty || 0) * Number(data.rate || 0);

    // --- 4. CREATE ORDER ---
    const newOrder = await SellerOrder.create({
      ...data,
      orderNo: newOrderNo,
      totalAmount,
      status: data.status || "TO CHECK" // Ensure default status is set
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