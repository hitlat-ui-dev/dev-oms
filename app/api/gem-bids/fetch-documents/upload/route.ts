import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";
import { uploadFileToR2 } from "@/lib/cloudflareR2";

const DB_NAME = "dev_oms_db";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

const KIND_FIELD: Record<string, string> = {
  atc: "bidSpecificAtc",
  bidLink: "bidLinkDoc",
};

// POST multipart/form-data { bidId, kind: "atc" | "bidLink", file } — called
// by the extension's background worker once it's fetched one of the two
// source PDFs for a claimed fetch-documents job (see ../route.ts's GET).
// Called once per kind that succeeded; a kind that failed to fetch is never
// uploaded (left null, see ../finish/route.ts for how that's reported).
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const bidId = String(form.get("bidId") || "");
    const kind = String(form.get("kind") || "");
    const file = form.get("file") as File | null;

    if (!bidId || !ObjectId.isValid(bidId)) {
      return NextResponse.json({ error: "Valid bidId is required" }, { status: 400, headers: corsHeaders });
    }
    if (!KIND_FIELD[kind]) {
      return NextResponse.json({ error: "kind must be atc or bidLink" }, { status: 400, headers: corsHeaders });
    }
    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400, headers: corsHeaders });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const key = `bids/${bidId}/source-docs/${kind}.pdf`;
    await uploadFileToR2(bytes, key, "application/pdf");

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const now = new Date();
    await db.collection("gem_bids").updateOne(
      { _id: new ObjectId(bidId) },
      { $set: { [`${KIND_FIELD[kind]}.fileKey`]: key, [`${KIND_FIELD[kind]}.fetchedAt`]: now } }
    );

    return NextResponse.json({ success: true, key }, { headers: corsHeaders });
  } catch (error: any) {
    console.error("GeM bid fetch-documents upload error:", error);
    return NextResponse.json({ error: error.message || "Upload failed" }, { status: 500, headers: corsHeaders });
  }
}
