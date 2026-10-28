"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FiPlus, FiX, FiSearch, FiEdit2 } from "react-icons/fi";
import PricelistShell, { PricelistUser } from "@/components/purchase/pricelist/PricelistShell";

const inr = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const itemLabel = (i: any) => [i.category, i.sub_type, i.model_no, i.size_spec, i.variant].filter(Boolean).join(" · ");
const editInp = "w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400";

// Targeted single-item rate edit (PATCH /api/purchase/pricelist/items) - the
// partial-update path: revise just this one item's price/terms without
// re-uploading (and thereby auto-deactivating the rest of) the whole
// supplier catalog the way a full xlsx upload does.
function EditRateDialog({ item, userName, onClose, onDone }: { item: any; userName: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    price: item.price ?? "", price_qty: item.price_qty ?? 1, discount_pct: item.discount_pct ?? 0,
    gst_pct: item.gst_pct ?? "", gst_included: item.gst_included || "NO", price_status: item.price_status || "PRICED",
    valid_from: item.valid_from || "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const onRequest = f.price_status === "ON_REQUEST";
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/purchase/pricelist/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, sku_key: item.sku_key, userName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      onDone();
    } catch (e: any) {
      setErr(e.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-24 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-1">
          <div className="text-sm font-black text-slate-800">Edit Rate — {item.sku_key}</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><FiX /></button>
        </div>
        <div className="text-[11px] text-slate-500 mb-3">{itemLabel(item)}</div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Price status
            <select className={editInp} value={f.price_status} onChange={set("price_status")}>
              <option value="PRICED">PRICED</option>
              <option value="ON_REQUEST">ON_REQUEST</option>
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Valid from
            <input className={editInp} type="date" value={f.valid_from} onChange={set("valid_from")} />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {`Price${onRequest ? "" : " *"}`}
            <input className={editInp} type="number" step="0.01" min="0" value={f.price} onChange={set("price")} disabled={onRequest} />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Price qty
            <input className={editInp} type="number" step="any" min="0" value={f.price_qty} onChange={set("price_qty")} />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Discount %
            <input className={editInp} type="number" step="0.01" min="0" max="100" value={f.discount_pct} onChange={set("discount_pct")} />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {`GST %${onRequest ? "" : " *"}`}
            <input className={editInp} type="number" step="any" min="0" value={f.gst_pct} onChange={set("gst_pct")} />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 col-span-2">
            GST included in price
            <select className={editInp} value={f.gst_included} onChange={set("gst_included")}>
              <option value="NO">NO</option>
              <option value="YES">YES</option>
            </select>
          </label>
        </div>
        {err && <div className="text-xs text-rose-600 mt-2">{err}</div>}
        <button
          disabled={saving}
          onClick={save}
          className="mt-4 w-full py-2 rounded-lg bg-orange-500 text-white text-xs font-black uppercase tracking-wider disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function TagDialog({ skus, user, onClose, onDone }: { skus: string[]; user: PricelistUser; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<{ name: string; source: string }[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (value.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/purchase/pricelist/tags/suggest?q=${encodeURIComponent(value)}`);
        const data = await res.json();
        setSuggestions(data.suggestions || []);
      } catch {
        setSuggestions([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [value]);

  const toggleChecked = (name: string) =>
    setChecked((prev) => {
      const n = new Set(prev);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  const allChecked = suggestions.length > 0 && suggestions.every((s) => checked.has(s.name));
  const toggleAll = () =>
    setChecked((prev) => {
      const n = new Set(prev);
      suggestions.forEach((s) => (allChecked ? n.delete(s.name) : n.add(s.name)));
      return n;
    });

  const save = async () => {
    // The text box is a search/filter for the list below. It is only used as the tag name when nothing is ticked.
    const names = new Set(checked);
    if (names.size === 0 && value.trim()) names.add(value.trim());
    if (names.size === 0) return;
    setSaving(true);
    setErr("");
    try {
      for (const name of names) {
        const res = await fetch("/api/purchase/pricelist/tags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag_name: name, sku_keys: skus, userName: user.username }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Failed to add "${name}"`);
      }
      onDone();
    } catch (e: any) {
      setErr(e.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-24 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <div className="text-sm font-black text-slate-800">Tag {skus.length > 1 ? `${skus.length} items` : skus[0]}</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><FiX /></button>
        </div>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="Item name, e.g. Ball Pein Hammer 500 gm"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
        />
        {suggestions.length > 0 && (
          <div className="mt-2 border border-slate-200 rounded-lg max-h-56 overflow-auto">
            <label className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500 bg-slate-50 border-b border-slate-100 cursor-pointer sticky top-0">
              <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              All ({suggestions.length})
            </label>
            {suggestions.map((s) => (
              <label key={s.source + s.name} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-orange-50 cursor-pointer">
                <input type="checkbox" checked={checked.has(s.name)} onChange={() => toggleChecked(s.name)} />
                <span className="flex-1">{s.name}</span>
                <span className="text-[9px] uppercase font-bold text-slate-400">{s.source === "tag" ? "tag" : "bid item"}</span>
              </label>
            ))}
          </div>
        )}
        {checked.size > 0 && (
          <div className="mt-2 text-[10px] font-bold text-orange-700">{checked.size} tag{checked.size > 1 ? "s" : ""} selected</div>
        )}
        {err && <div className="text-xs text-rose-600 mt-2">{err}</div>}
        <button
          disabled={saving || (checked.size === 0 && !value.trim())}
          onClick={save}
          className="mt-4 w-full py-2 rounded-lg bg-orange-500 text-white text-xs font-black uppercase tracking-wider disabled:opacity-40"
        >
          Add tag{checked.size > 1 ? "s" : ""}
        </button>
      </div>
    </div>
  );
}

function SearchBody({ user }: { user: PricelistUser }) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [brand, setBrand] = useState("");
  const [supplier, setSupplier] = useState("");
  const [category, setCategory] = useState("");
  const [tagged, setTagged] = useState("all");
  const [tag, setTag] = useState("");
  const [inactive, setInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>({ items: [], total: 0, pageSize: 50 });
  const [facets, setFacets] = useState<any>({ brands: [], suppliers: [], categories: [] });
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagTarget, setTagTarget] = useState<string[] | null>(null);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const sp = new URLSearchParams({ q: debouncedQ, brand, supplier, category, tagged, tag, page: String(page) });
      if (inactive) sp.set("inactive", "1");
      if (id === 1) sp.set("facets", "1");
      const res = await fetch(`/api/purchase/pricelist/items?${sp}`);
      const json = await res.json();
      if (id !== reqId.current) return;
      if (json.facets) setFacets(json.facets);
      setData(json);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [debouncedQ, brand, supplier, category, tagged, tag, inactive, page]);
  useEffect(() => {
    load();
  }, [load]);

  const removeTag = async (id: string) => {
    if (!confirm("Remove this tag from the item?")) return;
    await fetch(`/api/purchase/pricelist/tags?id=${id}`, { method: "DELETE" });
    load();
  };
  const toggle = (sku: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(sku) ? n.delete(sku) : n.add(sku);
      return n;
    });
  const items: any[] = data.items || [];
  const allOnPage = items.length > 0 && items.every((i) => selected.has(i.sku_key));
  const pages = Math.max(1, Math.ceil((data.total || 0) / (data.pageSize || 50)));
  const sel = "border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white";

  const chips = (i: any) => (
    <div className="flex flex-wrap gap-1 items-center">
      {i.tags.map((t: any) => (
        <span key={t._id} className="inline-flex items-center gap-1 bg-orange-50 text-orange-700 border border-orange-200 rounded-full pl-2 pr-1 py-0.5 text-[10px] font-bold">
          <button onClick={() => { setTag(t.tag_key); setPage(1); }} title="Show all items with this tag">{t.tag_name}</button>
          {user.isAdmin && <button onClick={() => removeTag(t._id)} className="hover:text-rose-600"><FiX size={10} /></button>}
        </span>
      ))}
      <button onClick={() => setTagTarget([i.sku_key])} className="inline-flex items-center gap-0.5 text-[10px] font-bold text-blue-600 hover:underline"><FiPlus size={10} /> Tag</button>
    </div>
  );

  return (
    <div>
      <div className="relative mb-3">
        <FiSearch className="absolute left-3 top-3 text-slate-400" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search: hammer 500 handle"
          className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
        />
      </div>
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <select className={sel} value={brand} onChange={(e) => { setBrand(e.target.value); setPage(1); }}>
          <option value="">All brands</option>
          {facets.brands.map((b: string) => <option key={b}>{b}</option>)}
        </select>
        <select className={sel} value={supplier} onChange={(e) => { setSupplier(e.target.value); setPage(1); }}>
          <option value="">All suppliers</option>
          {facets.suppliers.map((b: string) => <option key={b}>{b}</option>)}
        </select>
        <select className={sel} value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
          <option value="">All categories</option>
          {facets.categories.map((b: string) => <option key={b}>{b}</option>)}
        </select>
        <select className={sel} value={tagged} onChange={(e) => { setTagged(e.target.value); setPage(1); }}>
          <option value="all">Tagged + untagged</option>
          <option value="tagged">Tagged</option>
          <option value="untagged">Untagged</option>
        </select>
        <label className="text-xs font-bold text-slate-600 flex items-center gap-1">
          <input type="checkbox" checked={inactive} onChange={(e) => { setInactive(e.target.checked); setPage(1); }} /> Show inactive
        </label>
        {tag && (
          <button onClick={() => setTag("")} className="text-[11px] font-bold bg-orange-100 text-orange-700 rounded-full px-2 py-1 flex items-center gap-1">
            tag: {tag} <FiX size={11} />
          </button>
        )}
        <div className="ml-auto text-xs font-bold text-slate-500">{loading ? "Searching…" : `${data.total} result(s)`}</div>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 text-xs">
          <span className="font-bold">{selected.size} selected</span>
          <button onClick={() => setTagTarget(Array.from(selected))} className="font-black text-orange-700 uppercase tracking-wider">Tag selected</button>
          <button onClick={() => setSelected(new Set())} className="text-slate-500">Clear</button>
        </div>
      )}

      {/* desktop table */}
      <div className="hidden md:block bg-white rounded-2xl border border-slate-200 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="p-2 w-8"><input type="checkbox" checked={allOnPage} onChange={() => setSelected((p) => { const n = new Set(p); items.forEach((i) => (allOnPage ? n.delete(i.sku_key) : n.add(i.sku_key))); return n; })} /></th>
              <th className="p-2 text-left">SKU</th><th className="p-2 text-left">Item</th><th className="p-2">Unit</th>
              <th className="p-2 text-right">Price</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Disc %</th><th className="p-2 text-right">GST %</th>
              <th className="p-2 text-right">Incl. GST</th><th className="p-2">Brand</th><th className="p-2 text-left">Tags</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i._id} className={`border-t border-slate-100 align-top ${i.is_active ? "" : "opacity-50"}`}>
                <td className="p-2"><input type="checkbox" checked={selected.has(i.sku_key)} onChange={() => toggle(i.sku_key)} /></td>
                <td className="p-2 text-[10px] text-slate-400 whitespace-nowrap">{i.sku_key}{!i.is_active && <div className="text-rose-500 font-bold">inactive</div>}</td>
                <td className="p-2 font-medium text-slate-800">{itemLabel(i)}</td>
                <td className="p-2 text-center">{i.unit}</td>
                <td className="p-2 text-right whitespace-nowrap">
                  {i.price_status === "ON_REQUEST" ? "On request" : inr(i.price)}
                  <button onClick={() => setEditTarget(i)} title="Edit rate" className="ml-1.5 text-slate-400 hover:text-blue-600 align-middle">
                    <FiEdit2 size={10} />
                  </button>
                </td>
                <td className="p-2 text-right">{i.price_qty}</td>
                <td className="p-2 text-right">{i.discount_pct || 0}</td>
                <td className="p-2 text-right">{i.gst_pct ?? "—"}</td>
                <td className="p-2 text-right font-black text-slate-900 whitespace-nowrap">{inr(i.unit_price_incl_gst)}</td>
                <td className="p-2 text-center"><span className="px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold">{i.brand || "—"}</span></td>
                <td className="p-2 min-w-[180px]">{chips(i)}</td>
              </tr>
            ))}
            {items.length === 0 && !loading && <tr><td colSpan={11} className="p-8 text-center text-slate-400">No items found</td></tr>}
          </tbody>
        </table>
      </div>

      {/* mobile cards */}
      <div className="md:hidden space-y-3">
        {items.map((i) => (
          <div key={i._id} className={`bg-white rounded-xl border border-slate-200 p-3 ${i.is_active ? "" : "opacity-50"}`}>
            <div className="flex justify-between gap-2">
              <div className="text-[10px] text-slate-400">{i.sku_key}</div>
              <input type="checkbox" checked={selected.has(i.sku_key)} onChange={() => toggle(i.sku_key)} />
            </div>
            <div className="text-sm font-bold text-slate-800 my-1">{itemLabel(i)}</div>
            <div className="flex justify-between items-center text-xs">
              <span className="px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold">{i.brand || "—"}</span>
              <span>{i.unit} · GST {i.gst_pct ?? "—"}%</span>
              <span className="font-black text-base flex items-center gap-1">
                {inr(i.unit_price_incl_gst)}
                <button onClick={() => setEditTarget(i)} title="Edit rate" className="text-slate-400 hover:text-blue-600">
                  <FiEdit2 size={11} />
                </button>
              </span>
            </div>
            <div className="mt-2">{chips(i)}</div>
          </div>
        ))}
      </div>

      <div className="flex justify-between items-center mt-4 text-xs font-bold text-slate-600">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded border border-slate-300 disabled:opacity-40">Prev</button>
        <span>Page {page} / {pages}</span>
        <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded border border-slate-300 disabled:opacity-40">Next</button>
      </div>

      {tagTarget && (
        <TagDialog skus={tagTarget} user={user} onClose={() => setTagTarget(null)} onDone={() => { setTagTarget(null); setSelected(new Set()); load(); }} />
      )}
      {editTarget && (
        <EditRateDialog
          item={editTarget}
          userName={user.username}
          onClose={() => setEditTarget(null)}
          onDone={() => { setEditTarget(null); load(); }}
        />
      )}
    </div>
  );
}

export default function PricelistSearchPage() {
  return <PricelistShell active="search">{(user) => <SearchBody user={user} />}</PricelistShell>;
}
