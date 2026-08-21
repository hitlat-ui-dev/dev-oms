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

    const gstin = data.gstin ? data.gstin.trim().toUpperCase() : "";
    const pan = data.pan ? data.pan.trim().toUpperCase() : "";
    if (!gstin && !pan) {
      return NextResponse.json(
        { error: "PAN is compulsory when GSTIN is not provided." },
        { status: 400 }
      );
    }

    const companyData = {
      firmName: data.firmName ? data.firmName.trim().toUpperCase() : "",
      firmCode: data.firmCode ? data.firmCode.trim().toUpperCase() : "",
      sellerRegisterAddress: data.sellerRegisterAddress ? data.sellerRegisterAddress.trim() : "",
      dispatchAddress: data.dispatchAddress ? data.dispatchAddress.trim() : "",
      mobile: data.mobile ? data.mobile.trim() : "",
      state: data.state ? data.state.trim() : "",
      gstin: gstin || null,
      pan: pan || null,
      isCompositionDealer: !!data.isCompositionDealer,
      bank: {
        bankName: data.bank?.bankName ? data.bank.bankName.trim() : "",
        accountNo: data.bank?.accountNo ? data.bank.accountNo.trim() : "",
        ifsc: data.bank?.ifsc ? data.bank.ifsc.trim().toUpperCase() : "",
        branch: data.bank?.branch ? data.bank.branch.trim() : "",
      },
      contactEmail: data.contactEmail ? data.contactEmail.trim() : "",
      gmailAccountEmail: data.gmailAccountEmail ? data.gmailAccountEmail.trim() : "",
      // invoiceNumbering.prefix is set via dot-notation below so history
      // (managed only by the bill-generation flow) is never touched here.
      "invoiceNumbering.prefix": data.invoiceNumbering?.prefix
        ? data.invoiceNumbering.prefix.trim().toUpperCase()
        : "",
      updatedAt: new Date()
    } as Record<string, any>;

    if (data._id) {
      let query: any = { _id: data._id };
      if (typeof data._id === "string" && ObjectId.isValid(data._id)) {
        query = { $or: [{ _id: data._id }, { _id: new ObjectId(data._id) }] };
      }

      await db.collection("companies").updateOne(query, { $set: companyData });
      const updatedDoc = await db.collection("companies").findOne(query);
      return NextResponse.json(updatedDoc || { _id: data._id, ...companyData }, { status: 200 });
    }

    // Create new company
    const { "invoiceNumbering.prefix": prefix, ...rest } = companyData;
    const newCompany = {
      ...rest,
      invoiceNumbering: { prefix, history: [] },
      isActive: true,
      createdAt: new Date()
    };
    const result = await db.collection("companies").insertOne(newCompany);
    return NextResponse.json({ _id: result.insertedId, ...newCompany }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to save company" }, { status: 500 });
  }
}