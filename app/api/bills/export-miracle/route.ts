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

// Invoice numbers are "<prefix><number>" (e.g. "SM14") - mirrors the same
// helper used client-side (app/dashboard/account/bills/page.tsx) to filter
// the Bill History table, so a range typed there and one typed here behave
// identically regardless of whether the prefix was included.
function extractNumericSuffix(s: string): number | null {
  const m = /(\d+)\s*$/.exec(String(s || ""));
  return m ? parseInt(m[1], 10) : null;
}

// GET /api/bills/export-miracle?date=YYYY-MM-DD
// GET /api/bills/export-miracle?invoiceFrom=SM14&invoiceTo=SM20&firmCode=...
// date and invoiceFrom/invoiceTo are independently optional and AND together
// when both given - at least one is required. The invoice-number range is
// scoped to firmCode (when provided) since numbering is per-firm and two
// firms' invoices can land on the same numeric suffix.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");
    const invoiceFrom = searchParams.get("invoiceFrom");
    const invoiceTo = searchParams.get("invoiceTo");
    const firmCode = searchParams.get("firmCode");

    if (!date && !invoiceFrom && !invoiceTo) {
      return NextResponse.json({ error: "Provide a date or an Invoice No. range (invoiceFrom/invoiceTo) to export." }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();

    const query: { invoiceDate?: { $gte: Date; $lte: Date }; firmCode?: string } = {};
    if (date) query.invoiceDate = { $gte: new Date(`${date}T00:00:00`), $lte: new Date(`${date}T23:59:59`) };
    if ((invoiceFrom || invoiceTo) && firmCode) query.firmCode = firmCode;

    let bills = await db
      .collection("bills")
      .find(query)
      .sort({ firmCode: 1, invoiceNumber: 1 })
      .toArray();

    let rangeDescription = "";
    if (invoiceFrom || invoiceTo) {
      const fromNum = invoiceFrom ? extractNumericSuffix(invoiceFrom) : null;
      const toNum = invoiceTo ? extractNumericSuffix(invoiceTo) : null;
      bills = bills.filter((b) => {
        const n = extractNumericSuffix(b.invoiceNumber);
        if (n === null) return false;
        if (fromNum !== null && n < fromNum) return false;
        if (toNum !== null && n > toNum) return false;
        return true;
      });
      rangeDescription = ` from ${invoiceFrom || "the start"} to ${invoiceTo || "the end"}`;
    }

    if (bills.length === 0) {
      const dateDescription = date ? ` on ${date}` : "";
      return NextResponse.json({ error: `No bills found${dateDescription}${rangeDescription}` }, { status: 404 });
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

    const filenameTag = invoiceFrom || invoiceTo
      ? `${invoiceFrom || "start"}-${invoiceTo || "end"}`
      : date;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Sales_Profile_${filenameTag}.xlsx"`,
      },
    });
  } catch (error: any) {
    console.error("Miracle export error:", error);
    return NextResponse.json({ error: error.message || "Failed to export" }, { status: 500 });
  }
}
