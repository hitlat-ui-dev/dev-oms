"use client";
import { useState } from "react";

export interface PricelistRate {
  sku_key: string;
  rate: number | null;
  brand: string;
  supplier_name: string;
  price: number | null;
  price_qty: number;
  discount_pct: number;
  gst_pct: number | null;
  gst_included: string;
  valid_from: string;
  price_status: string;
  is_active: boolean;
  uploaded_at: string | null;
}

const ORANGE = "#F97316";
const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function tooltipFor(r: PricelistRate) {
  return [
    `Supplier: ${r.supplier_name}`,
    `Brand: ${r.brand || "-"}`,
    `SKU: ${r.sku_key}`,
    r.price !== null ? `Price: ${fmt(r.price)} / ${r.price_qty}` : "Price: on request",
    `Discount: ${r.discount_pct || 0}%`,
    `GST: ${r.gst_pct ?? "-"}%${r.gst_included === "YES" ? " (included in price)" : ""}`,
    `Valid from: ${r.valid_from}`,
    r.uploaded_at ? `Pricelist uploaded on ${new Date(r.uploaded_at).toLocaleDateString("en-IN")}` : "",
  ].filter(Boolean).join("\n");
}

function oldLabel(validFrom: string) {
  const d = new Date(validFrom);
  if (isNaN(d.getTime())) return "";
  const months = (Date.now() - d.getTime()) / (30.44 * 24 * 3600 * 1000);
  return months > 12 ? d.toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : "";
}

// Orange pricelist rate shown next to Base Rate: cheapest active rate + brand, "+N more" popover for the rest.
// "Use as Base Rate" is explicit - the Base Rate input is never overwritten automatically.
export default function PricelistRateChip({ rates, onUse }: { rates?: PricelistRate[]; onUse?: (rate: number) => void }) {
  const [open, setOpen] = useState(false);
  if (!rates || rates.length === 0) return null;
  const best = rates[0];
  const old = oldLabel(best.valid_from);

  let main: React.ReactNode;
  if (!best.is_active) {
    main = (
      <span className="text-slate-400" title={tooltipFor(best)}>
        {best.rate !== null ? `₹ ${fmt(best.rate)}` : "On Request"} · {best.brand} <span className="italic">Not in latest pricelist</span>
      </span>
    );
  } else if (best.rate === null) {
    main = (
      <span className="font-bold" style={{ color: ORANGE }} title={tooltipFor(best)}>
        On Request · {best.brand}
      </span>
    );
  } else {
    main = (
      <>
        <button
          type="button"
          disabled={!onUse}
          onClick={() => onUse?.(best.rate as number)}
          title={`${tooltipFor(best)}\n\nClick: use as Base Rate`}
          className="font-bold underline-offset-2 hover:underline"
          style={{ color: ORANGE }}
        >
          ₹ {fmt(best.rate)}
        </button>
        <span className="text-[8px] text-slate-400"> incl. GST </span>
        <span className="px-1 rounded bg-orange-50 text-orange-700 border border-orange-200 text-[9px] font-bold">{best.brand}</span>
      </>
    );
  }

  return (
    <div className="relative mt-0.5 text-[10px] leading-tight">
      {main}
      {old && best.is_active && <span className="ml-1 text-amber-600" title="Pricelist is older than 12 months">⚠ Old pricelist ({old})</span>}
      {rates.length > 1 && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="ml-1 text-blue-600 underline">
          +{rates.length - 1} more
        </button>
      )}
      {open && (
        <div className="absolute z-30 left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl p-2 w-56" onMouseLeave={() => setOpen(false)}>
          {rates.map((r) => (
            <div key={r.sku_key} className={`flex justify-between gap-2 py-0.5 text-[10px] ${r.is_active ? "" : "text-slate-400"}`} title={tooltipFor(r)}>
              <span className="font-bold">{r.brand || r.supplier_name}</span>
              <span>{r.rate !== null ? `₹ ${fmt(r.rate)}` : "On request"}</span>
              <span className="text-slate-400">{r.valid_from}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
