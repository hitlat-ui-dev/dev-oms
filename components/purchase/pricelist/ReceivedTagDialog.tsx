"use client";
import { useEffect, useState } from "react";
import { FiX } from "react-icons/fi";

// Tag a Received Purchase item with a bid item name. Suggestions = existing received tags + bid item names.
export default function ReceivedTagDialog({
  itemName,
  skus,
  userName,
  onClose,
  onDone,
}: {
  itemName: string;
  skus: string[];
  userName: string;
  onClose: () => void;
  onDone: () => void;
}) {
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
        const res = await fetch(`/api/purchase/pricelist/tags/suggest?scope=received&q=${encodeURIComponent(value)}`);
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
  const allChecked = suggestions.length > 0 && suggestions.every((x) => checked.has(x.name));
  const toggleAll = () =>
    setChecked((prev) => {
      const n = new Set(prev);
      suggestions.forEach((x) => (allChecked ? n.delete(x.name) : n.add(x.name)));
      return n;
    });

  // Checked suggestions plus whatever is typed in the box: one tag each.
  const save = async () => {
    // The text box is a search/filter for the list below. It is only used as the tag name when nothing is ticked.
    const names = new Set(checked);
    if (names.size === 0 && value.trim()) names.add(value.trim());
    if (names.size === 0) return;
    setSaving(true);
    setErr("");
    try {
      for (const name of names) {
        const res = await fetch("/api/purchase/pricelist/received-tags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag_name: name, skus, userName }),
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
        <div className="flex justify-between items-start mb-3 gap-3">
          <div>
            <div className="text-sm font-black text-slate-800">Tag with bid item name</div>
            <div className="text-[11px] text-slate-500 uppercase">{itemName}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><FiX /></button>
        </div>
        <input
          autoFocus
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="Bid item name, e.g. PVC Elbow 3/4 inch"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
        />
        {suggestions.length > 0 && (
          <div className="mt-2 border border-slate-200 rounded-lg max-h-56 overflow-auto">
            <label className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500 bg-slate-50 border-b border-slate-100 cursor-pointer sticky top-0">
              <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              All ({suggestions.length})
            </label>
            {suggestions.map((s) => (
              <label key={s.source + s.name} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-emerald-50 cursor-pointer">
                <input type="checkbox" checked={checked.has(s.name)} onChange={() => toggleChecked(s.name)} />
                <span className="flex-1">{s.name}</span>
                <span className="text-[9px] uppercase font-bold text-slate-400">{s.source === "tag" ? "tag" : "bid item"}</span>
              </label>
            ))}
          </div>
        )}
        {checked.size > 0 && (
          <div className="mt-2 text-[10px] font-bold text-emerald-700">{checked.size} tag{checked.size > 1 ? "s" : ""} selected</div>
        )}
        {err && <div className="text-xs text-rose-600 mt-2">{err}</div>}
        <button
          disabled={saving || (checked.size === 0 && !value.trim())}
          onClick={save}
          className="mt-4 w-full py-2 rounded-lg bg-emerald-600 text-white text-xs font-black uppercase tracking-wider disabled:opacity-40"
        >
          Add tag{checked.size > 1 ? "s" : ""}
        </button>
      </div>
    </div>
  );
}
