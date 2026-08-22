import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import JSZip from "jszip";
import { generateBillPdf, BillPdfData } from "@/lib/generateBillPdf";
import { getFileFromR2Bills } from "@/lib/r2Bills";

function formatDateDDMMYYYY(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

// Zip folder/file names can't contain these - swapped for "-" so a firm/
// institute name with a slash or colon in it doesn't break the archive.
function sanitizeForPath(s: string): string {
  return String(s || "").replace(/[\\/:*?"<>|]/g, "-").trim() || "UNKNOWN";
}

async function getOmsBillPdfBytes(bill: any): Promise<Buffer> {
  if (bill.r2Key) {
    try {
      return await getFileFromR2Bills(bill.r2Key);
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

  return Buffer.from(await generateBillPdf(pdfData));
}

// GET /api/bills/export-zip?firmCode=&instituteName=&from=&to=
// Bulk-downloads both the OMS-generated invoice PDF and GeM's own e-signed
// invoice (when uploaded) for every bill matching the filters, as one ZIP -
// one folder per bill named "<firm name>-<contract no>".
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const firmCode = (searchParams.get("firmCode") || "").trim().toUpperCase();
    const instituteName = (searchParams.get("instituteName") || "").trim();
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const query: any = {};
    if (firmCode) query.firmCode = firmCode;
    if (instituteName) {
      query["buyerSnapshot.instituteName"] = { $regex: instituteName, $options: "i" };
    }
    if (from || to) {
      query.invoiceDate = {};
      if (from) query.invoiceDate.$gte = new Date(`${from}T00:00:00`);
      if (to) query.invoiceDate.$lte = new Date(`${to}T23:59:59`);
    }

    const client = await clientPromise;
    const db = client.db();
    const bills = await db.collection("bills").find(query).sort({ invoiceDate: -1 }).toArray();

    if (bills.length === 0) {
      return NextResponse.json({ error: "No bills match those filters." }, { status: 404 });
    }

    const zip = new JSZip();
    // Two bills can land on the same firm+contract folder name (e.g. a
    // corrected re-bill) - de-dupe by suffixing so neither file gets
    // silently overwritten inside the zip.
    const usedFolderNames = new Set<string>();

    for (const bill of bills) {
      let folderName = sanitizeForPath(`${bill.firmSnapshot?.name || bill.firmCode}-${bill.contractNo || bill.invoiceNumber}`);
      if (usedFolderNames.has(folderName)) {
        folderName = `${folderName}-${bill.invoiceNumber}`;
      }
      usedFolderNames.add(folderName);

      const folder = zip.folder(folderName);
      if (!folder) continue;

      try {
        const omsPdfBytes = await getOmsBillPdfBytes(bill);
        folder.file(`${sanitizeForPath(bill.invoiceNumber)}-OMS.pdf`, omsPdfBytes);
      } catch (err: any) {
        folder.file("OMS-bill-ERROR.txt", `OMS bill fetch/render fail hua: ${err.message}`);
      }

      if (bill.gemDocumentR2Key) {
        try {
          const gemBytes = await getFileFromR2Bills(bill.gemDocumentR2Key);
          folder.file(`${sanitizeForPath(bill.invoiceNumber)}-GeM.pdf`, gemBytes);
        } catch (err: any) {
          folder.file("GeM-bill-ERROR.txt", `GeM document fetch fail hua: ${err.message}`);
        }
      } else {
        folder.file("GeM-bill-NOT-AVAILABLE.txt", "GeM ka e-signed document abhi is bill ke liye upload nahi hua hai.");
      }
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const stamp = new Date().toISOString().slice(0, 10);

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="Bills_Export_${stamp}.zip"`,
      },
    });
  } catch (error: any) {
    console.error("Bills export-zip error:", error);
    return NextResponse.json({ error: error.message || "Export failed" }, { status: 500 });
  }
}
