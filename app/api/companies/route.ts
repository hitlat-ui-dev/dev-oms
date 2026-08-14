import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// GET: To display the list in your table
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();
    const companies = await db.collection("companies").find({}).sort({ createdAt: -1 }).toArray();
    return NextResponse.json(companies);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch companies" }, { status: 500 });
  }
}

// POST: To save new companies or update existing ones
export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db();
    const data = await req.json();

    const companyData = {
      firmName: data.firmName ? data.firmName.trim().toUpperCase() : "",
      firmCode: data.firmCode ? data.firmCode.trim().toUpperCase() : "",
      sellerRegisterAddress: data.sellerRegisterAddress ? data.sellerRegisterAddress.trim() : "",
      dispatchAddress: data.dispatchAddress ? data.dispatchAddress.trim() : "",
      mobile: data.mobile ? data.mobile.trim() : "",
      updatedAt: new Date()
    };

    if (data._id) {
      let query: any = { _id: data._id };
      if (typeof data._id === "string" && ObjectId.isValid(data._id)) {
        query = { $or: [{ _id: data._id }, { _id: new ObjectId(data._id) }] };
      }

      const res = await db.collection("companies").updateOne(query, { $set: companyData });
      const updatedDoc = await db.collection("companies").findOne(query);
      return NextResponse.json(updatedDoc || { _id: data._id, ...companyData }, { status: 200 });
    }

    // Create new company
    const newCompany = {
      ...companyData,
      createdAt: new Date()
    };
    const result = await db.collection("companies").insertOne(newCompany);
    return NextResponse.json({ _id: result.insertedId, ...newCompany }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to save company" }, { status: 500 });
  }
}