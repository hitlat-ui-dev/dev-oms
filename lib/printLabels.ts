// Sticker-label printing for the Orders page. Builds a self-contained HTML
// document (thermal 50x25mm, or A4 sheet of 40 labels) that is rendered in a
// new window and printed from there.

export type LabelPrinter = "thermal" | "a4";
export type LabelCopies = "perOrder" | "byQty";

export interface LabelSettings {
  printer: LabelPrinter;
  copies: LabelCopies;
  startLabel: number; // 1-40, A4 only
  offsetX: number; // mm
  offsetY: number; // mm
}

export const DEFAULT_LABEL_SETTINGS: LabelSettings = {
  printer: "thermal",
  copies: "perOrder",
  startLabel: 1,
  offsetX: 0,
  offsetY: 0,
};

const SETTINGS_KEY = "oms_label_print_settings";

export function loadLabelSettings(): LabelSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_LABEL_SETTINGS;
    const p = JSON.parse(raw);
    return {
      printer: p.printer === "a4" ? "a4" : "thermal",
      copies: p.copies === "byQty" ? "byQty" : "perOrder",
      startLabel: Math.min(40, Math.max(1, Math.round(Number(p.startLabel) || 1))),
      offsetX: Number(p.offsetX) || 0,
      offsetY: Number(p.offsetY) || 0,
    };
  } catch {
    return DEFAULT_LABEL_SETTINGS;
  }
}

export function saveLabelSettings(s: LabelSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable - settings just won't persist */
  }
}

const esc = (v: any) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

interface LabelData {
  orderNo: string;
  buyer: string;
  qtyText: string;
}

function expandLabels(orders: any[], copies: LabelCopies): LabelData[] {
  const out: LabelData[] = [];
  for (const o of orders) {
    const qty = Number(o.reQty) || 0;
    const n = copies === "byQty" ? Math.min(1000, Math.max(1, Math.round(qty))) : 1;
    const label: LabelData = {
      orderNo: String(o.orderNo ?? ""),
      buyer: String(o.instituteName || o.buyerName || "").toUpperCase(),
      qtyText: `QTY: ${qty} ${o.unit || ""}`.trim().toUpperCase(),
    };
    for (let i = 0; i < n; i++) out.push(label);
  }
  return out;
}

const labelInner = (l: LabelData) =>
  `<div class="no">${esc(l.orderNo)}</div><div class="buyer">${esc(l.buyer)}</div><div class="qty">${esc(l.qtyText)}</div>`;

export function buildLabelsHtml(orders: any[], s: LabelSettings): string {
  const labels = expandLabels(orders, s.copies);
  const isA4 = s.printer === "a4";
  const buyerPt = isA4 ? 14 : 13;
  const qtyPt = isA4 ? 15 : 14;

  const baseCss = `
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{background:#fff;color:#000}
    .label{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
      overflow:hidden;color:#000;border:none;outline:none;font-family:"Arial Black",Arial,sans-serif;line-height:1.05}
    .no{font-size:26pt;font-weight:900;line-height:1.05;white-space:nowrap}
    .buyer{font-size:${buyerPt}pt;font-weight:800;line-height:1.05;text-transform:uppercase;width:100%;word-break:break-word}
    .qty{font-size:${qtyPt}pt;font-weight:800;line-height:1.05;text-transform:uppercase;white-space:nowrap}
  `;

  let css: string;
  let body: string;

  if (!isA4) {
    css = `${baseCss}
      @page{size:50mm 25mm;margin:0}
      html,body{width:50mm}
      .label{width:50mm;height:25mm;padding:1.5mm;page-break-after:always;break-after:page}
      .label:last-child{page-break-after:auto;break-after:auto}
    `;
    body = labels.map((l) => `<div class="label">${labelInner(l)}</div>`).join("");
  } else {
    const start = Math.min(40, Math.max(1, Math.round(s.startLabel) || 1));
    const cells: (LabelData | null)[] = [...Array(start - 1).fill(null), ...labels];
    const sheets: (LabelData | null)[][] = [];
    for (let i = 0; i < cells.length; i += 40) sheets.push(cells.slice(i, i + 40));
    css = `${baseCss}
      @page{size:A4;margin:0}
      html,body{width:210mm}
      .sheet{position:relative;left:${Number(s.offsetX) || 0}mm;top:${Number(s.offsetY) || 0}mm;
        width:210mm;height:297mm;display:grid;grid-template-columns:repeat(4,52.5mm);grid-template-rows:repeat(10,29.7mm);
        page-break-after:always;break-after:page;overflow:visible}
      .sheet:last-child{page-break-after:auto;break-after:auto}
      .label{width:52.5mm;height:29.7mm;padding:4mm}
    `;
    body = sheets
      .map((sheet) => `<div class="sheet">${sheet.map((l) => (l ? `<div class="label">${labelInner(l)}</div>` : `<div class="label"></div>`)).join("")}</div>`)
      .join("");
  }

  // Buyer name: shrink (down to 10pt) until it fits in 2 lines and the label
  // doesn't overflow - never clipped.
  const script = `
    (function(){
      var PX=96/72, MIN=10;
      function fit(){
        var els=document.querySelectorAll('.label');
        for(var i=0;i<els.length;i++){
          var lab=els[i], b=lab.querySelector('.buyer'); if(!b) continue;
          var pt=${buyerPt};
          function tooBig(){
            var fs=pt*PX, lines=b.getBoundingClientRect().height/(fs*1.05);
            var cs=getComputedStyle(lab);
            var innerH=lab.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
            var used=0, kids=lab.children;
            for(var k=0;k<kids.length;k++) used+=kids[k].getBoundingClientRect().height;
            return lines>2.1 || used>innerH+0.5;
          }
          b.style.fontSize=pt+'pt';
          while(pt>MIN && tooBig()){ pt-=0.5; b.style.fontSize=pt+'pt'; }
        }
      }
      window.onload=function(){ fit(); setTimeout(function(){ window.focus(); window.print(); },200); };
    })();
  `;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Print Labels</title><style>${css}</style></head><body>${body}<script>${script}</script></body></html>`;
}

/** Opens a new window with the labels and triggers print. Returns false if the popup was blocked. */
export function printLabels(orders: any[], s: LabelSettings): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(buildLabelsHtml(orders, s));
  w.document.close();
  return true;
}
