// lib/generateDeliveryChallanPdf.ts
//
// Renders a Delivery Challan to PDF with pdf-lib - the same engine as
// lib/generateBillPdf.ts and lib/documentMaker/pdfEngine.ts. Deliberately NOT
// Puppeteer: this runs on Vercel serverless, where there is no headless Chrome
// binary to drive (the same reason the Billing module moved off its original
// Puppeteer design draft). There is therefore no HTML/CSS template, no @page
// rule and no page.pdf({ scale }) - everything below is drawn directly in
// PostScript points, at 1:1, with no scale factor shrinking it.
//
// LAYOUT: one A4 portrait sheet carries TWO A5 copies of the same challan,
// stacked - ORIGINAL COPY on the top half, DUPLICATE COPY on the bottom, with
// a dashed cut line between them. Both halves are identical apart from the
// label, so the sheet is printed once and torn in two.
//
// Because both copies must show the same rows, items are paginated ONCE up
// front (measure -> chunk) and each chunk is then drawn twice onto its own A4
// sheet. Drawing first and paginating as you go - the approach the single-copy
// bill renderer uses - can't work here: the bottom copy would run out of room
// at a different row than the top one.
//
// TYPE SIZES: an A5 half is 404pt of usable height, and every point spent on
// fixed furniture (firm header, terms, signature) is a point not available for
// item rows. The scale in FS below is therefore set as large as that budget
// allows - see the comment on FS - rather than as large as would look best in
// isolation. Space was bought back by folding the firm's contact and GSTIN
// onto one line and compressing the terms to two, so the item rows (the part
// anyone actually reads off the sheet) could take the largest share.
//
// The firm block is optional. A challan raised without a firm omits the whole
// header and the "For <firm>" line above the signature - it does not print an
// empty box.
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
const SIDE_MARGIN = 16; // ~5.6mm - the side gutters were never the tight axis
const COPY_PAD = 8; // clearance above each copy and below it, around the cut line

// ---- Type scale, in points (1 CSS px = 0.75pt, so 14px = 10.5pt). ----
// Sized against the A5-half budget: at these values a challan with a firm
// header fits ~7 item rows on the first sheet and ~11 on continuation sheets,
// which covers the overwhelming majority in one sheet. Pushing the title and
// row height to their full requested size costs roughly two item rows per
// sheet - the trade is documented rather than taken silently.
const FS = {
  firmName: 13,
  firmMeta: 8,
  title: 18, // 24px
  copyLabel: 9, // 12px
  toLabel: 7.5,
  info: 10, // 13px - To / DC No. / Date
  consigneeName: 11,
  tableHead: 10, // 13px
  row: 10.5, // 14px - the line that matters most on a dispatch sheet
  total: 11, // 15px
  terms: 8.5, // 11.3px
  sign: 9, // 12px
  footer: 7, // 9px
};

// Line heights. `info` is 1.5x its font size, as asked.
const LH = { firmMeta: 10, to: 9.5, info: 15, row: 12, terms: 11 };

const ROW_MIN_H = 20; // ~27px per row, so a single-line item never looks squeezed
const BANNER_H = 19;
const TITLE_H = 24;
const TABLE_HEAD_H = 17;
const TOTAL_H = 19;
const SIGN_H = 42;
const FOOTER_H = 13;

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
 * The consignee and firm blocks are clamped this way so a long pasted address
 * can't eat the item table's share of an A5 half. */
function wrapClamped(font: PDFFont, text: string, size: number, maxWidth: number, max: number): string[] {
  const lines = wrapText(font, text, size, maxWidth);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = `${kept[max - 1].replace(/[\s,]+$/, "")}…`;
  return kept;
}

