"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FiPlus, FiTrash2 } from "react-icons/fi";
import PricelistShell, { PricelistUser } from "@/components/purchase/pricelist/PricelistShell";
import { DENSITIES } from "@/lib/metalConfig";

// Metal Calculator's own material names always get a row here (even with
// no rate saved yet) so this page doubles as "set a rate for every
// material the calculator knows about". Any other name typed into Add
// Material is a free-form extra row - useful for a rate reference even
// though the calculator itself has no density for it, so can't weigh it.
const CALCULATOR_MATERIALS = Object.keys(DENSITIES);

interface MaterialRate {
  name: string;
  rate: number | null;
  unit: string;
  remark: string;
}

function MaterialsBody({ user }: { user: PricelistUser }) {
  const [rows, setRows] = useState<Record<string, MaterialRate>>({});
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, { rate: string; unit: string; remark: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/purchase/pricelist/materials");
    const data = await res.json();
    const byName: Record<string, MaterialRate> = {};
    for (const r of data as any[]) byName[r.name] = { name: r.name, rate: r.rate ?? null, unit: r.unit || "", remark: r.remark || "" };
    setRows(byName);
    setLoading(false);
  }, []);
  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  // Calculator materials always show, even with nothing saved for them yet -
  // the rest of the list is whatever custom names have been added.
  const allNames = useMemo(() => {
    const names = new Set<string>(CALCULATOR_MATERIALS);
    Object.keys(rows).forEach((n) => names.add(n));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const fieldsFor = (name: string) => {
    const saved = rows[name];
    return edits[name] || { rate: saved?.rate != null ? String(saved.rate) : "", unit: saved?.unit || "", remark: saved?.remark || "" };
  };
  const setField = (name: string, key: "rate" | "unit" | "remark", value: string) =>
    setEdits((prev) => ({ ...prev, [name]: { ...fieldsFor(name), [key]: value } }));

  const save = async (name: string) => {
    const f = fieldsFor(name);
    setSaving(name);
    try {
      const res = await fetch("/api/purchase/pricelist/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, rate: f.rate, unit: f.unit, remark: f.remark, userName: user.username }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setEdits((prev) => {
        const n = { ...prev };
        delete n[name];
        return n;
      });
      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(null);
    }
  };

  const addMaterial = async () => {
    const name = newName.trim();
    if (!name) return;
    if (allNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
      alert("This material is already in the list.");
      return;
    }
    setNewName("");
    setRows((prev) => ({ ...prev, [name]: { name, rate: null, unit: "", remark: "" } }));
  };

  const remove = async (name: string) => {
    if (!confirm(`Remove "${name}" from the Material Rates list?`)) return;
    await fetch(`/api/purchase/pricelist/materials?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    await load();
  };

  if (loading) return <div className="p-8 text-center text-sm text-slate-400">Loading…</div>;

  return (
    <div>
      <p className="text-xs text-slate-500 mb-4">
        Rate per material - shown back inside Metal Calculator next to that material&apos;s weight result. Materials already in Metal
        Calculator (Copper, Cast Iron, Polypropylene, …) always appear below; add any other material&apos;s rate with the box here.
      </p>

      <div className="flex gap-2 mb-4">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addMaterial()}
          placeholder="Add a material not already listed below…"
          className="w-full md:w-80 border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
        <button
          onClick={addMaterial}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-orange-500 text-white text-xs font-black uppercase tracking-wider"
        >
          <FiPlus /> Add
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="p-2 text-left">Material</th>
              <th className="p-2 text-left w-32">Rate</th>
              <th className="p-2 text-left w-32">Unit</th>
              <th className="p-2 text-left">Remark</th>
              <th className="p-2 w-32" />
            </tr>
          </thead>
          <tbody>
            {allNames.map((name) => {
              const f = fieldsFor(name);
              const dirty = !!edits[name];
              const isCustom = !CALCULATOR_MATERIALS.includes(name);
              return (
                <tr key={name} className="border-t border-slate-100">
                  <td className="p-2 font-bold text-slate-800">
                    {name}
                    {!isCustom && <span className="ml-1.5 text-[9px] font-black uppercase text-blue-500">Calculator</span>}
                  </td>
                  <td className="p-2">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={f.rate}
                      onChange={(e) => setField(name, "rate", e.target.value)}
                      placeholder="0"
                      className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      value={f.unit}
                      onChange={(e) => setField(name, "unit", e.target.value)}
                      placeholder="e.g. per kg"
                      className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      value={f.remark}
                      onChange={(e) => setField(name, "remark", e.target.value)}
                      placeholder="Remark"
                      className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs"
                    />
                  </td>
                  <td className="p-2 text-right whitespace-nowrap">
                    {dirty && (
                      <button
                        disabled={saving === name}
                        onClick={() => save(name)}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-40 mr-1"
                      >
                        {saving === name ? "Saving…" : "Save"}
                      </button>
                    )}
                    {isCustom && (
                      <button onClick={() => remove(name)} className="text-rose-500 hover:text-rose-700 p-1.5">
                        <FiTrash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MaterialRatesPage() {
  return <PricelistShell active="materials">{(user) => <MaterialsBody user={user} />}</PricelistShell>;
}
