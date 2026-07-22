import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// DELETE: Reject/Delete a raw fetched GeM order
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    const { id } = params;

    const result = await db.collection("raw_gem_orders").deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Order not found" }, { status: 404, headers: corsHeaders });
    }

    return NextResponse.json({ success: true, message: "Raw GeM order deleted" }, { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error("DELETE raw order error:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}

// POST: Verify and move raw GeM order to main sellerorders collection
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    const { id } = params;

    const body = await req.json();

    // 1. Find raw order
    const rawOrder = await db.collection("raw_gem_orders").findOne({ _id: new ObjectId(id) });
    if (!rawOrder) {
      return NextResponse.json({ error: "Raw GeM order not found" }, { status: 404, headers: corsHeaders });
    }

    // 2. Generate new OD Order Number
    const lastOrder = await db.collection("sellerorders").find({}, { projection: { orderNo: 1 } }).sort({ orderNo: -1 }).limit(1).toArray();
    let newOrderNo = "OD0001";
    if (lastOrder && lastOrder.length > 0 && lastOrder[0].orderNo) {
      const lastNoMatch = lastOrder[0].orderNo.match(/\d+/);
      const lastNoNumeric = lastNoMatch ? parseInt(lastNoMatch[0]) : 0;
      newOrderNo = `OD${(lastNoNumeric + 1).toString().padStart(4, "0")}`;
    }

    // Double check uniqueness
    let exists = await db.collection("sellerorders").findOne({ orderNo: newOrderNo });
    while (exists) {
      const num = parseInt(newOrderNo.replace("OD", "")) + 1;
      newOrderNo = `OD${num.toString().padStart(4, "0")}`;
      exists = await db.collection("sellerorders").findOne({ orderNo: newOrderNo });
    }

    const orderQty = Number(body.qty || rawOrder.qty || 1);
    const rate = Number(body.rate || rawOrder.rate || 0);
    const totalAmount = Number(body.totalAmount || rawOrder.totalAmount || (orderQty * rate));

    // 3. Construct verified main order document
    const verifiedOrder = {
      orderNo: newOrderNo,
      firmCode: body.firmCode || "GeM",
      sellerId: body.sellerId ? new ObjectId(body.sellerId) : null,
      instituteName: body.instituteName || rawOrder.instituteName || "GeM Buyer",
      itemId: body.itemId ? new ObjectId(body.itemId) : null,
      itemName: body.itemName || rawOrder.itemName || "GeM Order Item",
      category: body.category || "General",
      unit: body.unit || "nos",
      sku: body.sku || "",
      contractDate: body.contractDate || rawOrder.contractDate || "",
      contractNo: rawOrder.contractNo,
      contractUrl: rawOrder.contractUrl || "",
      reQty: orderQty,
      rate,
      totalAmount,
      remark: body.remark || `Verified GeM Order (${rawOrder.location || ""})`.trim(),
      status: "TO CHECK",
      isPaid: false,
      transportName: "",
      transportRemark: "",
      deliveryDate: "",
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // 4. Save to main sellerorders collection
    await db.collection("sellerorders").insertOne(verifiedOrder);

    // 5. Remove from raw_gem_orders collection
    await db.collection("raw_gem_orders").deleteOne({ _id: new ObjectId(id) });

    return NextResponse.json({ success: true, message: "Order verified and moved to Main Orders", orderNo: newOrderNo }, { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error("Verify order error:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
