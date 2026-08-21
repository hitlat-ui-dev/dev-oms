import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { uploadFileToR2Bills, getFileFromR2Bills } from "@/lib/r2Bills";

// Hit from the GeM Bill Auto-Submit Chrome extension (chrome-extension://
// origin), not the OMS webapp itself, so CORS headers are needed here.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// POST /api/bills/[id]/gem-document - body is the raw PDF bytes
// (Content-Type: application/pdf). Stores GeM's own e-signed invoice
// document, fetched by the extension right after a successful OTP-verified
// submission - distinct from the OMS-generated PDF at /api/bills/[id]/pdf.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid bill id" }, { status: 400, headers: corsHeaders });
    }

    const client = await clientPromise;
    const db = client.db();
    const bill = await db.collection("bills").findOne({ _id: new ObjectId(id) });
    if (!bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404, headers: corsHeaders });
    }

    const arrayBuffer = await req.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      return NextResponse.json({ error: "Empty file body" }, { status: 400, headers: corsHeaders });
    }

    const gemDocumentR2Key = `bills/${bill.firmCode}/${bill.invoiceNumber}-gem-official.pdf`;
    await uploadFileToR2Bills(Buffer.from(arrayBuffer), gemDocumentR2Key, "application/pdf");

    await db.collection("bills").updateOne(
      { _id: new ObjectId(id) },
      { $set: { gemDocumentR2Key, gemSubmittedAt: new Date() } }
    );

    return NextResponse.json({ success: true }, { status: 201, headers: corsHeaders });
  } catch (error: any) {
    console.error("GeM document upload error:", error);
    return NextResponse.json({ error: error.message || "Upload failed" }, { status: 500, headers: corsHeaders });
  }
}

// GET /api/bills/[id]/gem-document - serves GeM's own stored invoice PDF.
// No re-render fallback (unlike /pdf) since this document isn't something
// OMS can regenerate - it only exists once the extension has uploaded it.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid bill id" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();
    const bill = await db.collection("bills").findOne({ _id: new ObjectId(id) });
    if (!bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }
    if (!bill.gemDocumentR2Key) {
      return NextResponse.json({ error: "GeM ka official document abhi tak upload nahi hua." }, { status: 404 });
    }

    const stored = await getFileFromR2Bills(bill.gemDocumentR2Key);
    return new NextResponse(new Uint8Array(stored), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${bill.invoiceNumber}-GeM.pdf"`,
      },
    });
  } catch (error: any) {
    console.error("GeM document fetch error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch" }, { status: 500 });
  }
}
