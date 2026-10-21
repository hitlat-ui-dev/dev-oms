"use client";
import { useEffect, useState } from "react";
import { FiPlus } from "react-icons/fi";
import AddVendorModal from "@/components/AddVendorModal";

const EMPTY = {
  sku_key: "", category: "", sub_type: "", model_no: "", size_spec: "", variant: "", unit: "Each",
  price: "", price_qty: "1", discount_pct: "", gst_pct: "18", price_type: "LIST", gst_included: "NO",
  price_status: "PRICED", supplier_name: "", brand: "", valid_from: "",
};

const inp = "w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400";
const plusBtn = "shrink-0 w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center";

// Defined at module level: a component declared inside the form re-mounts on every
// keystroke, which drops input focus after a single character.
function L({ t, children, wide }: { t: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block text-[10px] font-bold uppercase tracking-wider text-slate-500 ${wide ? "md:col-span-2" : ""}`}>
      {t}
      {children}
    </label>
  );
}

// Manual single-item entry for the pricelist (admin). Category and supplier come from the
// same master lists as Add Item / Purchase (/api/categories, /api/vendors), with + to create new ones.
export default function ManualItemForm({ userName, onAdded }: { userName: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [categories, setCategories] = useState<{ _id: string; name: string }[]>([]);
  const [vendors, setVendors] = useState<{ _id: string; name: string; place?: string }[]>([]);
  const [newCat, setNewCat] = useState<string | null>(null);
  const [vendorModal, setVendorModal] = useState(false);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const onRequest = f.price_status === "ON_REQUEST";

  useEffect(() => {
    if (!open) return;
    fetch("/api/categories").then((r) => r.json()).then((d) => Array.isArray(d) && setCategories(d)).catch(() => {});
    fetch("/api/vendors").then((r) => r.json()).then((d) => Array.isArray(d) && setVendors(d)).catch(() => {});
  }, [open]);

  const saveCategory = async () => {
    const name = (newCat || "").trim();
    if (!name) return setNewCat(null);
    try {
      const res = await fetch("/api/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const created = await res.json();
      if (!res.ok || !created?.name) throw new Error();
      setCategories((p) => [...p, created]);
      setF((p) => ({ ...p, category: created.name }));
      setNewCat(null);
    } catch {
      alert("Category could not be added (it may already exist)");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/purchase/pricelist/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, userName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMsg({ ok: true, text: `Added ${data.sku_key}` });
      // keep category/supplier/brand/GST so several items can be entered in a row
      setF({ ...EMPTY, category: f.category, supplier_name: f.supplier_name, brand: f.brand, gst_pct: f.gst_pct, gst_included: f.gst_included, price_type: f.price_type, unit: f.unit });
      onAdded();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-700">
        <FiPlus /> Add item manually
      </button>
      {open && (
        <form onSubmit={submit} autoComplete="off" className="mt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <L t="Category *">
              {newCat === null ? (
                <div className="flex gap-2 items-center">
                  <select className={inp} value={f.category} onChange={set("category")} required>
                    <option value="">Category</option>
                    {categories.map((c) => <option key={c._id} value={c.name}>{c.name}</option>)}
                  </select>
                  <button type="button" onClick={() => setNewCat("")} className={plusBtn} title="Add new category"><FiPlus /></button>
                </div>
              ) : (
                <div className="flex gap-2 items-center">
                  <input
                    autoFocus
                    className={inp}
                    value={newCat}
                    onChange={(e) => setNewCat(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveCategory(); } if (e.key === "Escape") setNewCat(null); }}
                    placeholder="New category"
                  />
                  <button type="button" onClick={saveCategory} className="shrink-0 px-2 h-8 rounded-lg bg-emerald-600 text-white text-[10px] font-black">SAVE</button>
                  <button type="button" onClick={() => setNewCat(null)} className="shrink-0 px-2 h-8 rounded-lg bg-slate-200 text-slate-600 text-[10px] font-black">X</button>
                </div>
              )}
            </L>
            <L t="Sub type"><input className={inp} value={f.sub_type} onChange={set("sub_type")} /></L>
            <L t="Model no"><input className={inp} value={f.model_no} onChange={set("model_no")} /></L>
            <L t="Size / spec"><input className={inp} value={f.size_spec} onChange={set("size_spec")} /></L>
            <L t="Variant"><input className={inp} value={f.variant} onChange={set("variant")} /></L>
            <L t="Unit *">
              <select className={inp} value={f.unit} onChange={set("unit")}>{["Each", "Set", "Pair", "Pack", "Kg"].map((u) => <option key={u}>{u}</option>)}</select>
            </L>
            <L t="Price status">
              <select className={inp} value={f.price_status} onChange={set("price_status")}><option value="PRICED">PRICED</option><option value="ON_REQUEST">ON_REQUEST</option></select>
            </L>
            <L t="Price type">
              <select className={inp} value={f.price_type} onChange={set("price_type")}>{["LIST", "MRP", "DEALER", "NET"].map((u) => <option key={u}>{u}</option>)}</select>
            </L>
            <L t={`Price ${onRequest ? "" : "*"}`}><input className={inp} type="number" step="0.01" min="0" value={f.price} onChange={set("price")} disabled={onRequest} required={!onRequest} /></L>
            <L t="Price qty"><input className={inp} type="number" step="any" min="0" value={f.price_qty} onChange={set("price_qty")} /></L>
            <L t="Discount %"><input className={inp} type="number" step="0.01" min="0" max="100" value={f.discount_pct} onChange={set("discount_pct")} /></L>
            <L t="GST % *"><input className={inp} type="number" step="any" min="0" value={f.gst_pct} onChange={set("gst_pct")} required={!onRequest} /></L>
            <L t="GST included in price">
              <select className={inp} value={f.gst_included} onChange={set("gst_included")}><option value="NO">NO</option><option value="YES">YES</option></select>
            </L>
            <L t="Supplier *">
              <div className="flex gap-2 items-center">
                <select className={inp} value={f.supplier_name} onChange={set("supplier_name")} required>
                  <option value="">Select supplier</option>
                  {vendors.map((v) => <option key={v._id} value={v.name}>{v.name}{v.place ? ` — ${v.place}` : ""}</option>)}
                </select>
                <button type="button" onClick={() => setVendorModal(true)} className={plusBtn} title="Add new supplier / vendor"><FiPlus /></button>
              </div>
            </L>
            <L t="Brand"><input className={inp} value={f.brand} onChange={set("brand")} /></L>
            <L t="Valid from"><input className={inp} type="date" value={f.valid_from} onChange={set("valid_from")} /></L>
            <L t="SKU (blank = auto)" wide><input className={inp} value={f.sku_key} onChange={set("sku_key")} placeholder="e.g. JDE-HAMMER-500" autoComplete="off" /></L>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button disabled={busy} className="px-5 py-2 rounded-lg bg-orange-500 text-white text-xs font-black uppercase tracking-wider disabled:opacity-40">
              {busy ? "Adding…" : "Add item"}
            </button>
            {msg && <span className={`text-xs font-bold ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</span>}
          </div>
        </form>
      )}
      <AddVendorModal
        isOpen={vendorModal}
        onClose={() => setVendorModal(false)}
        onCreated={(v) => {
          setVendors((p) => [...p, v]);
          setF((p) => ({ ...p, supplier_name: v.name }));
        }}
      />
    </div>
  );
}
