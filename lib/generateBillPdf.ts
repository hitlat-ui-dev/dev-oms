// lib/generateBillPdf.ts
//
// Renders a GeM bill (Tax Invoice or Retail Invoice/Bill of Supply) to PDF
// using pdf-lib - same library already used by lib/documentMaker/pdfEngine.ts,
// so no new dependency and no headless-Chrome binary needed on Vercel
// serverless (unlike Puppeteer, which the original design draft assumed).
//
// Layout matches THE SHROOMS CO.'s real current bill (SalesBill_SM2_SHAHERA,
// 19/08/2026) exactly: firm header first, then the Debit Memo/title/Original
// bar, buyer info (with Place of Supply folded into it) + invoice-meta strip,
// item table with HSN/SAC ahead of Qty/Rate, then GSTIN/bank details + totals.

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

export interface BillPdfItem {
  srNo: number;
  productName: string;
  qty: number;
  rate: number;
  discount?: number;
  hsnSac?: string;
  gstPercent?: number;
  amount: number;
}

export interface BillPdfData {
  billType: "TAX_INVOICE" | "BILL_OF_SUPPLY";
  gstSplit: "CGST_SGST" | "IGST" | "UNKNOWN";
  invoiceNumber: string;
  invoiceDate: string; // "dd/mm/yyyy"
  placeOfSupply?: string;
  firm: {
    name: string;
    address: string;
    mobile?: string;
    email?: string;
    gstin?: string | null;
    pan?: string | null;
    bank?: { bankName?: string; accountNo?: string; ifsc?: string };
  };
  buyer: {
    instituteName: string;
    sellerBillName?: string;
    address?: string;
  };
  items: BillPdfItem[];
  subTotal: number;
  totalDiscount: number;
  totalGst: number;
  grandTotal: number;
}

