"use client";

export interface RateSuggestion {
  source: "pricelist" | "received";
  tag_name: string;
  score: number;
  rate: number;
  label: string;
}

const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "Did you mean" hints for bid items with no exact tag match: close tag names (similarity score),
// orange = supplier pricelist, green = received purchase. Click copies the rate to Base Rate.
export default function RateSuggestions({ items, onUse }: { items?: RateSuggestion[]; onUse?: (rate: number) => void }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-0.5 space-y-0.5">
      {items.map((s) => (
        <button
          key={s.source + s.tag_name}
          type="button"
          onClick={() => onUse?.(s.rate)}
          title={`Not an exact tag match - check before using.\nTag: ${s.tag_name}\n${s.source === "pricelist" ? "Pricelist" : "Received purchase"}: ${s.label}\nClick: use as Base Rate`}
          className={`block text-left text-[9px] leading-tight italic hover:underline ${s.source === "pricelist" ? "text-orange-500" : "text-green-600"}`}
        >
          Suggested {Math.round(s.score * 100)}%: {s.tag_name.length > 28 ? s.tag_name.slice(0, 28) + "…" : s.tag_name} · ₹ {fmt(s.rate)}
          {s.label ? ` · ${s.label}` : ""}
        </button>
      ))}
    </div>
  );
}
