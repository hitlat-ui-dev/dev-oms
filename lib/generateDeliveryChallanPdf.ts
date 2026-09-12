// lib/generateDeliveryChallanPdf.ts
//
// Renders a standalone Delivery Challan to PDF with pdf-lib - the same engine
// as lib/generateBillPdf.ts and lib/documentMaker/pdfEngine.ts. Deliberately
// NOT Puppeteer: this runs on Vercel serverless, where there is no headless
// Chrome binary to drive (the same reason the Billing module moved off its
// original Puppeteer design draft).
//
// Layout mirrors the on-screen challan: firm header, DELIVERY CHALLAN title
// bar, optional consignee block beside the DC No./Date strip, then a
// Sr/Item/Qty/Unit table closed by a Total Qty row. A DC is a non-commercial
// dispatch document, so no rate, amount, tax or total value appears anywhere.

import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";

export interface DcPdfItem {
  srNo: number;
  itemName: string;
  qty: number;
  unit?: string;
}

export interface DcPdfData {
  dcNumberFormatted: string; // "01/26-27"
  date: string; // "dd/mm/yyyy"
  firm: {
    name: string;
    address: string;
    mobile?: string;
    email?: string;
    gstin?: string | null;
    pan?: string | null;
  };
  // Every field optional - a challan may go out with no consignee filled in
  // at all, in which case the whole block is skipped rather than printed empty.
  consignee?: {
    instituteName?: string;
    buyerName?: string;
    address?: string;
    place?: string;
    mobile?: string;
  };
  items: DcPdfItem[];
  totalQty: number;
  remarks?: string;
  // Stamps a DRAFT watermark across every page. Set for a not-yet-finalized
  // challan, so a printed draft can never be mistaken for an issued document.
  isDraft?: boolean;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 36;
const CW = PAGE_W - MARGIN * 2;
const BOTTOM_LIMIT = MARGIN + 170; // room for the total/terms/signature stack when paginating rows

/** Trims trailing zeros so a whole qty prints as "5", not "5.000", while a
 * fractional one still shows its decimals ("2.5"). */
function fmtQty(n: number): string {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)));
}

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of (text || "").split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
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
  }
  return lines.length ? lines : [""];
}