export async function generateDeliveryChallanPdf(dc: DcPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // Helvetica is the PDF core font Arial maps to, so this is the same clean
  // sans across every section - no font substitution anywhere on the sheet.
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const CONTENT_W = PAGE_W - SIDE_MARGIN * 2;
  const firm = dc.firm && dc.firm.name ? dc.firm : null;

  // ---- Column geometry (shared by every copy) ----
  const cols = [
    { key: "sr", label: "Sr.", w: 34, align: "center" as const },
    { key: "name", label: "Item Name", w: 0, align: undefined },
    { key: "qty", label: "Qty", w: 64, align: "right" as const },
    { key: "unit", label: "Unit", w: 64, align: "center" as const },
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
  const firmAddrLines = firm ? wrapClamped(font, firm.address, FS.firmMeta, CONTENT_W - 14, 2) : [];
  // Mobile, email and GSTIN share ONE line: three separate lines cost 30pt of
  // an A5 half, which is a whole item row and a half.
  const firmContact = firm
    ? [firm.mobile ? `Mobile : ${firm.mobile}` : "", firm.email ? `Email : ${firm.email}` : ""].filter(Boolean).join("    ")
    : "";
  const firmTaxId = firm ? (firm.gstin ? `GSTIN : ${firm.gstin}` : firm.pan ? `PAN : ${firm.pan}` : "") : "";
  const firmHasMetaLine = Boolean(firmContact || firmTaxId);

  const firmHeaderH = firm
    ? BANNER_H + 4 + firmAddrLines.length * LH.firmMeta + (firmHasMetaLine ? LH.firmMeta : 0) + 5
    : 0;

  const infoSplit = SIDE_MARGIN + CONTENT_W * 0.56;
  const infoLeftW = infoSplit - SIDE_MARGIN - 12;

  const consignee = dc.consignee || {};
  const consigneeName = (consignee.buyerName || consignee.instituteName || "").trim();
  const hasConsignee = Boolean(consigneeName || consignee.address || consignee.place || consignee.mobile);

  // Each entry is one printed line of the left-hand consignee column, with its
  // own line height - "To," is a caption and gets a tight one, so the lines
  // that carry real content can afford the full 1.5x leading.
  const consigneeLines: { str: string; f: PDFFont; size: number; lh: number }[] = [];
  if (hasConsignee) {
    consigneeLines.push({ str: "To,", f: font, size: FS.toLabel, lh: LH.to });
    for (const l of wrapClamped(bold, consigneeName, FS.consigneeName, infoLeftW, 2)) {
      if (consigneeName) consigneeLines.push({ str: l, f: bold, size: FS.consigneeName, lh: LH.info });
    }
    // The institute earns its own line only when a contact person's name is
    // already occupying the bold line above it.
    if (consignee.buyerName && consignee.instituteName) {
      for (const l of wrapClamped(font, consignee.instituteName, FS.info, infoLeftW, 1)) {
        consigneeLines.push({ str: l, f: font, size: FS.info, lh: LH.info });
      }
    }
    if (consignee.address) {
      for (const l of wrapClamped(font, consignee.address, FS.info, infoLeftW, 2)) {
        consigneeLines.push({ str: l, f: font, size: FS.info, lh: LH.info });
      }
    }
    // Place and Mobile share one line - on an A5 half every line counts.
    const tail = [consignee.place ? `Place : ${consignee.place}` : "", consignee.mobile ? `Mob : ${consignee.mobile}` : ""]
      .filter(Boolean)
      .join("    ");
    if (tail) consigneeLines.push({ str: tail, f: font, size: FS.info, lh: LH.info });
  }

  const infoRows: [string, string][] = [
    ["DC No.", dc.dcNumberFormatted || "-"],
    ["Date", dc.date],
  ];
  const consigneeH = consigneeLines.reduce((sum, l) => sum + l.lh, 0);
  const infoH = Math.max(consigneeH, infoRows.length * LH.info) + 10;

  const termsSource = [
    "1. Goods must be checked within 2 days of receipt; any defect, damage or shortage must be reported within this period.",
    "2. This challan is not a bill - no amount is payable against it. Replacement requests must be communicated immediately.",
  ];
  const termLines = termsSource.flatMap((t) => wrapText(font, t, FS.terms, CONTENT_W - 14));
  const TERMS_H = termLines.length * LH.terms + 7;

  const remarkLines =
    dc.remarks && dc.remarks.trim() ? wrapClamped(font, `Remarks : ${dc.remarks.trim()}`, FS.terms, CONTENT_W - 14, 2) : [];
  const REMARKS_H = remarkLines.length ? remarkLines.length * LH.terms + 7 : 0;

  const bottomStackH = TOTAL_H + REMARKS_H + TERMS_H + SIGN_H + FOOTER_H;

  const copyH = PAGE_H - COPY_PAD - (HALF_H + COPY_PAD); // identical for both halves
  const rowsAreaH = copyH - firmHeaderH - TITLE_H - infoH - TABLE_HEAD_H - bottomStackH;

  // ---- Measure each item row, then split into per-sheet chunks ----
  const measured = dc.items.map((it) => {
    const nameLines = wrapText(font, it.itemName, FS.row, nameCol.w - 8);
    return { it, nameLines, h: Math.max(ROW_MIN_H, nameLines.length * LH.row + 8) };
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

  function drawCopy(page: PDFPage, box: Box, label: string, chunk: typeof measured, chunkIdx: number) {
    const isLastChunk = chunkIdx === chunks.length - 1;

    const line = (x1: number, y: number, x2: number, width = 0.8) => {
      page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: width, color: rgb(0, 0, 0) });
    };
    const vline = (x: number, y1: number, y2: number, width = 0.8) => {
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
      page.drawRectangle({ x: box.left, y: y - BANNER_H, width: CONTENT_W, height: BANNER_H, color: rgb(0.85, 0.85, 0.85) });
      text(firm.name, box.left, y - BANNER_H + 5.5, { size: FS.firmName, f: bold, align: "center", maxWidth: CONTENT_W });
      y -= BANNER_H + 4;

      for (const l of firmAddrLines) {
        text(l, box.left, y - FS.firmMeta, { size: FS.firmMeta, align: "center", maxWidth: CONTENT_W });
        y -= LH.firmMeta;
      }
      if (firmHasMetaLine) {
        if (firmContact) text(firmContact, box.left + 7, y - FS.firmMeta, { size: FS.firmMeta });
        if (firmTaxId) text(firmTaxId, box.left, y - FS.firmMeta, { size: FS.firmMeta, f: bold, align: "right", maxWidth: CONTENT_W - 7 });
        y -= LH.firmMeta;
      }
      y -= 5;
      line(box.left, y, box.right);
    }

    // ---- Title bar: DELIVERY CHALLAN centred, copy label right ----
    text("DELIVERY CHALLAN", box.left, y - 17.5, { size: FS.title, f: bold, align: "center", maxWidth: CONTENT_W });
    text(label, box.left, y - 15.5, { size: FS.copyLabel, f: bold, align: "right", maxWidth: CONTENT_W - 7 });
    if (chunks.length > 1) {
      text(`Sheet ${chunkIdx + 1} of ${chunks.length}`, box.left + 7, y - 15.5, { size: FS.copyLabel });
    }
    y -= TITLE_H;
    line(box.left, y, box.right);

    // ---- Consignee (left) + DC No./Date (right) ----
    const infoTop = y;
    let ly = infoTop - 5;
    for (const l of consigneeLines) {
      text(l.str, box.left + 7, ly - l.size, { size: l.size, f: l.f });
      ly -= l.lh;
    }
    let ry = infoTop - 5;
    for (const [lbl, value] of infoRows) {
      labelValue(lbl, value, infoSplit + 8, ry - FS.info, FS.info);
      ry -= LH.info;
    }
    y = infoTop - infoH;
    line(box.left, y, box.right);
    vline(infoSplit, infoTop, y);

    // ---- Table header ----
    page.drawRectangle({ x: box.left, y: y - TABLE_HEAD_H, width: CONTENT_W, height: TABLE_HEAD_H, color: rgb(0.92, 0.92, 0.92) });
    cols.forEach((c, i) => {
      text(c.label, colX[i] + 4, y - TABLE_HEAD_H + 5, {
        size: FS.tableHead,
        f: bold,
        align: c.align,
        maxWidth: c.align ? c.w - 8 : undefined,
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
      // Baseline sits ~3.5pt under the row's top padding, leaving matching
      // space beneath - so a single-line row reads centred in its 20pt band.
      const firstBaseline = rowTop - (FS.row + 3.5);

      cols.forEach((c, ci) => {
        if (c.key === "name") {
          let ny = firstBaseline;
          for (const nl of nameLines) {
            text(nl, colX[ci] + 4, ny, { size: FS.row });
            ny -= LH.row;
          }
          return;
        }
        text(values[c.key] ?? "", colX[ci] + 4, firstBaseline, {
          size: FS.row,
          align: c.align,
          maxWidth: c.align ? c.w - 8 : undefined,
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
      text(`${dc.items.length} item${dc.items.length === 1 ? "" : "s"}`, box.left + 7, totalTop - 13.5, { size: FS.terms });
      text("Total Qty", colX[qtyIdx] - 10, totalTop - 13.5, { size: FS.total, f: bold, align: "right", maxWidth: 0 });
      text(fmtQty(dc.totalQty), colX[qtyIdx] + 4, totalTop - 13.5, {
        size: FS.total,
        f: bold,
        align: "right",
        maxWidth: cols[qtyIdx].w - 8,
      });
    } else {
      text("… continued on the next sheet", box.left + 7, totalTop - 13.5, { size: FS.terms, f: italic });
    }
    y -= TOTAL_H;
    line(box.left, y, box.right);
    vline(colX[qtyIdx], totalTop, y);
    vline(colX[qtyIdx] + cols[qtyIdx].w, totalTop, y);

    // ---- Remarks ----
    if (remarkLines.length) {
      let rly = y - 4;
      for (const l of remarkLines) {
        text(l, box.left + 7, rly - FS.terms, { size: FS.terms });
        rly -= LH.terms;
      }
      y -= REMARKS_H;
      line(box.left, y, box.right);
    }

    // ---- Terms ----
    let tty = y - 4;
    for (const l of termLines) {
      text(l, box.left + 7, tty - FS.terms, { size: FS.terms });
      tty -= LH.terms;
    }
    y -= TERMS_H;
    line(box.left, y, box.right);

    // ---- Signatures ----
    // The receiver's half is left deliberately blank above its caption: no
    // "Received the above goods in good condition." line and no rule to sign
    // on, so the whole cell is free space for a signature or stamp.
    const signTop = y;
    const halfW = CONTENT_W / 2;
    text("Receiver's Signature", box.left + 10, signTop - 38, { size: FS.sign, f: bold });

    // With no firm on the challan there is no name to sign "For" - only the
    // rule and the Authorised Signatory caption are drawn.
    if (firm) {
      text(`For ${firm.name}`, box.left + halfW, signTop - 12, { size: FS.sign, f: bold, align: "center", maxWidth: halfW - 8 });
    }
    line(box.left + halfW + 16, signTop - 28, box.right - 10, 0.5);
    text("Authorised Signatory", box.left + halfW, signTop - 38, { size: FS.sign, f: bold, align: "center", maxWidth: halfW - 8 });

    y -= SIGN_H;
    line(box.left, y, box.right);
    vline(box.left + halfW, signTop, y);

    // ---- Footer note ----
    text("Computer generated Delivery Challan. Not a tax invoice - no amount is payable against it.", box.left, y - 9, {
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
