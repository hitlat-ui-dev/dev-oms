"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { FiChevronDown, FiChevronRight } from "react-icons/fi";
import PricelistShell, { PricelistUser } from "@/components/purchase/pricelist/PricelistShell";

const inr = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const itemLabel = (i: any) => [i.category, i.sub_type, i.model_no, i.size_spec, i.variant].filter(Boolean).join(" · ");

function TagsBody({ user }: { user: PricelistUser }) {
  const [tags, setTags] = useState<any[]>([]);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [links, setLinks] = useState<any[]>([]);

  const load = useCallback(async () => {
    const res = await fetch("/api/purchase/pricelist/tags/summary");
    const data = await res.json();
    setTags(data.tags || []);
  }, []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const expand = async (key: string) => {
    if (open === key) return setOpen(null);
    setOpen(key);
    setLinks([]);
    const res = await fetch(`/api/purchase/pricelist/tags/summary?tag_key=${encodeURIComponent(key)}`);
    const data = await res.json();
    setLinks(data.links || []);
  };
  const call = async (url: string, init: RequestInit) => {
    const res = await fetch(url, init);
    const data = await res.json();
    if (!res.ok) alert(data.error || "Failed");
    await load();
    return res.ok;
  };
  const rename = async (t: any) => {
    const name = prompt("Rename tag", t.tag_name);
    if (name && name.trim() && name !== t.tag_name) {
      await call("/api/purchase/pricelist/tags/rename", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag_key: t.tag_key, new_name: name }) });
      setOpen(null);
    }
  };
  const merge = async (t: any) => {
    const target = prompt(`Merge "${t.tag_name}" into which existing tag? (type its exact name)`);
    const to = tags.find((x) => x.tag_name.toLowerCase() === (target || "").trim().toLowerCase());
    if (!target) return;
    if (!to) return alert("No tag with that name");
    await call("/api/purchase/pricelist/tags/merge", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from_key: t.tag_key, to_key: to.tag_key }) });
    setOpen(null);
  };
  const del = async (t: any) => {
    if (!confirm(`Delete tag "${t.tag_name}" and its ${t.count} link(s)?`)) return;
    await call(`/api/purchase/pricelist/tags?tag_key=${encodeURIComponent(t.tag_key)}`, { method: "DELETE" });
    setOpen(null);
  };
  const unlink = async (id: string, key: string) => {
    await call(`/api/purchase/pricelist/tags?id=${id}`, { method: "DELETE" });
    setLinks((l) => l.filter((x) => x.id !== id));
    if (open === key) setOpen(key);
  };

  const shown = tags.filter((t) => t.tag_name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div>
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter tags…" className="mb-3 w-full md:w-80 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      <div className="bg-white rounded-2xl border border-slate-200 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr><th className="w-8" /><th className="p-2 text-left">Tag</th><th className="p-2 text-right">Items</th><th className="p-2 text-left">Brands</th><th className="p-2 text-right">Lowest incl. GST</th><th className="p-2" /></tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <Fragment key={t.tag_key}>
                <tr className="border-t border-slate-100">
                  <td className="p-2 cursor-pointer" onClick={() => expand(t.tag_key)}>{open === t.tag_key ? <FiChevronDown /> : <FiChevronRight />}</td>
                  <td className="p-2 font-bold text-slate-800">{t.tag_name}</td>
                  <td className="p-2 text-right">{t.count}</td>
                  <td className="p-2">{t.brands.join(", ") || "—"}</td>
                  <td className="p-2 text-right font-black text-orange-600">{inr(t.lowest)}</td>
                  <td className="p-2 text-right whitespace-nowrap">
                    {user.isAdmin ? (
                      <>
                        <button onClick={() => rename(t)} className="text-blue-600 hover:underline mr-3">Rename</button>
                        <button onClick={() => merge(t)} className="text-blue-600 hover:underline mr-3">Merge</button>
                        <button onClick={() => del(t)} className="text-rose-600 hover:underline">Delete</button>
                      </>
                    ) : null}
                  </td>
                </tr>
                {open === t.tag_key && (
                  <tr className="bg-slate-50">
                    <td />
                    <td colSpan={5} className="p-3">
                      {links.length === 0 && <div className="text-slate-400">Loading…</div>}
                      {links.map((l) => (
                        <div key={l.id} className="flex justify-between gap-3 py-1 border-b border-slate-100 last:border-0">
                          <span><span className="text-slate-400 text-[10px] mr-2">{l.item.sku_key}</span>{itemLabel(l.item)} <b className="ml-2">{l.item.brand}</b>{l.item.is_active === false && <i className="ml-2 text-rose-500">inactive</i>}</span>
                          <span className="whitespace-nowrap">
                            <b>{inr(l.item.unit_price_incl_gst)}</b>
                            {user.isAdmin && <button onClick={() => unlink(l.id, t.tag_key)} className="ml-3 text-rose-600 hover:underline">Remove</button>}
                          </span>
                        </div>
                      ))}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {shown.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-400">No tags yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PricelistTagsPage() {
  return <PricelistShell active="tags">{(user) => <TagsBody user={user} />}</PricelistShell>;
}