export async function generateDeliveryChallanPdf(dc: DcPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  // Each page's top-of-sheet Y, so the outer border can be drawn per-page at
  // the end - one rectangle cannot span pages, since every PDFPage has its own
  // coordinate space.
  const pageSpans: { page: PDFPage; topY: number }[] = [{ page, topY: y }];

  const line = (x1: number, yy: number, x2: number, width = 1) => {
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: width, color: rgb(0, 0, 0) });
  };
  const vline = (x: number, y1: number, y2: number, width = 1) => {
    page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: width, color: rgb(0, 0, 0) });
  };
  const text = (
    str: string,
    x: number,
    yy: number,
    opts: { size?: number; f?: PDFFont; align?: "right" | "center"; maxWidth?: number } = {}
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
  const labelValue = (label: string, value: string, x: number, yy: number, size = 9.5) => {
    text(`${label} : `, x, yy, { size, f: bold });
    text(value, x + bold.widthOfTextAtSize(`${label} : `, size), yy, { size });
  };

  const sheetLeft = MARGIN;
  const sheetRight = PAGE_W - MARGIN;

  // ---- Firm header: shaded name banner, address, contact ----
  const bannerH = 22;
  page.drawRectangle({ x: sheetLeft, y: y - bannerH, width: CW, height: bannerH, color: rgb(0.85, 0.85, 0.85) });
  text(dc.firm.name, sheetLeft, y - bannerH / 2 - 6, { size: 16, f: bold, align: "center", maxWidth: CW });

  let ty = y - bannerH - 14;
  for (const l of wrapText(font, dc.firm.address, 9.5, CW - 20)) {
    text(l, sheetLeft, ty, { size: 9.5, align: "center", maxWidth: CW });
    ty -= 12;
  }
  ty -= 6;
  if (dc.firm.mobile) text(`Mobile No : ${dc.firm.mobile}`, sheetLeft + 6, ty, { size: 9.5 });
  if (dc.firm.email) text(`Email Id : ${dc.firm.email}`, sheetLeft, ty, { size: 9.5, align: "right", maxWidth: CW - 6 });
  if (dc.firm.mobile || dc.firm.email) ty -= 12;
  // GSTIN/PAN goes in the header here rather than in a bottom block: a challan
  // has no bank-details/totals section for it to sit beside.
  const taxId = dc.firm.gstin ? `GSTIN No : ${dc.firm.gstin}` : dc.firm.pan ? `PAN : ${dc.firm.pan}` : "";
  if (taxId) {
    text(taxId, sheetLeft + 6, ty, { size: 9.5 });
    ty -= 12;
  }
  y = ty - 6;
  line(sheetLeft, y, sheetRight);

  // ---- Title bar ----
  const topBarH = 20;
  text("DELIVERY CHALLAN", sheetLeft, y - 14, { size: 12, f: bold, align: "center", maxWidth: CW });
  if (dc.isDraft) text("DRAFT", sheetRight - 66, y - 14, { size: 9, f: bold, align: "right", maxWidth: 60 });
  y -= topBarH;
  line(sheetLeft, y, sheetRight);

  // ---- Consignee block (left, optional) + DC No./Date strip (right) ----
  const colSplit = sheetLeft + CW * 0.58;
  const leftPad = sheetLeft + 8;
  const rightPad = colSplit + 8;
  const leftColW = colSplit - sheetLeft - 16;

  const consignee = dc.consignee || {};
  const consigneeName = (consignee.buyerName || consignee.instituteName || "").trim();
  const hasConsignee = Boolean(consigneeName || consignee.address || consignee.place || consignee.mobile);

  const leftLines: { str: string; f: PDFFont; size: number }[] = [];
  if (hasConsignee) {
    leftLines.push({ str: "To,", f: font, size: 9.5 });
    for (const l of wrapText(bold, consigneeName, 10.5, leftColW)) {
      if (consigneeName) leftLines.push({ str: l, f: bold, size: 10.5 });
    }
    // Institute gets its own line only when a contact person's name is
    // already occupying the bold name line above it.
    if (consignee.buyerName && consignee.instituteName) {
      for (const l of wrapText(font, consignee.instituteName, 9.5, leftColW)) {
        leftLines.push({ str: l, f: font, size: 9.5 });
      }
    }
    if (consignee.address) {
      for (const l of wrapText(font, consignee.address, 9.5, leftColW)) {
        leftLines.push({ str: l, f: font, size: 9.5 });
      }
    }
    if (consignee.place) leftLines.push({ str: `Place : ${consignee.place}`, f: font, size: 9.5 });
    if (consignee.mobile) leftLines.push({ str: `Mobile : ${consignee.mobile}`, f: font, size: 9.5 });
  }

  const rightRows: [string, string][] = [
    ["DC No.", dc.dcNumberFormatted || "-"],
    ["Date", dc.date],
  ];

  const infoGridH = Math.max(leftLines.length, rightRows.length) * 13 + 16;
  const infoTop = y;

  let ly = infoTop - 14;
  for (const l of leftLines) {
    text(l.str, leftPad, ly, { size: l.size, f: l.f });
    ly -= 13;
  }
  let ry = infoTop - 14;
  for (const [label, value] of rightRows) {
    labelValue(label, value, rightPad, ry, 9.5);
    ry -= 13;
  }

  y = infoTop - infoGridH;
  line(sheetLeft, y, sheetRight);
  vline(colSplit, infoTop, y);

  // ---- Items table ----
  type Col = { key: string; label: string; w: number; align?: "right" | "center" };
  const cols: Col[] = [
    { key: "sr", label: "Sr. No.", w: 48, align: "center" },
    { key: "name", label: "Item Name", w: 0 }, // flexible, filled below
    { key: "qty", label: "Qty", w: 80, align: "right" },
    { key: "unit", label: "Unit", w: 80, align: "center" },
  ];
  const nameCol = cols.find((col) => col.key === "name")!;
  nameCol.w = CW - cols.reduce((sum, col) => sum + col.w, 0);

  const colX: number[] = [];
  let cursorX = sheetLeft;
  for (const col of cols) {
    colX.push(cursorX);
    cursorX += col.w;
  }
  const qtyIdx = cols.findIndex((col) => col.key === "qty");

  const drawTableHeader = () => {
    const headerH = 18;
    page.drawRectangle({ x: sheetLeft, y: y - headerH, width: CW, height: headerH, color: rgb(0.94, 0.94, 0.94) });
    cols.forEach((col, i) => {
      text(col.label, colX[i] + 4, y - 13, {
        size: 9,
        f: bold,
        align: col.align,
        maxWidth: col.align ? col.w - 8 : undefined,
      });
    });
    y -= headerH;
    line(sheetLeft, y, sheetRight);
    cols.forEach((_, i) => {
      if (i > 0) vline(colX[i], y + headerH, y);
    });
  };

  line(sheetLeft, y, sheetRight);
  drawTableHeader();

  for (let i = 0; i < dc.items.length; i++) {
    const it = dc.items[i];
    const isLast = i === dc.items.length - 1;
    const nameLines = wrapText(font, it.itemName, 9, nameCol.w - 8);
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
      qty: fmtQty(it.qty),
      unit: it.unit || "",
    };

    cols.forEach((col, ci) => {
      if (col.key === "name") {
        let nty = rowTop - 11;
        for (const nl of nameLines) {
          text(nl, colX[ci] + 4, nty, { size: 9 });
          nty -= 11;
        }
        return;
      }
      text(values[col.key] ?? "", colX[ci] + 4, rowTop - 11, {
        size: 9,
        align: col.align,
        maxWidth: col.align ? col.w - 8 : undefined,
      });
    });

    y -= rowH;
    // The last row's closing line is skipped: it flows straight into the ruled
    // blank space below (see the divider extension further down), so a line
    // there would read as a stray bar floating above that gap.
    if (!isLast) line(sheetLeft, y, sheetRight);
    cols.forEach((_, ci) => {
      if (ci > 0) vline(colX[ci], rowTop, y);
    });
  }

  // ---- Bottom stack: Total Qty row, remarks, terms, signatures ----
  const terms = [
    "Terms & Condition :",
    "1. The goods must be checked within 2 days of receipt. Any defect or complaint must be reported within this period.",
    "2. Damage or defects must be reported immediately.",
    "3. Communication for replacement must be immediate.",
    "4. This challan is not a bill - no amount is payable against it.",
  ];
  const remarkLines = dc.remarks && dc.remarks.trim() ? wrapText(font, `Remarks : ${dc.remarks.trim()}`, 9, CW - 16) : [];

  const TOTAL_ROW_H = 20;
  const REMARKS_H = remarkLines.length ? remarkLines.length * 11 + 12 : 0;
  const TERMS_H = 12 + terms.length * 11 + 4;
  const SIGN_H = 58;
  const FOOT_H = 18;
  const stackH = TOTAL_ROW_H + REMARKS_H + TERMS_H + SIGN_H + FOOT_H;

  // Pin the stack to the page bottom, so that when the item table leaves the
  // sheet mostly empty the blank space stays ABOVE it - ruled room to add more
  // rows by hand - instead of the totals riding up under a single short row.
  const itemsEndY = y;
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
    cols.forEach((_, ci) => {
      if (ci > 0) vline(colX[ci], itemsEndY, y);
    });
  }
  line(sheetLeft, y, sheetRight);

  // ---- Total Qty: the challan's only footer figure, sat in the Qty column so
  // it lines up under the values it adds up ----
  const totalTop = y;
  const totalLabelRight = colX[qtyIdx] - 8;
  text("Total Qty", totalLabelRight, totalTop - 14, { size: 9.5, f: bold, align: "right", maxWidth: 0 });
  text(fmtQty(dc.totalQty), colX[qtyIdx] + 4, totalTop - 14, {
    size: 9.5,
    f: bold,
    align: "right",
    maxWidth: cols[qtyIdx].w - 8,
  });
  text(`${dc.items.length} item${dc.items.length === 1 ? "" : "s"}`, sheetLeft + 8, totalTop - 14, { size: 9 });
  y -= TOTAL_ROW_H;
  line(sheetLeft, y, sheetRight);
  vline(colX[qtyIdx], totalTop, y);
  vline(colX[qtyIdx] + cols[qtyIdx].w, totalTop, y);

  // ---- Remarks ----
  if (remarkLines.length) {
    let rly = y - 12;
    for (const l of remarkLines) {
      text(l, sheetLeft + 8, rly, { size: 9 });
      rly -= 11;
    }
    y -= REMARKS_H;
    line(sheetLeft, y, sheetRight);
  }

  // ---- Terms ----
  let tty = y - 12;
  for (const l of terms) {
    text(l, sheetLeft + 8, tty, { size: 8.5 });
    tty -= 11;
  }
  y = tty - 4;
  line(sheetLeft, y, sheetRight);

  // ---- Signatures: receiver (left) / firm (right) ----
  const signTop = y;
  const halfW = CW / 2;
  text("Received the above goods in good condition.", sheetLeft + 8, signTop - 14, { size: 8.5, f: italic });
  line(sheetLeft + 12, signTop - 40, sheetLeft + halfW - 20);
  text("Receiver's Signature", sheetLeft + 12, signTop - 50, { size: 8.5, f: bold });

  text(`For ${dc.firm.name}`, sheetLeft + halfW, signTop - 14, { size: 8.5, f: bold, align: "center", maxWidth: halfW - 8 });
  line(sheetLeft + halfW + 20, signTop - 40, sheetRight - 12);
  text("Authorised Signatory", sheetLeft + halfW, signTop - 50, { size: 8.5, f: bold, align: "center", maxWidth: halfW - 8 });

  y = signTop - SIGN_H;
  line(sheetLeft, y, sheetRight);
  vline(sheetLeft + halfW, signTop, y);

  // ---- Footer note ----
  text("This is a computer generated Delivery Challan. Not a tax invoice - no amount is payable against it.", sheetLeft, y - 13, {
    size: 8,
    f: italic,
    align: "center",
    maxWidth: CW,
  });
  y -= FOOT_H;
  line(sheetLeft, y, sheetRight, 1.3);

  // ---- Outer border, per page ----
  pageSpans.forEach((span, i) => {
    const bottomY = i === pageSpans.length - 1 ? y : MARGIN;
    span.page.drawLine({ start: { x: sheetLeft, y: span.topY }, end: { x: sheetLeft, y: bottomY }, thickness: 1.3, color: rgb(0, 0, 0) });
    span.page.drawLine({ start: { x: sheetRight, y: span.topY }, end: { x: sheetRight, y: bottomY }, thickness: 1.3, color: rgb(0, 0, 0) });
    span.page.drawLine({ start: { x: sheetLeft, y: span.topY }, end: { x: sheetRight, y: span.topY }, thickness: 1.3, color: rgb(0, 0, 0) });
  });

  // ---- DRAFT watermark, drawn last so it sits over the content ----
  if (dc.isDraft) {
    for (const span of pageSpans) {
      span.page.drawText("DRAFT", {
        x: 130,
        y: PAGE_H / 2 - 80,
        size: 96,
        font: bold,
        color: rgb(0.75, 0.75, 0.75),
        rotate: degrees(30),
        opacity: 0.45,
      });
    }
  }

  return doc.save();
}
