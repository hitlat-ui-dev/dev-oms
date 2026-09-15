import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { dcFileName, loadChallanPdf } from "@/lib/deliveryChallan";

const COLLECTION = "delivery_challans";

// GET /api/delivery-challans/[id]/pdf - serves the challan PDF. loadChallanPdf
// prefers the copy stored in R2 at finalize and falls back to re-rendering
// from the stored document (a draft preview, an edited challan whose stale
// copy was dropped, or an upload that failed at the time).
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

    const pdfBytes = await loadChallanPdf(challan);

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${dcFileName(challan)}"`,
      },
    });
  } catch (error: any) {
    console.error("DC PDF render error:", error);
    return NextResponse.json({ error: error.message || "Failed to render challan PDF" }, { status: 500 });
  }
}
