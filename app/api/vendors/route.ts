import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// Name of your database to keep everything pointed to the right place
const DB_NAME = "dev_oms_db";

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db(DB_NAME);
    
    const vendors = await db.collection("vendors").find({}).toArray();
    return NextResponse.json(vendors);
  } catch (error: any) {
    console.error("Vendor GET Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const data = await req.json();

    // 1. Structure data and trim spaces safely
    const vendorData = {
      name: data.name?.trim(),
      place: data.place?.trim(),
      mobile: data.mobile?.trim() || "",  
      address: data.address?.trim() || "", 
      createdAt: new Date() // Useful for keeping list sorting stable
    };

    // 2. Clear validation check
    if (!vendorData.name || !vendorData.place) {
      return NextResponse.json({ error: "Name and Place are required" }, { status: 400 });
    }

    // 3. Insert directly using the native collection driver
    const result = await db.collection("vendors").insertOne(vendorData);
    
    return NextResponse.json({ 
      success: true, 
      data: { _id: result.insertedId, ...vendorData } 
    }, { status: 201 });

  } catch (error: any) {
    console.error("Vendor Save Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to save vendor" }, 
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db(DB_NAME);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Vendor ID is required" }, { status: 400 });
    }

    const result = await db.collection("vendors").deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Vendor document not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Vendor deleted successfully" }, { status: 200 });
  } catch (error: any) {
    console.error("Vendor Delete Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete vendor" },
      { status: 500 }
    );
  }
}