// ---- Number -> Indian words (whole rupees) ----
export function numberToWords(num: number): string {
  const a = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
    "Eighteen", "Nineteen",
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function twoDigits(n: number): string {
    if (n < 20) return a[n];
    return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
  }
  function threeDigits(n: number): string {
    if (n > 99) return a[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + twoDigits(n % 100) : "");
    return twoDigits(n);
  }

  if (num === 0) return "Zero";
  let result = "";
  let n = Math.floor(num);
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = n;

  if (crore) result += threeDigits(crore) + " Crore ";
  if (lakh) result += threeDigits(lakh) + " Lakh ";
  if (thousand) result += threeDigits(thousand) + " Thousand ";
  if (hundred) result += threeDigits(hundred);

  return result.trim();
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 36;
const CW = PAGE_W - MARGIN * 2;
const BOTTOM_LIMIT = MARGIN + 90; // leave room for bottom sections when paginating item rows

function fmt2(n: number): string {
  return (n || 0).toFixed(2);
}

// Grand Total alone gets thousands separators, matching the real sample.
function fmtGrand(n: number): string {
  const [intPart, decPart] = fmt2(n).split(".");
  return `${intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${decPart}`;
}

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = (text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function generateBillPdf(billData: BillPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const isTaxInvoice = billData.billType === "TAX_INVOICE";
  const titleLabel = isTaxInvoice ? "TAX INVOICE" : "RETAIL INVOICE";
  const hasDiscount = billData.items.some((it) => (it.discount || 0) > 0);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  // Tracks each page's top-of-sheet Y so the outer border can be drawn
  // per-page at the end (a naive single rectangle breaks once the bill
  // paginates, since each PDFPage has its own coordinate space).
  const pageSpans: { page: PDFPage; topY: number }[] = [{ page, topY: y }];

  const line = (x1: number, yy: number, x2: number, color = rgb(0, 0, 0), width = 1) => {
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: width, color });
  };
  const vline = (x: number, y1: number, y2: number, width = 1) => {
    page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: width, color: rgb(0, 0, 0) });
  };
  const text = (
    str: string,
    x: number,
    yy: number,
    opts: { size?: number; f?: PDFFont; italic?: boolean; align?: "left" | "right" | "center"; maxWidth?: number } = {}
  ) => {
    const size = opts.size || 9.5;
    const f = opts.f || font;
    let drawX = x;
    if (opts.align === "right" && opts.maxWidth !== undefined) {
      drawX = x + opts.maxWidth - f.widthOfTextAtSize(str, size);
    } else if (opts.align === "center" && opts.maxWidth !== undefined) {
      drawX = x + (opts.maxWidth - f.widthOfTextAtSize(str, size)) / 2;
    }
    page.drawText(str, { x: drawX, y: yy, size, font: f, color: rgb(0, 0, 0) });
  };
  const labelValue = (
    label: string,
    value: string,
    x: number,
    yy: number,
    size = 9.5
  ) => {
    text(`${label} : `, x, yy, { size, f: bold });
    const w = bold.widthOfTextAtSize(`${label} : `, size);
    text(value, x + w, yy, { size });
  };

  const sheetLeft = MARGIN;
  const sheetRight = PAGE_W - MARGIN;

  // ---- Firm header: shaded name banner, address, contact - comes BEFORE the title bar ----
  const bannerH = 22;
  page.drawRectangle({ x: sheetLeft, y: y - bannerH, width: CW, height: bannerH, color: rgb(0.85, 0.85, 0.85) });
  text(billData.firm.name, sheetLeft, y - bannerH / 2 - 6, { size: 16, f: bold, align: "center", maxWidth: CW });
  const addrLines = wrapText(font, billData.firm.address, 9.5, CW - 20);
  let ty = y - bannerH - 14;
  for (const l of addrLines) {
    text(l, sheetLeft, ty, { size: 9.5, align: "center", maxWidth: CW });
    ty -= 12;
  }
  if (billData.firm.mobile) {
    text(`Mobile No : ${billData.firm.mobile}`, sheetLeft + 6, ty, { size: 9.5 });
  }
  if (billData.firm.email) {
    text(`Email Id : ${billData.firm.email}`, sheetLeft, ty, { size: 9.5, align: "right", maxWidth: CW - 6 });
  }
  if (billData.firm.mobile || billData.firm.email) ty -= 12;
  y = ty - 6;
  line(sheetLeft, y, sheetRight);

  // ---- Title bar: Debit Memo | RETAIL/TAX INVOICE | Original ----
  const topBarH = 18;
  text(isTaxInvoice ? "Tax Invoice" : "Debit Memo", sheetLeft + 6, y - 13, { size: 9 });
  text(titleLabel, sheetLeft, y - 13, { size: 9, f: bold, align: "center", maxWidth: CW });
  text("Original", sheetRight - 60, y - 13, { size: 9, maxWidth: 54, align: "right" });
  y -= topBarH;
  line(sheetLeft, y, sheetRight);

  // ---- Buyer info (incl. Place of Supply) + invoice-meta grid ----
  const colSplit = sheetLeft + CW * 0.58;
  const leftPad = sheetLeft + 8;
  const rightPad = colSplit + 8;
  const leftColW = colSplit - sheetLeft - 16;

  const buyerDisplayName = billData.buyer.sellerBillName || billData.buyer.instituteName;
  const msLine = `M/s. : ${buyerDisplayName}`;
  const msLines = wrapText(bold, msLine, 10, leftColW);
  const buyerAddrLines = wrapText(font, billData.buyer.address || "", 9.5, leftColW);
  const placeOfSupplyLine = `Place of Supply : ${billData.placeOfSupply || ""}`;

  const rightLines = [
    `Invoice No. : ${billData.invoiceNumber}`,
    `Date : ${billData.invoiceDate}`,
  ];

  const leftLineCount = msLines.length + buyerAddrLines.length + 1; // +1 for Place of Supply
  const infoGridLines = Math.max(leftLineCount, rightLines.length);
  const infoGridH = infoGridLines * 13 + 16;
  const infoTop = y;

  let ly = infoTop - 14;
  for (const l of msLines) {
    text(l, leftPad, ly, { size: 10, f: bold });
    ly -= 13;
  }
  for (const l of buyerAddrLines) {
    text(l, leftPad, ly, { size: 9.5 });
    ly -= 13;
  }
  labelValue("Place of Supply", billData.placeOfSupply || "", leftPad, ly, 9.5);
  ly -= 13;

  let ry = infoTop - 14;
  for (const l of rightLines) {
    const [label, ...rest] = l.split(" : ");
    labelValue(label, rest.join(" : "), rightPad, ry, 9.5);
    ry -= 13;
  }

  y = infoTop - infoGridH;
  line(sheetLeft, y, sheetRight);
  vline(colSplit, infoTop, y);

  // ---- Items table (HSN/SAC ahead of Qty/Rate, matching the real sample) ----
  type Col = { key: string; label: string; w: number; align: "left" | "right" | "center" };
  const cols: Col[] = [
    { key: "sr", label: "SrNo", w: 32, align: "left" },
    { key: "name", label: "Product Name", w: 0, align: "left" }, // flexible, filled below
    { key: "hsn", label: "HSN/SAC", w: 60, align: "center" },
    { key: "qty", label: "Qty", w: 55, align: "right" },
    { key: "rate", label: "Rate", w: 55, align: "right" },
  ];
  if (hasDiscount) cols.push({ key: "discount", label: "Discount", w: 60, align: "right" });
  cols.push({ key: "gst", label: "GST %", w: 45, align: "center" });
  cols.push({ key: "amount", label: "Amount", w: 70, align: "right" });

  const fixedW = cols.reduce((s, c) => s + c.w, 0);
  cols.find((c) => c.key === "name")!.w = CW - fixedW;

  const colX: number[] = [];
  let cursorX = sheetLeft;
  for (const c of cols) {
    colX.push(cursorX);
    cursorX += c.w;
  }
  // HSN/SAC is essentially never filled in for this seller's items, so its
  // left divider is dropped - it reads as part of the Product Name cell
  // instead of a separately boxed (and always-empty) column.
  const hsnColIndex = cols.findIndex((c) => c.key === "hsn");

  const drawTableHeader = () => {
    const headerH = 18;
    page.drawRectangle({ x: sheetLeft, y: y - headerH, width: CW, height: headerH, color: rgb(0.94, 0.94, 0.94) });
    cols.forEach((c, i) => {
      text(c.label, colX[i] + 4, y - 13, { size: 9, f: bold });
    });
    y -= headerH;
    line(sheetLeft, y, sheetRight);
    cols.forEach((_, i) => {
      if (i > 0 && i !== hsnColIndex) vline(colX[i], y + headerH, y);
    });
  };

  line(sheetLeft, y, sheetRight);
  drawTableHeader();

  for (const it of billData.items) {
    const nameLines = wrapText(font, it.productName, 9, cols.find((c) => c.key === "name")!.w - 8);
    const rowH = Math.max(16, nameLines.length * 11 + 6);

    if (y - rowH < BOTTOM_LIMIT) {
      line(sheetLeft, y, sheetRight);
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      pageSpans.push({ page, topY: y });
      line(sheetLeft, y, sheetRight);
      drawTableHeader();
    }

    const rowTop = y;
    const values: Record<string, string> = {
      sr: String(it.srNo),
      qty: it.qty.toFixed(3),
      rate: fmt2(it.rate),
      discount: fmt2(it.discount || 0),
      hsn: it.hsnSac || "",
      gst: it.gstPercent ? `${it.gstPercent}%` : "",
      amount: fmt2(it.amount),
    };

    cols.forEach((c, i) => {
      if (c.key === "name") {
        let nty = rowTop - 11;
        for (const nl of nameLines) {
          text(nl, colX[i] + 4, nty, { size: 9 });
          nty -= 11;
        }
        return;
      }
      const val = values[c.key] ?? "";
      text(val, colX[i] + 4, rowTop - 11, {
        size: 9,
        align: c.align === "left" ? undefined : c.align,
        maxWidth: c.align !== "left" ? c.w - 8 : undefined,
      });
    });

    y -= rowH;
    line(sheetLeft, y, sheetRight);
    cols.forEach((_, i) => {
      if (i > 0 && i !== hsnColIndex) vline(colX[i], rowTop, y);
    });
  }

  // ---- Terms (defined early so its height feeds the bottom-pinning math below) ----
  const terms = [
    "Terms & Condition :",
    "1. Goods once sold will not be taken back.",
    "2. Interest @18% p.a. will be charged if payment is not made within due date.",
    "3. Our risk and responsibility ceases as soon as the goods leave our premises.",
    "4. \"Subject to Jurisdiction only. E.&.O.E\"",
  ];
  const TERMS_H = 12 + terms.length * 11 + 4;
  const FOOT_H = 20;

  // ---- Bottom grid: GSTIN + bank + GST breakdown + amount-in-words + note
  // (left column) / Sub Total (top-right) + Grand Total (bottom-right, the
  // table's own last row) - matches the real Miracle sample, where Total GST
  // sits with the bank details on the left and the right column holds only
  // Sub Total and Grand Total.
  const bColSplit = sheetLeft + CW * 0.62;
  const bank = billData.firm.bank || {};

  // Split into distinct row groups - each group boundary gets its own full-
  // width divider line (GSTIN/PAN/Bank | GST | Bill Amount | Note), matching
  // the grid-like row separation the user pointed out was missing.
  const identityRows: { label: string; value: string }[] = [
    { label: "GSTIN No.", value: billData.firm.gstin || "" },
  ];
  if (billData.firm.pan) {
    identityRows.push({ label: "PAN", value: billData.firm.pan });
  }
  identityRows.push(
    { label: "Bank Name", value: bank.bankName || "" },
    { label: "Bank A/c. No.", value: bank.accountNo || "" },
    { label: "RTGS/IFSC Code", value: bank.ifsc || "" },
  );

  const gstRows: { label: string; value: string }[] = [];
  if (billData.totalDiscount > 0) {
    gstRows.push({ label: "Discount", value: fmt2(billData.totalDiscount) });
  }
  if (isTaxInvoice) {
    if (billData.gstSplit === "IGST") {
      gstRows.push({ label: "IGST", value: fmt2(billData.totalGst) });
    } else {
      gstRows.push({ label: "CGST", value: fmt2(billData.totalGst / 2) });
      gstRows.push({ label: "SGST", value: fmt2(billData.totalGst / 2) });
    }
  } else {
    gstRows.push({ label: "Total GST", value: "" });
  }

  // Asymmetric gap around each separator line: only a little clearance is
  // needed above it (a text baseline's descender is short), but well over
  // 5px is needed below it or the next row's ascenders visually cross the
  // line, reading as a strikethrough through that text.
  const GAP_BEFORE_LINE = 4;
  const GAP_AFTER_LINE = 12;
  const SECTION_GAP = GAP_BEFORE_LINE + GAP_AFTER_LINE;
  const bottomLeftLineCount = identityRows.length + gstRows.length + 1 /* amount words */ + 1 /* note */;
  const bottomGridH = bottomLeftLineCount * 14 + SECTION_GAP * 3 + 16;

  // Pin the whole stack (grid + terms + footer) to the page bottom. When the
  // item table leaves the sheet mostly empty, that blank space stays ABOVE
  // this stack - room to add more item rows later - instead of the summary
  // sitting right under a single short row.
  const itemsEndY = y;
  const stackH = bottomGridH + TERMS_H + FOOT_H;
  let addedNewPage = false;
  if (y - stackH < MARGIN) {
    addedNewPage = true;
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
    pageSpans.push({ page, topY: y });
  } else {
    const pinnedTop = MARGIN + stackH;
    if (y > pinnedTop) y = pinnedTop;
  }
  if (!addedNewPage && y < itemsEndY) {
    // Extend the item table's column dividers through the blank gap so it
    // reads as ruled space ready for more rows, not a truncated table.
    cols.forEach((_, i) => {
      if (i > 0 && i !== hsnColIndex) vline(colX[i], itemsEndY, y);
    });
  }
  line(sheetLeft, y, sheetRight);
  const bottomTop = y;

  let bly = bottomTop - 14;
  for (const r of identityRows) {
    labelValue(r.label, r.value, sheetLeft + 8, bly, 9.5);
    bly -= 14;
  }
  bly -= GAP_BEFORE_LINE;
  line(sheetLeft, bly, sheetRight);
  bly -= GAP_AFTER_LINE;
  for (const r of gstRows) {
    labelValue(r.label, r.value, sheetLeft + 8, bly, 9.5);
    bly -= 14;
  }
  bly -= GAP_BEFORE_LINE;
  line(sheetLeft, bly, sheetRight);
  bly -= GAP_AFTER_LINE;
  text(`Bill Amount : ${numberToWords(billData.grandTotal)} Only`, sheetLeft + 8, bly, { size: 9.5, f: bold });
  bly -= 14;
  bly -= GAP_BEFORE_LINE;
  line(sheetLeft, bly, sheetRight);
  bly -= GAP_AFTER_LINE;
  labelValue("Note", "", sheetLeft + 8, bly, 9.5);
  const noteY = bly;

  const totalsColW = sheetRight - bColSplit - 16;
  text("Sub Total", bColSplit + 8, bottomTop - 14, { size: 9.5 });
  text(fmt2(billData.subTotal), bColSplit + 8, bottomTop - 14, { size: 9.5, align: "right", maxWidth: totalsColW });
  text("Grand Total", bColSplit + 8, noteY, { size: 11, f: bold });
  text(fmtGrand(billData.grandTotal), bColSplit + 8, noteY, { size: 11, f: bold, align: "right", maxWidth: totalsColW });

  y = bottomTop - bottomGridH;
  line(sheetLeft, y, sheetRight);
  vline(bColSplit, bottomTop, y);

  // ---- Terms ----
  let tty = y - 12;
  for (const l of terms) {
    text(l, sheetLeft + 8, tty, { size: 8.5 });
    tty -= 11;
  }
  y = tty - 4;
  line(sheetLeft, y, sheetRight);

  // ---- Footer note ----
  text('"This Is A Computer Generated Invoice Signature Not Required."', sheetLeft, y - 14, {
    size: 8.5,
    f: italic,
    align: "center",
    maxWidth: CW,
  });
  y -= FOOT_H;
  line(sheetLeft, y, sheetRight, rgb(0, 0, 0), 1.3);

  // Outer left/right/top borders, drawn per-page: each page in pageSpans
  // covers from its own topY down to MARGIN, except the last page which
  // stops at the final content Y.
  pageSpans.forEach((span, i) => {
    const bottomY = i === pageSpans.length - 1 ? y : MARGIN;
    span.page.drawLine({ start: { x: sheetLeft, y: span.topY }, end: { x: sheetLeft, y: bottomY }, thickness: 1.3, color: rgb(0, 0, 0) });
    span.page.drawLine({ start: { x: sheetRight, y: span.topY }, end: { x: sheetRight, y: bottomY }, thickness: 1.3, color: rgb(0, 0, 0) });
    span.page.drawLine({ start: { x: sheetLeft, y: span.topY }, end: { x: sheetRight, y: span.topY }, thickness: 1.3, color: rgb(0, 0, 0) });
  });

  return doc.save();
}
