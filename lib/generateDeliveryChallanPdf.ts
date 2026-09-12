// lib/generateDeliveryChallanPdf.ts
//
// Renders a Delivery Challan to PDF with pdf-lib - the same engine as
// lib/generateBillPdf.ts and lib/documentMaker/pdfEngine.ts. Deliberately NOT
// Puppeteer: this runs on Vercel serverless, where there is no headless Chrome
// binary to drive (the same reason the Billing module moved off its original
// Puppeteer design draft).
//
// LAYOUT: one A4 portrait sheet carries TWO A5 copies of the same challan,
// stacked - ORIGINAL COPY on the top half, DUPLICATE COPY on the bottom, with
// a dashed cut line between them. Both halves are identical apart from the
// label, so the sheet is printed once and torn in two.
//
// Because both copies must show the same rows, items are paginated ONCE up
// front (measureLayout -> chunkItems) and each chunk is then drawn twice onto
// its own A4 sheet. Drawing first and paginating as you go - the approach the
// single-copy bill renderer uses - can't work here: the bottom copy would run
// out of room at a different row than the top one.
//
// The firm block is optional. A challan raised without a firm simply omits the
// whole header (name banner, address, contact, GSTIN) and the "For <firm>"
// line above the signature - it does not print an empty box.
//
// A DC is a non-commercial dispatch document, so no rate, amount, tax or value
// appears anywhere on it.

import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";

export interface DcPdfItem {
  srNo: number;
  itemName: string;
  qty: number;
  unit?: string;
}

export interface DcPdfFirm {
  name: string;
  address: string;
  mobile?: string;
  email?: string;
  gstin?: string | null;
  pan?: string | null;
}

export interface DcPdfData {
  dcNumberFormatted: string; // "01/26-27"
  date: string; // "dd/mm/yyyy"
  /** Omitted entirely when the challan was raised without picking a firm. */
  firm?: DcPdfFirm | null;
  // Every consignee field optional - a challan may go out with none filled in,
  // in which case the whole block is skipped rather than printed empty.
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
  /** Stamps a DRAFT watermark on each copy, so a printed draft can never be
   * mistaken for an issued document. */
  isDraft?: boolean;
}

// ---- Sheet geometry ----
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const HALF_H = PAGE_H / 2;
const SIDE_MARGIN = 18;
const COPY_PAD = 12; // clearance above each copy and below it, around the cut line

// ---- Type scale. Small by necessity: a full challan has to fit an A5 half. ----
const FS = {
  firmName: 11,
  firmMeta: 6.5,
  title: 9.5,
  copyLabel: 6.5,
  info: 7,
  consigneeName: 8,
  tableHead: 7,
  row: 7,
  total: 7.5,
  terms: 6,
  sign: 6.5,
  footer: 5.8,
};

const LH = { firmMeta: 8, info: 9, row: 8, terms: 7.5 }; // line heights

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

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

/** Wraps, then drops any line past `max` and ellipsises the last kept one.
 * The consignee block is capped this way so a long pasted address can't push
 * the item table off an A5 half. */
function wrapClamped(font: PDFFont, text: string, size: number, maxWidth: number, max: number): string[] {
  const lines = wrapText(font, text, size, maxWidth);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = `${kept[max - 1].replace(/[\s,]+$/, "")}…`;
  return kept;
}

