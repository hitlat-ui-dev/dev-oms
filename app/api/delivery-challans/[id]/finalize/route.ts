import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { generateDeliveryChallanPdf } from "@/lib/generateDeliveryChallanPdf";
import { toPdfData } from "@/lib/deliveryChallan";
import {
  claimManualDcNumber,
  claimNextDcNumber,
  formatDcNumber,
  getFinancialYear,
  shortFinancialYear,
} from "@/lib/dcNumbering";
import { uploadFileToR2Bills } from "@/lib/r2Bills";

const COLLECTION = "delivery_challans";

// POST /api/delivery-challans/[id]/finalize
//
// Issues the challan: claims its number from the firm's FY counter, renders
// the PDF and stores it. This is where a number is consumed - never at draft
// save - so an abandoned draft leaves no hole in the series.
//
// Re-running it on an ALREADY finalized challan re-renders the PDF against the
// current content and keeps the existing number ("edit + regenerate"); it never
// claims a second one.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid challan id" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const client = await clientPromise;
    const db = client.db();

    const challan = await db.collection(COLLECTION).findOne({ _id: new ObjectId(id) });
    if (!challan) {
      return NextResponse.json({ error: "Challan not found" }, { status: 404 });
    }
    if (!challan.items || challan.items.length === 0) {
      return NextResponse.json({ error: "Add at least one item before generating the challan." }, { status: 400 });
    }

    let dcNumber: number = challan.dcNumber;
    let financialYear: string = challan.financialYear;
    let dcNumberFormatted: string = challan.dcNumberFormatted;
    let numberMode: string = challan.numberMode || "auto";

    if (challan.status !== "finalized") {
      const fy = getFinancialYear(new Date(challan.date));
      financialYear = shortFinancialYear(fy);
      numberMode = body.numberMode === "manual" ? "manual" : body.numberMode === "auto" ? "auto" : numberMode;

      try {
        dcNumber =
          numberMode === "manual"
            ? await claimManualDcNumber(db, challan.firmCode, fy, Number(body.manualNumber))
            : await claimNextDcNumber(db, challan.firmCode, fy);
      } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }

      dcNumberFormatted = formatDcNumber(dcNumber, financialYear);

      await db.collection(COLLECTION).updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            dcNumber,
            financialYear,
            dcNumberFormatted,
            numberMode,
            status: "finalized",
            finalizedAt: new Date(),
            finalizedBy: (body.finalizedBy || "").toString().trim(),
            updatedAt: new Date(),
          },
        }
      );
    }

    const issued = { ...challan, dcNumber, financialYear, dcNumberFormatted, numberMode, status: "finalized" };
    const pdfBytes = await generateDeliveryChallanPdf(toPdfData(issued));
    const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

    // Store the PDF alongside the bills in R2 so it can be re-served instantly
    // later. Best-effort: the challan is issued either way, and [id]/pdf
    // re-renders from the stored document when there's no object to fetch.
    const r2Key = `delivery-challans/${challan.firmCode || "no-firm"}/${dcNumberFormatted.replace(/\//g, "-")}.pdf`;
    try {
      await uploadFileToR2Bills(Buffer.from(pdfBytes), r2Key, "application/pdf");
      await db.collection(COLLECTION).updateOne({ _id: new ObjectId(id) }, { $set: { r2Key } });
    } catch (err: any) {
      console.error("R2 upload failed for DC (challan still issued, PDF re-renders on demand):", err.message);
    }

    return NextResponse.json({
      success: true,
      challanId: id,
      dcNumberFormatted,
      financialYear,
      pdfBase64,
    });
  } catch (error: any) {
    console.error("POST delivery-challan finalize error:", error);
    return NextResponse.json({ error: error.message || "Failed to generate challan" }, { status: 500 });
  }
}
