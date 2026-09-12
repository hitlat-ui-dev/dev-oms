import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { generateDeliveryChallanPdf } from "@/lib/generateDeliveryChallanPdf";
import { dcFileName, toPdfData } from "@/lib/deliveryChallan";
import { getFileFromR2Bills } from "@/lib/r2Bills";

const COLLECTION = "delivery_challans";

// GET /api/delivery-challans/[id]/pdf - serves the challan PDF straight from
// R2 when one was stored at finalize time, otherwise re-renders it from the
// stored document (a draft preview, an edited challan whose stale copy was
// dropped, or a failed upload at the time).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid challan id" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();
    const challan = await db.collection(COLLECTION).findOne({ _id: new ObjectId(id) });
    if (!challan) {
      return NextResponse.json({ error: "Challan not found" }, { status: 404 });
    }
    if (!challan.items || challan.items.length === 0) {
      return NextResponse.json({ error: "This challan has no items to print." }, { status: 400 });
    }

    const fileName = dcFileName(challan);

    if (challan.r2Key) {
      try {
        const stored = await getFileFromR2Bills(challan.r2Key);
        return new NextResponse(new Uint8Array(stored), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="${fileName}"`,
          },
        });
      } catch (err: any) {
        console.error("R2 fetch failed for DC, falling back to re-render:", err.message);
      }
    }

    const pdfBytes = await generateDeliveryChallanPdf(toPdfData(challan));

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fileName}"`,
      },
    });
  } catch (error: any) {
    console.error("DC PDF render error:", error);
    return NextResponse.json({ error: error.message || "Failed to render challan PDF" }, { status: 500 });
  }
}
