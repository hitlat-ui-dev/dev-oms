import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { generateBillPdf, BillPdfData } from "@/lib/generateBillPdf";
import { getFileFromR2Bills } from "@/lib/r2Bills";

function formatDateDDMMYYYY(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

// GET /api/bills/[id]/pdf - serves the PDF straight from R2 when it was
// stored there at generation time; falls back to re-rendering from the
// stored Bill snapshot (bills generated before R2 was wired up, or if the
// R2 upload failed at the time).
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

    if (bill.r2Key) {
      try {
        const stored = await getFileFromR2Bills(bill.r2Key);
        return new NextResponse(new Uint8Array(stored), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="${bill.invoiceNumber}.pdf"`,
          },
        });
      } catch (err: any) {
        console.error("R2 bills fetch failed, falling back to re-render:", err.message);
      }
    }

    const pdfData: BillPdfData = {
      billType: bill.billType,
      gstSplit: bill.gstSplit,
      invoiceNumber: bill.invoiceNumber,
      invoiceDate: formatDateDDMMYYYY(new Date(bill.invoiceDate)),
      placeOfSupply: bill.placeOfSupply,
      firm: {
        name: bill.firmSnapshot.name,
        address: bill.firmSnapshot.address,
        mobile: bill.firmSnapshot.mobile,
        email: bill.firmSnapshot.contactEmail,
        gstin: bill.firmSnapshot.gstin,
        pan: bill.firmSnapshot.pan,
        bank: bill.firmSnapshot.bank,
      },
      buyer: {
        instituteName: bill.buyerSnapshot.instituteName,
        sellerBillName: bill.buyerSnapshot.sellerBillName,
        address: bill.buyerSnapshot.address,
      },
      items: bill.items.map((it: any) => ({
        srNo: it.srNo,
        productName: it.itemName,
        qty: it.qty,
        rate: it.rate,
        discount: it.discount,
        hsnSac: it.hsnSac,
        gstPercent: it.gstPercent,
        amount: it.amount,
      })),
      subTotal: bill.subTotal,
      totalDiscount: bill.totalDiscount,
      totalGst: bill.totalGst,
      grandTotal: bill.grandTotal,
    };

    const pdfBytes = await generateBillPdf(pdfData);

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${bill.invoiceNumber}.pdf"`,
      },
    });
  } catch (error: any) {
    console.error("Bill PDF re-render error:", error);
    return NextResponse.json({ error: error.message || "Failed to render PDF" }, { status: 500 });
  }
}
