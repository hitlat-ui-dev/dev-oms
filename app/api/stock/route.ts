import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    // Fetch all stock items (excluding bulky history array for UI performance)
    const stockItems = await db.collection("stock").find({}, { projection: { history: 0 } }).sort({ _id: -1 }).toArray();

    // Format data for the frontend
    const formattedStock = stockItems.map((item) => {
      // Logic for Rate Display: Show single price or a range if available
      const rateDisplay = item.rate ? `₹${item.rate}` : "N/A";
      
      return {
        _id: item._id,
        sku: item.sku || "N/A",
        itemName: item.itemName || "Unknown Item",
        category: item.category || "General",
        location: item.location || "---",
        reQty: item.reQty || 0,
        totalQty: item.quantity || 0, // Matching your 'quantity' field in DB
        unit: item.unit || "pcs",
        rateDisplay: rateDisplay,
        hidden: item.hidden || false,
        rate: item.rate ?? "",
        variantGroup: item.variantGroup || "",
        variantLabel: item.variantLabel || "",
        hsnSac: item.hsnSac || "",
        gstPercent: item.gstPercent || 0,
        hsnGstConfirmed: item.hsnGstConfirmed || false
      };
    });

    return NextResponse.json(formattedStock);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}