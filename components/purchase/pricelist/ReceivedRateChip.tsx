"use client";
import { useState } from "react";

export interface ReceivedRate {
  sku: string;
  rate: number;
  vendor: string;
  itemName: string;
  receivedAt: string | null;
}

const GREEN = "#16A34A";
const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN") : "");
const tip = (r: ReceivedRate) => [`Item: ${r.itemName}`, `SKU: ${r.sku}`, `Vendor: ${r.vendor || "-"}`, r.receivedAt ? `Received: ${day(r.receivedAt)}` : ""].filter(Boolean).join("\n");

// Green "Received Purchase" rate under Base Rate: lowest of the tagged items' latest received rate.
// "Use" copies it into Base Rate only on click.
export default function ReceivedRateChip({ rates, onUse }: { rates?: ReceivedRate[]; onUse?: (rate: number) => void }) {
  const [open, setOpen] = useState(false);
  if (!rates || rates.length === 0) return null;
  const best = rates[0];
  return (
    <div className="relative mt-0.5 text-[10px] leading-tight">
      <button
        type="button"
        disabled={!onUse}
        onClick={() => onUse?.(best.rate)}
        title={`${tip(best)}\n\nClick: use as Base Rate`}
        className="font-bold hover:underline"
        style={{ color: GREEN }}
      >
        ₹ {fmt(best.rate)}
      </button>
      <span className="ml-1 px-1 rounded bg-green-50 text-green-700 border border-green-200 text-[9px] font-bold">
        Received{best.vendor ? ` · ${best.vendor}` : ""}
      </span>
      {rates.length > 1 && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="ml-1 text-blue-600 underline">
          +{rates.length - 1} more
        </button>
      )}
      {open && (
        <div className="absolute z-30 left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl p-2 w-60" onMouseLeave={() => setOpen(false)}>
          {rates.map((r) => (
            <div key={r.sku} className="flex justify-between gap-2 py-0.5 text-[10px]" title={tip(r)}>
              <span className="font-bold truncate">{r.vendor || r.itemName}</span>
              <span>₹ {fmt(r.rate)}</span>
              <span className="text-slate-400">{day(r.receivedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
