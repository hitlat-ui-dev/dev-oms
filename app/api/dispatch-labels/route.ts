import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// POST /api/dispatch-labels - called when a printed parcel is SCANNED (see
// app/dashboard/dispatch-scan/page.tsx), not when its label is printed.
// Printing saves nothing; the QR carries the parcel's own details (see
// lib/dispatchLabel.ts) and the record is only created once someone scans
// the parcel and picks the transporter it actually went out with.
//
// Everything except the transporter comes from the QR payload and is stored
// as a snapshot - same reasoning as firmSnapshot/buyerSnapshot on Bills
// (app/api/bills/generate/route.ts): editing a company/institute later must
// never rewrite what an already-dispatched parcel says.
//
// No auth check - consistent with every other route in this app.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      labelId, printedAt,
      fromFirmCode, fromFirmName, fromAddress, fromMobile,
      toInstituteName, toBuyerName, toAddress, toMobile, toPlace,
      transporterName, transporterMobile, scannedBy,
    } = body;

    if (!labelId || !fromFirmName || !(toInstituteName || toBuyerName) || !transporterName) {
      return NextResponse.json(
        { error: "labelId, fromFirmName, a recipient name and transporterName are required." },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db();

    // Scanning the same sticker twice (double-tap, or a second person
    // checking the parcel) must not create a second dispatch - hand back
    // what is already on file instead.
    const existing = await db.collection("dispatchLabels").findOne({ labelId });
    if (existing) {
      return NextResponse.json({ ...existing, alreadyScanned: true });
    }

    const doc = {
      labelId,
      fromFirmCode: fromFirmCode || "",
      fromFirmName,
      fromAddress: fromAddress || "",
      fromMobile: fromMobile || "",
      toInstituteName: toInstituteName || "",
      toBuyerName: toBuyerName || "",
      toAddress: toAddress || "",
      toMobile: toMobile || "",
      toPlace: toPlace || "",
      transporterName,
      transporterMobile: transporterMobile || "",
      scannedBy: scannedBy || "",
      printedAt: printedAt ? new Date(printedAt) : null,
      scannedAt: new Date(),
    };

    const result = await db.collection("dispatchLabels").insertOne(doc);
    return NextResponse.json({ _id: result.insertedId, ...doc }, { status: 201 });
  } catch (error: any) {
    console.error("Dispatch label save error:", error);
    return NextResponse.json({ error: error.message || "Failed to save dispatch" }, { status: 500 });
  }
}

// GET /api/dispatch-labels?labelId=  -> one record (has this sticker already
//                                      been scanned?), 404 if not yet
// GET /api/dispatch-labels?q=&from=&to= -> the Dispatch History table, newest
//                                      scan first, capped so one response
//                                      never grows unbounded
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const labelId = (searchParams.get("labelId") || "").trim();
    const q = (searchParams.get("q") || "").trim();
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const client = await clientPromise;
    const db = client.db();

    if (labelId) {
      const one = await db.collection("dispatchLabels").findOne({ labelId });
      if (!one) return NextResponse.json({ error: "Not scanned yet" }, { status: 404 });
      return NextResponse.json(one);
    }

    const query: Record<string, any> = {};
    if (q) {
      const regex = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
      query.$or = [
        { toInstituteName: regex },
        { toBuyerName: regex },
        { fromFirmName: regex },
        { transporterName: regex },
      ];
    }
    if (from || to) {
      query.scannedAt = {};
      if (from) query.scannedAt.$gte = new Date(`${from}T00:00:00`);
      if (to) query.scannedAt.$lte = new Date(`${to}T23:59:59`);
    }

    const labels = await db
      .collection("dispatchLabels")
      .find(query)
      .sort({ scannedAt: -1 })
      .limit(200)
      .toArray();

    return NextResponse.json(labels);
  } catch (error: any) {
    console.error("Dispatch label list error:", error);
    return NextResponse.json({ error: error.message || "Failed to load dispatches" }, { status: 500 });
  }
}
