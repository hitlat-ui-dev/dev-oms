import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import XLSX from "xlsx-js-style";

// Column order/headers confirmed directly by Miracle Accounting's own team
// (their "Sales Profile" sample export, Sheet2 = sales/Sundry Debtors side) -
// this is the real "Import from Excel" template, not a guess.
const COLUMN_MAP = {
  billDate: "Bill Date",
  billNo: "BillNo",
  partyName: "Party Name",
  partyGstNo: "Party GSTNo",
  stateName: "StateName",
  itemName: "ItemName",
  qty: "QTY",
  rate: "Rate",
  uom: "UOM",
  gstPercent: "GSTPercentage",
  taxableAmount: "TaxableAmount",
  sgstAmount: "SGSTAmount",
  cgstAmount: "CGSTAmount",
  igstAmount: "IGSTAmount",
  invoiceType: "InvoiceType",
  groupName: "GroupName",
};

// Miracle's sample dates are "M/D/YY" with no leading zeros (e.g. "4/1/26"
// for 1 April 2026) - matching that exactly rather than the DD/MM/YYYY used
// on the printed invoice PDF.
function formatMiracleDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
}

// GET /api/bills/export-miracle?date=YYYY-MM-DD
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");
    if (!date) {
      return NextResponse.json({ error: "date query param (YYYY-MM-DD) is required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();
    const bills = await db
      .collection("bills")
      .find({ invoiceDate: { $gte: new Date(`${date}T00:00:00`), $lte: new Date(`${date}T23:59:59`) } })
      .sort({ firmCode: 1, invoiceNumber: 1 })
      .toArray();

    if (bills.length === 0) {
      return NextResponse.json({ error: `No bills generated on ${date}` }, { status: 404 });
    }

    const rows: Record<string, any>[] = [];
    for (const bill of bills) {
      const billDate = formatMiracleDate(new Date(bill.invoiceDate));
      const partyName = bill.buyerSnapshot.sellerBillName || bill.buyerSnapshot.instituteName;
      const stateName = bill.buyerSnapshot.state || bill.placeOfSupply || "";

      for (const it of bill.items) {
        const gstAmount = Number(it.gstAmount || 0);
        const isIgst = bill.gstSplit === "IGST";

        rows.push({
          [COLUMN_MAP.billDate]: billDate,
          [COLUMN_MAP.billNo]: bill.invoiceNumber,
          [COLUMN_MAP.partyName]: partyName,
          [COLUMN_MAP.partyGstNo]: "", // buyer GSTIN isn't captured anywhere in OMS - institutes are typically unregistered
          [COLUMN_MAP.stateName]: stateName,
          [COLUMN_MAP.itemName]: it.itemName,
          [COLUMN_MAP.qty]: it.qty,
          [COLUMN_MAP.rate]: it.rate,
          [COLUMN_MAP.uom]: it.unit || "",
          [COLUMN_MAP.gstPercent]: it.gstPercent || 0,
          [COLUMN_MAP.taxableAmount]: it.taxableAmount,
          [COLUMN_MAP.sgstAmount]: isIgst ? 0 : Number((gstAmount / 2).toFixed(2)),
          [COLUMN_MAP.cgstAmount]: isIgst ? 0 : Number((gstAmount / 2).toFixed(2)),
          [COLUMN_MAP.igstAmount]: isIgst ? Number(gstAmount.toFixed(2)) : 0,
          [COLUMN_MAP.invoiceType]: "GST",
          [COLUMN_MAP.groupName]: "Sundry Debtors",
        });
      }
    }

    const worksheet = XLSX.utils.json_to_sheet(rows, { header: Object.values(COLUMN_MAP) });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sales Profile");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Sales_Profile_${date}.xlsx"`,
      },
    });
  } catch (error: any) {
    console.error("Miracle export error:", error);
    return NextResponse.json({ error: error.message || "Failed to export" }, { status: 500 });
  }
}
