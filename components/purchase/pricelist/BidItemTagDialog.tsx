"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { FiX, FiSearch, FiCheck } from "react-icons/fi";
import { normalizeName } from "@/lib/pricelist/normalize";

const inr = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—");

interface RecItem {
  sku: string;
  itemName: string;
  vendor: string;
  category: string;
  rate: number;
  tagKeys: string[];
  tagId?: string; // this bid item's tag link on the sku, if tagged
}

// Opened from a bid item (Document Maker): pick Pricelist items and/or Received Purchase items and tag them
// with this bid item's name - the reverse of tagging from the Pricelist / Received Purchase pages.
// Received items are listed even when they have no rate yet (rate 0).
export default function BidItemTagDialog({
  bidItemTitle,
  bidItemSpec,
  userName,
  onClose,
  onDone,
}: {
  bidItemTitle: string;
  // Specification of the BOQ row the tag button was opened from, if any - folded into the
  // tag name/key so two rows sharing a title but differing only in spec (e.g. "P.V.C.
  // Insulated Copper Wire" 7/20 vs 3/20 wire) are tagged and matched separately.
  bidItemSpec?: string;
  userName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const bidItemName = [bidItemTitle, bidItemSpec].filter(Boolean).join(" ");
  const bidKey = normalizeName(bidItemName);
  // Search box defaults to the title alone - the pricelist/received search requires every
  // typed word to match, and specification text usually isn't present in that search index.
  const [q, setQ] = useState(bidItemTitle);
  const [plItems, setPlItems] = useState<any[]>([]);
  const [plLoading, setPlLoading] = useState(false);
  const [received, setReceived] = useState<RecItem[] | null>(null);
  const [plSel, setPlSel] = useState<Set<string>>(new Set());
  const [recSel, setRecSel] = useState<Set<string>>(new Set());
  // already-tagged rows marked for removal (kind:key -> tag link id)
  const [rem, setRem] = useState<Map<string, { kind: "pl" | "rec"; id: string }>>(new Map());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // pricelist search (server side, every word must match)
  useEffect(() => {
    const t = setTimeout(async () => {
      setPlLoading(true);
      try {
        const res = await fetch(`/api/purchase/pricelist/items?q=${encodeURIComponent(q)}`);
        const d = await res.json();
        setPlItems(d.items || []);
      } catch {
        setPlItems([]);
      } finally {
        setPlLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  // received purchase items: one row per sku (latest positive rate, 0 if never priced)
  useEffect(() => {
    fetch("/api/purchase/pricelist/received-with-tags")
      .then((r) => r.json())
      .then((d) => {
        const bySku = new Map<string, RecItem & { at: number }>();
        for (const r of (d.rows || []) as any[]) {
          if (!r.sku) continue;
          const at = new Date(r.receivedAt).getTime() || 0;
          const rate = Number(r.rate) || 0;
          const cur = bySku.get(r.sku);
          const tagKeys = (r.tags || []).map((t: any) => t.tag_key);
          const tagId = (r.tags || []).find((t: any) => t.tag_key === bidKey)?._id;
          if (!cur) {
            bySku.set(r.sku, { sku: r.sku, itemName: r.itemName || "", vendor: r.vendor || "", category: r.category || "", rate, tagKeys, tagId, at: rate > 0 ? at : 0 });
          } else if (rate > 0 && at >= cur.at) {
            cur.rate = rate;
            cur.vendor = r.vendor || cur.vendor;
            cur.at = at;
          }
        }
        setReceived(Array.from(bySku.values()));
      })
      .catch(() => setReceived([]));
  }, []);

  const recResults = useMemo(() => {
    if (!received) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return received
      .filter((r) => {
        const hay = `${r.itemName} ${r.sku} ${r.vendor} ${r.category}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 100);
  }, [received, q]);

  // one combined list: pricelist items first, then received purchase items
  type Row = { kind: "pl" | "rec"; key: string; done: boolean; tagId?: string; pl?: any; rec?: RecItem };
  const rows: Row[] = useMemo(
    () => [
      ...plItems.map((i): Row => ({ kind: "pl", key: i.sku_key, done: (i.tags || []).some((t: any) => t.tag_key === bidKey), tagId: (i.tags || []).find((t: any) => t.tag_key === bidKey)?._id, pl: i })),
      ...recResults.map((r): Row => ({ kind: "rec", key: r.sku, done: r.tagKeys.includes(bidKey), tagId: r.tagId, rec: r })),
    ],
    [plItems, recResults, bidKey]
  );
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const toggleRow = (row: Row) => {
    if (row.done) {
      if (!row.tagId) return;
      const k = row.kind + ":" + row.key;
      const n = new Map(rem);
      n.has(k) ? n.delete(k) : n.set(k, { kind: row.kind, id: row.tagId });
      setRem(n);
      return;
    }
    const set = row.kind === "pl" ? plSel : recSel;
    const n = new Set(set);
    n.has(row.key) ? n.delete(row.key) : n.add(row.key);
    row.kind === "pl" ? setPlSel(n) : setRecSel(n);
  };

  const total = plSel.size + recSel.size + rem.size;
  const save = async () => {
    if (total === 0) return;
    setSaving(true);
    setErr("");
    try {
      for (const x of Array.from(rem.values())) {
        const url = x.kind === "pl" ? "/api/purchase/pricelist/tags" : "/api/purchase/pricelist/received-tags";
        const res = await fetch(url + "?id=" + x.id, { method: "DELETE" });
        if (!res.ok) throw new Error("Could not remove a tag");
      }
      if (plSel.size) {
        const res = await fetch("/api/purchase/pricelist/tags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag_name: bidItemName, sku_keys: Array.from(plSel), userName }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Pricelist tag failed");
      }
      if (recSel.size) {
        const res = await fetch("/api/purchase/pricelist/received-tags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag_name: bidItemName, skus: Array.from(recSel), userName }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Received tag failed");
      }
      onDone();
    } catch (e: any) {
      setErr(e.message);
      setSaving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) save();
      else if (rows[active]) toggleRow(rows[active]);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-16 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-3 gap-3">
          <div>
            <div className="text-sm font-black text-slate-800">Tag items with this bid item</div>
            <div className="text-[11px] text-slate-500 uppercase">{bidItemTitle}</div>
            {bidItemSpec && <div className="text-[10px] text-slate-400">{bidItemSpec}</div>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><FiX /></button>
        </div>

        <div className="relative">
          <FiSearch className="absolute left-3 top-3 text-slate-400" />
          <input
            autoFocus
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pricelist / received purchase items…"
            className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>

        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2">
          <div className="text-[10px] font-black uppercase tracking-wider text-amber-700 mb-1">Keyboard se kaise use kare</div>
          <ul className="text-[11px] text-slate-600 space-y-0.5">
            {[
              ["↑ ↓", "highlight upar-neeche jata hai"],
              ["Enter", "highlighted row select / unselect hoti hai (Tagged row par = tag hatana)"],
              ["Ctrl + Enter", "selected sab items tag ho jate hain"],
              ["Esc", "popup band hota hai"],
            ].map(([k, d]) => (
              <li key={k} className="flex items-center gap-2">
                <kbd className="min-w-[78px] text-center px-1.5 py-0.5 rounded border border-slate-300 bg-white text-[10px] font-black text-slate-700 shadow-sm">{k}</kbd>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>

        <div ref={listRef} className="mt-2 border border-slate-200 rounded-xl max-h-[50vh] overflow-auto divide-y divide-slate-100">
          {(plLoading || received === null) && rows.length === 0 && <div className="p-4 text-xs text-slate-400 text-center animate-pulse">Searching…</div>}
          {!plLoading && received !== null && rows.length === 0 && <div className="p-4 text-xs text-slate-400 text-center">No item found</div>}
          {rows.map((row, idx) => {
            const sel = row.kind === "pl" ? plSel.has(row.key) : recSel.has(row.key);
            const base = `flex items-center gap-3 px-3 py-2 text-xs cursor-pointer ${row.done && !rem.has(row.kind + ":" + row.key) ? "opacity-70" : ""} ${rem.has(row.kind + ":" + row.key) ? "bg-rose-50" : ""} ${idx === active ? "bg-amber-50 ring-1 ring-inset ring-amber-300" : sel ? "bg-emerald-50" : "hover:bg-slate-50"}`;
            const badge = row.kind === "pl"
              ? <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 uppercase">Pricelist</span>
              : <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-green-100 text-green-700 uppercase">Received</span>;
            const i = row.pl;
            const r = row.rec;
            return (
              <div key={row.kind + row.key} data-idx={idx} className={base} onClick={() => { setActive(idx); toggleRow(row); }}>
                <input type="checkbox" readOnly tabIndex={-1} checked={row.done ? !rem.has(row.kind + ":" + row.key) : sel} />
                {badge}
                <div className="flex-1 min-w-0">
                  {i ? (
                    <>
                      <div className="font-bold text-slate-800 truncate">{[i.category, i.sub_type, i.model_no, i.size_spec, i.variant].filter(Boolean).join(" · ") || i.sku_key}</div>
                      <div className="text-[10px] text-slate-500">{[i.supplier_name, i.brand].filter(Boolean).join(" · ")}</div>
                    </>
                  ) : (
                    <>
                      <div className="font-bold text-slate-800 truncate uppercase">{r!.itemName}</div>
                      <div className="text-[10px] text-slate-500">{[r!.sku, r!.vendor].filter(Boolean).join(" · ")}</div>
                    </>
                  )}
                </div>
                {row.done && (rem.has(row.kind + ":" + row.key)
                  ? <span className="text-[10px] font-black text-rose-600">Will remove</span>
                  : <span className="text-[10px] font-black text-emerald-600 flex items-center gap-1"><FiCheck /> Tagged</span>)}
                {i ? (
                  <span className="font-black text-orange-600 w-20 text-right">{i.unit_price_incl_gst != null ? `₹${inr(i.unit_price_incl_gst)}` : "—"}</span>
                ) : (
                  <span className={`font-black w-20 text-right ${r!.rate > 0 ? "text-green-600" : "text-slate-400"}`}>{r!.rate > 0 ? `₹${inr(r!.rate)}` : "No rate"}</span>
                )}
              </div>
            );
          })}
        </div>

        {err && <div className="text-xs text-rose-600 mt-2">{err}</div>}
        <button
          disabled={saving || total === 0}
          onClick={save}
          className="mt-4 w-full py-2 rounded-lg bg-orange-500 text-white text-xs font-black uppercase tracking-wider disabled:opacity-40"
        >
          {saving ? "Saving…" : total ? [plSel.size + recSel.size ? `Tag ${plSel.size + recSel.size}` : "", rem.size ? `Remove ${rem.size}` : ""].filter(Boolean).join(" + ") : "Select items to tag / untag"}
        </button>
      </div>
    </div>
  );
}