export async function generateDeliveryChallanPdf(dc: DcPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const CONTENT_W = PAGE_W - SIDE_MARGIN * 2;
  const firm = dc.firm && dc.firm.name ? dc.firm : null;

  // ---- Column geometry (shared by every copy) ----
  const cols = [
    { key: "sr", label: "Sr.", w: 30, align: "center" as const },
    { key: "name", label: "Item Name", w: 0, align: undefined },
    { key: "qty", label: "Qty", w: 58, align: "right" as const },
    { key: "unit", label: "Unit", w: 58, align: "center" as const },
  ];
  const nameCol = cols[1];
  nameCol.w = CONTENT_W - (cols[0].w + cols[2].w + cols[3].w);
  const colX: number[] = [];
  {
    let x = SIDE_MARGIN;
    for (const c of cols) {
      colX.push(x);
      x += c.w;
    }
  }
  const qtyIdx = 2;

  // ---- Pre-measure everything whose height is fixed for the whole document ----
  const firmAddrLines = firm ? wrapClamped(font, firm.address, FS.firmMeta, CONTENT_W - 16, 2) : [];
  const firmHasContact = Boolean(firm && (firm.mobile || firm.email));
  const firmTaxId = firm ? (firm.gstin ? `GSTIN No : ${firm.gstin}` : firm.pan ? `PAN : ${firm.pan}` : "") : "";

  const firmHeaderH = firm
    ? 15 /* name banner */ +
      4 +
      firmAddrLines.length * LH.firmMeta +
      (firmHasContact ? LH.firmMeta : 0) +
      (firmTaxId ? LH.firmMeta : 0) +
      4
    : 0;

  const TITLE_H = 14;

  const infoSplit = SIDE_MARGIN + CONTENT_W * 0.56;
  const infoLeftW = infoSplit - SIDE_MARGIN - 10;

  const consignee = dc.consignee || {};
  const consigneeName = (consignee.buyerName || consignee.instituteName || "").trim();
  const hasConsignee = Boolean(consigneeName || consignee.address || consignee.place || consignee.mobile);

  // Each entry is one printed line of the left-hand consignee column.
  const consigneeLines: { str: string; f: PDFFont; size: number }[] = [];
  if (hasConsignee) {
    consigneeLines.push({ str: "To,", f: font, size: FS.info });
    for (const l of wrapClamped(bold, consigneeName, FS.consigneeName, infoLeftW, 2)) {
      if (consigneeName) consigneeLines.push({ str: l, f: bold, size: FS.consigneeName });
    }
    // The institute earns its own line only when a contact person's name is
    // already occupying the bold line above it.
    if (consignee.buyerName && consignee.instituteName) {
      for (const l of wrapClamped(font, consignee.instituteName, FS.info, infoLeftW, 1)) {
        consigneeLines.push({ str: l, f: font, size: FS.info });
      }
    }
    if (consignee.address) {
      for (const l of wrapClamped(font, consignee.address, FS.info, infoLeftW, 2)) {
        consigneeLines.push({ str: l, f: font, size: FS.info });
      }
    }
    // Place and Mobile share one line - on an A5 half every line counts.
    const tail = [consignee.place ? `Place : ${consignee.place}` : "", consignee.mobile ? `Mob : ${consignee.mobile}` : ""]
      .filter(Boolean)
      .join("   ");
    if (tail) consigneeLines.push({ str: tail, f: font, size: FS.info });
  }

  const infoRows: [string, string][] = [
    ["DC No.", dc.dcNumberFormatted || "-"],
    ["Date", dc.date],
  ];
  const infoH = Math.max(consigneeLines.length, infoRows.length) * LH.info + 8;

  const TABLE_HEAD_H = 12;

  const terms = [
    "1. Goods must be checked within 2 days of receipt; any defect or complaint reported within this period.",
    "2. Damage or defects must be reported immediately. Communication for replacement must be immediate.",
    "3. This challan is not a bill - no amount is payable against it.",
  ];
  const remarkLines = dc.remarks && dc.remarks.trim() ? wrapClamped(font, `Remarks : ${dc.remarks.trim()}`, FS.terms, CONTENT_W - 12, 2) : [];

  const TOTAL_H = 13;
  const REMARKS_H = remarkLines.length ? remarkLines.length * LH.terms + 5 : 0;
  const TERMS_H = terms.length * LH.terms + 5;
  const SIGN_H = 34;
  const FOOTER_H = 10;
  const bottomStackH = TOTAL_H + REMARKS_H + TERMS_H + SIGN_H + FOOTER_H;

  const copyH = PAGE_H - COPY_PAD - (HALF_H + COPY_PAD); // identical for both halves
  const rowsAreaH = copyH - firmHeaderH - TITLE_H - infoH - TABLE_HEAD_H - bottomStackH;

  // ---- Measure each item row, then split into per-sheet chunks ----
  const measured = dc.items.map((it) => {
    const nameLines = wrapText(font, it.itemName, FS.row, nameCol.w - 6);
    return { it, nameLines, h: Math.max(11, nameLines.length * LH.row + 3) };
  });

  const chunks: (typeof measured)[] = [];
  {
    let current: typeof measured = [];
    let used = 0;
    for (const row of measured) {
      // A single row taller than the whole area can't be split - it gets its
      // own sheet and is allowed to overflow rather than loop forever.
      if (current.length > 0 && used + row.h > rowsAreaH) {
        chunks.push(current);
        current = [];
        used = 0;
      }
      current.push(row);
      used += row.h;
    }
    chunks.push(current); // always at least one, so an item-less challan still prints
  }

  // ---- Draw ----
  // Identical on every sheet: the top half is the original, the bottom the
  // duplicate, each an A5-landscape area either side of the cut line.
  const topBox: Box = { left: SIDE_MARGIN, right: PAGE_W - SIDE_MARGIN, top: PAGE_H - COPY_PAD, bottom: HALF_H + COPY_PAD };
  const bottomBox: Box = { left: SIDE_MARGIN, right: PAGE_W - SIDE_MARGIN, top: HALF_H - COPY_PAD, bottom: COPY_PAD };

  chunks.forEach((chunk, chunkIdx) => {
    const page = doc.addPage([PAGE_W, PAGE_H]);

    drawCopy(page, topBox, "ORIGINAL COPY", chunk, chunkIdx);
    drawCopy(page, bottomBox, "DUPLICATE COPY", chunk, chunkIdx);

    // Cut line down the middle of the sheet.
    page.drawLine({
      start: { x: SIDE_MARGIN - 6, y: HALF_H },
      end: { x: PAGE_W - SIDE_MARGIN + 6, y: HALF_H },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
      dashArray: [3, 3],
    });
  });

  function drawCopy(
    page: PDFPage,
    box: Box,
    label: string,
    chunk: typeof measured,
    chunkIdx: number
  ) {
    const isLastChunk = chunkIdx === chunks.length - 1;

    const line = (x1: number, y: number, x2: number, width = 0.7) => {
      page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: width, color: rgb(0, 0, 0) });
    };
    const vline = (x: number, y1: number, y2: number, width = 0.7) => {
      page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: width, color: rgb(0, 0, 0) });
    };
    const text = (
      str: string,
      x: number,
      y: number,
      opts: { size?: number; f?: PDFFont; align?: "right" | "center"; maxWidth?: number } = {}
    ) => {
      const size = opts.size || FS.info;
      const f = opts.f || font;
      let drawX = x;
      if (opts.align === "right" && opts.maxWidth !== undefined) {
        drawX = x + opts.maxWidth - f.widthOfTextAtSize(str, size);
      } else if (opts.align === "center" && opts.maxWidth !== undefined) {
        drawX = x + (opts.maxWidth - f.widthOfTextAtSize(str, size)) / 2;
      }
      page.drawText(str, { x: drawX, y, size, font: f, color: rgb(0, 0, 0) });
    };
    const labelValue = (lbl: string, value: string, x: number, y: number, size = FS.info) => {
      text(`${lbl} : `, x, y, { size, f: bold });
      text(value, x + bold.widthOfTextAtSize(`${lbl} : `, size), y, { size });
    };

    let y = box.top;

    // ---- Firm header (skipped entirely when no firm was picked) ----
    if (firm) {
      const bannerH = 15;
      page.drawRectangle({ x: box.left, y: y - bannerH, width: CONTENT_W, height: bannerH, color: rgb(0.85, 0.85, 0.85) });
      text(firm.name, box.left, y - bannerH + 4.5, { size: FS.firmName, f: bold, align: "center", maxWidth: CONTENT_W });
      y -= bannerH + 4;

      for (const l of firmAddrLines) {
        text(l, box.left, y - FS.firmMeta, { size: FS.firmMeta, align: "center", maxWidth: CONTENT_W });
        y -= LH.firmMeta;
      }
      if (firmHasContact) {
        if (firm.mobile) text(`Mobile No : ${firm.mobile}`, box.left + 5, y - FS.firmMeta, { size: FS.firmMeta });
        if (firm.email) text(`Email Id : ${firm.email}`, box.left, y - FS.firmMeta, { size: FS.firmMeta, align: "right", maxWidth: CONTENT_W - 5 });
        y -= LH.firmMeta;
      }
      if (firmTaxId) {
        text(firmTaxId, box.left + 5, y - FS.firmMeta, { size: FS.firmMeta });
        y -= LH.firmMeta;
      }
      y -= 4;
      line(box.left, y, box.right);
    }

    // ---- Title bar: DELIVERY CHALLAN centred, copy label right ----
    text("DELIVERY CHALLAN", box.left, y - 10, { size: FS.title, f: bold, align: "center", maxWidth: CONTENT_W });
    text(label, box.left, y - 9.5, { size: FS.copyLabel, f: bold, align: "right", maxWidth: CONTENT_W - 5 });
    if (chunks.length > 1) {
      text(`Sheet ${chunkIdx + 1} of ${chunks.length}`, box.left + 5, y - 9.5, { size: FS.copyLabel });
    }
    y -= TITLE_H;
    line(box.left, y, box.right);

    // ---- Consignee (left) + DC No./Date (right) ----
    const infoTop = y;
    let ly = infoTop - 4;
    for (const l of consigneeLines) {
      text(l.str, box.left + 5, ly - l.size, { size: l.size, f: l.f });
      ly -= LH.info;
    }
    let ry = infoTop - 4;
    for (const [lbl, value] of infoRows) {
      labelValue(lbl, value, infoSplit + 5, ry - FS.info, FS.info);
      ry -= LH.info;
    }
    y = infoTop - infoH;
    line(box.left, y, box.right);
    vline(infoSplit, infoTop, y);

    // ---- Table header ----
    page.drawRectangle({ x: box.left, y: y - TABLE_HEAD_H, width: CONTENT_W, height: TABLE_HEAD_H, color: rgb(0.94, 0.94, 0.94) });
    cols.forEach((c, i) => {
      text(c.label, colX[i] + 3, y - TABLE_HEAD_H + 3.5, {
        size: FS.tableHead,
        f: bold,
        align: c.align,
        maxWidth: c.align ? c.w - 6 : undefined,
      });
    });
    y -= TABLE_HEAD_H;
    line(box.left, y, box.right);
    cols.forEach((_, i) => {
      if (i > 0) vline(colX[i], y + TABLE_HEAD_H, y);
    });

    // ---- Item rows ----
    const rowsTop = y;
    for (let i = 0; i < chunk.length; i++) {
      const { it, nameLines, h } = chunk[i];
      const rowTop = y;
      const values: Record<string, string> = { sr: String(it.srNo), qty: fmtQty(it.qty), unit: it.unit || "" };

      cols.forEach((c, ci) => {
        if (c.key === "name") {
          let ny = rowTop - LH.row;
          for (const nl of nameLines) {
            text(nl, colX[ci] + 3, ny, { size: FS.row });
            ny -= LH.row;
          }
          return;
        }
        text(values[c.key] ?? "", colX[ci] + 3, rowTop - LH.row, {
          size: FS.row,
          align: c.align,
          maxWidth: c.align ? c.w - 6 : undefined,
        });
      });

      y -= h;
      if (i < chunk.length - 1) line(box.left, y, box.right, 0.4);
    }

    // ---- Ruled blank space down to the pinned bottom stack ----
    const rowsBottom = box.bottom + bottomStackH;
    cols.forEach((_, ci) => {
      if (ci > 0) vline(colX[ci], rowsTop, rowsBottom);
    });
    y = rowsBottom;
    line(box.left, y, box.right);

    // ---- Total (last sheet) / continuation notice (earlier sheets) ----
    const totalTop = y;
    if (isLastChunk) {
      text(`${dc.items.length} item${dc.items.length === 1 ? "" : "s"}`, box.left + 5, totalTop - 9, { size: FS.row });
      text("Total Qty", colX[qtyIdx] - 8, totalTop - 9, { size: FS.total, f: bold, align: "right", maxWidth: 0 });
      text(fmtQty(dc.totalQty), colX[qtyIdx] + 3, totalTop - 9, {
        size: FS.total,
        f: bold,
        align: "right",
        maxWidth: cols[qtyIdx].w - 6,
      });
    } else {
      text("… continued on the next sheet", box.left + 5, totalTop - 9, { size: FS.row, f: italic });
    }
    y -= TOTAL_H;
    line(box.left, y, box.right);
    vline(colX[qtyIdx], totalTop, y);
    vline(colX[qtyIdx] + cols[qtyIdx].w, totalTop, y);

    // ---- Remarks ----
    if (remarkLines.length) {
      let rly = y - 3;
      for (const l of remarkLines) {
        text(l, box.left + 5, rly - FS.terms, { size: FS.terms });
        rly -= LH.terms;
      }
      y -= REMARKS_H;
      line(box.left, y, box.right);
    }

    // ---- Terms ----
    let tty = y - 3;
    for (const l of terms) {
      text(l, box.left + 5, tty - FS.terms, { size: FS.terms });
      tty -= LH.terms;
    }
    y -= TERMS_H;
    line(box.left, y, box.right);

    // ---- Signatures ----
    const signTop = y;
    const halfW = CONTENT_W / 2;
    text("Received the above goods in good condition.", box.left + 5, signTop - 9, { size: FS.sign, f: italic });
    line(box.left + 8, signTop - 24, box.left + halfW - 14, 0.5);
    text("Receiver's Signature", box.left + 8, signTop - 31, { size: FS.sign, f: bold });

    // With no firm on the challan there is no name to sign "For" - only the
    // rule and the Authorised Signatory caption are drawn.
    if (firm) {
      text(`For ${firm.name}`, box.left + halfW, signTop - 9, { size: FS.sign, f: bold, align: "center", maxWidth: halfW - 6 });
    }
    line(box.left + halfW + 14, signTop - 24, box.right - 8, 0.5);
    text("Authorised Signatory", box.left + halfW, signTop - 31, { size: FS.sign, f: bold, align: "center", maxWidth: halfW - 6 });

    y -= SIGN_H;
    line(box.left, y, box.right);
    vline(box.left + halfW, signTop, y);

    // ---- Footer note ----
    text("Computer generated Delivery Challan. Not a tax invoice - no amount is payable against it.", box.left, y - 7, {
      size: FS.footer,
      f: italic,
      align: "center",
      maxWidth: CONTENT_W,
    });

    // ---- Outer border of this copy ----
    page.drawRectangle({
      x: box.left,
      y: box.bottom,
      width: CONTENT_W,
      height: box.top - box.bottom,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    // ---- DRAFT watermark, last so it sits over the content ----
    if (dc.isDraft) {
      page.drawText("DRAFT", {
        x: box.left + CONTENT_W / 2 - 95,
        y: box.bottom + (box.top - box.bottom) / 2 - 24,
        size: 56,
        font: bold,
        color: rgb(0.75, 0.75, 0.75),
        rotate: degrees(20),
        opacity: 0.4,
      });
    }
  }

  return doc.save();
}
