import { NextResponse } from "next/server";
import Seller from "@/models/Seller";
import mongoose from "mongoose";
import dbConnect from "@/lib/dbConnect";

// DELETE: Remove a seller/institute record
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();
    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid seller id" }, { status: 400 });
    }

    const deleted = await Seller.findByIdAndDelete(id);
    if (!deleted) {
      return NextResponse.json({ error: "Seller not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    console.error("DELETE seller error:", error.message);
    return NextResponse.json({ error: error.message || "Failed to delete seller" }, { status: 500 });
  }
}
