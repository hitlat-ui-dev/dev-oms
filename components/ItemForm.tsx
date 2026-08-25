"use client";
import { useState, useEffect } from "react";
import {
  FiBox, FiTag, FiSave, FiPlus, FiHash,
  FiLayers, FiCheckCircle, FiX, FiMapPin, FiLock, FiPackage
} from "react-icons/fi";
import BlockGuard from "./BlockGuard";
import Link from "next/link";

interface ItemFormProps {
  onSuccess?: () => void;
  initialData?: any;
}

export default function ItemForm({ onSuccess, initialData }: ItemFormProps) {
  // Item Name/SKU/Category/Unit identify WHICH item this is - every order,
  // purchase request, and stock history entry across the app resolves back
  // to this record by sku, so changing them here on an existing item would
  // silently detach it from all of that instead of updating it. Locked once
  // editing; still freely set when first creating the item.
  const isEditing = !!initialData?._id;
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [categories, setCategories] = useState<{ _id: string; name: string }[]>([]);
  const [units, setUnits] = useState<{ _id: string; name: string }[]>([]);
  const [variantGroups, setVariantGroups] = useState<{ group: string; sampleName: string; count: number }[]>([]);
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  // Quick-add modal states
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showUnitModal, setShowUnitModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [currentUsername, setCurrentUsername] = useState("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("oms_user");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.username) setCurrentUsername(parsed.username);
      }
    } catch (err) {
      console.error("Failed to read logged-in user", err);
    }
  }, []);

  const [formData, setFormData] = useState({
    itemName: "",
    category: "",
    currentStock: 0,
    reQty: 0,
    unit: "",
    sku: "Loading...",
    location: "",
    rateDisplay: 0,
    itemId: "", // <--- ADD THIS
    hsnSac: "",
    gstPercent: 0,
    variantGroup: "",
    variantLabel: ""
  });

  useEffect(() => {
    if (initialData) {
      setFormData({
        itemName: initialData.itemName || "",
        sku: initialData.sku || "",
        category: initialData.category || "GENERAL",
        unit: initialData.unit || "PCS",
        currentStock: initialData.currentStock || 0,
        reQty: initialData.reQty ?? initialData.totalQty ?? 0,
        location: initialData.location || "---",
        rateDisplay: initialData.rateDisplay || "₹ 0",
        itemId: initialData.itemId || "", // <--- ADD THIS
        hsnSac: initialData.hsnSac || "",
        gstPercent: initialData.gstPercent || 0,
        variantGroup: initialData.variantGroup || "",
        variantLabel: initialData.variantLabel || ""
      });
    }
  }, [initialData]);


  // Fetch Initial Data
  const fetchData = async () => {
    try {
      const [itemRes, catRes, unitRes, groupRes] = await Promise.all([
        fetch("/api/items"),
        fetch("/api/categories"),
        fetch("/api/units"),
        fetch("/api/variant-groups")
      ]);

      const itemData = await itemRes.json();
      const catData = await catRes.json();
      const unitData = await unitRes.json();
      const groupData = await groupRes.json();

      setFormData(prev => ({ ...prev, sku: itemData.nextSku || "S1100" }));
      setCategories(catData);
      setUnits(unitData);
      setVariantGroups(Array.isArray(groupData) ? groupData : []);
    } catch (error) {
      console.error("Error fetching form data:", error);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // Handle Quick Add for Category/Unit
  const handleQuickAdd = async (type: "category" | "unit") => {
    if (!newName) return;
    const endpoint = type === "category" ? "/api/categories" : "/api/units";

    const res = await fetch(endpoint, {
      method: "POST",
      body: JSON.stringify({ name: newName }),
      headers: { "Content-Type": "application/json" }
    });

    if (res.ok) {
      setNewName("");
      setShowCategoryModal(false);
      setShowUnitModal(false);
      fetchData(); // Refresh dropdowns
    }
  };

  // Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const isEditing = !!initialData?._id;
    const url = isEditing ? `/api/items/${initialData._id}` : "/api/items";

    const method = isEditing ? "PATCH" : "POST";

    // Create a clean object with ONLY the fields you want to update
    const payload = isEditing
      ? {
        itemId: formData.itemId,
        itemName: formData.itemName,
        category: formData.category,
        unit: formData.unit,
        location: formData.location,
        sku: formData.sku,
        hsnSac: formData.hsnSac,
        gstPercent: formData.gstPercent,
        variantGroup: formData.variantGroup,
        variantLabel: formData.variantLabel
      }
      : formData;

    try {
      console.log("Step 1: Sending data to server...", formData);
      const res = await fetch(url, {
        method: method,
        // createdBy is only sent on create — an edit shouldn't reassign authorship
        body: JSON.stringify(isEditing ? formData : { ...formData, createdBy: currentUsername }),
        headers: { "Content-Type": "application/json" }
      });
const result = await res.json();
      if (res.ok) {
        console.log("Step 2: Success! Server response:", result);
        setStatus("Update Successful!");
        if (onSuccess) setTimeout(() => onSuccess(), 1000);
      }else {
            // Step 3: This will now work because 'result' is defined above
            console.error("Step 2: Server Error Details ->", result);
            
            // This alert shows the exact error message from the server
            alert(`Server Error (Status ${res.status}): ${result.error || "Unknown Error"}`);
        }
    } catch (err: any) {
      console.error("Step 2: Network Error ->", err);
        alert("Network Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <BlockGuard
      permission="addNewItem"
      fallback={
        <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50">
          <p className="text-red-500 font-bold uppercase">You have no Access for this Page.</p>
          <Link
            href="/dashboard"
            className="text-sm bg-slate-900 text-white px-4 mt-4 py-2 rounded-lg hover:bg-slate-800 transition-all"
          >
            Go to Dashboard
          </Link>
        </div>
      }
    >
      <div className="space-y-8">
        {status && (
          <div className="bg-emerald-50 text-emerald-600 p-4 rounded-xl flex items-center gap-3 font-bold text-sm border border-emerald-100 animate-in fade-in slide-in-from-top-2">
            <FiCheckCircle className="shrink-0" /> {status}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">

          {isEditing ? (
            // Edit mode: identity fields (name/SKU/category/unit/opening
            // stock) can't actually change here - every order and stock
            // history entry resolves to this item by them, and Opening
            // Stock specifically was never even wired to save from this
            // form (real quantity changes only happen via Purchase
            // Received / order fulfillment). Shown as a flat info strip
            // instead of disabled-but-still-input-shaped fields, so it
            // reads as "this is what the item is", not "half this form is
            // broken".
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
              <div className="flex items-center gap-1.5 text-slate-400 mb-4">
                <FiLock size={11} />
                <span className="text-[10px] font-black uppercase tracking-widest">Item Identity — locked</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="col-span-2 space-y-1">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Item Name</span>
                  <div className="flex items-center gap-2 font-bold text-slate-700 text-sm">
                    <FiBox className="text-slate-400 shrink-0" size={14} />
                    <span className="truncate">{formData.itemName}</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">SKU</span>
                  <div className="flex items-center gap-2 font-black text-blue-600 text-sm tracking-widest">
                    <FiHash className="text-blue-300 shrink-0" size={14} />
                    {formData.sku}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Category</span>
                  <div className="font-bold text-slate-700 text-sm truncate">{formData.category}</div>
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Unit</span>
                  <div className="font-bold text-slate-700 text-sm">{formData.unit}</div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-200 flex items-center gap-2">
                <FiPackage className="text-slate-400 shrink-0" size={14} />
                <span className="text-[10px] font-bold text-slate-500">
                  Opening stock was <span className="text-slate-700">{formData.currentStock}</span> — quantity now updates via Purchase Received / Order flows, not here.
                </span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Item Name */}
              <div className="space-y-2 md:col-span-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Item Name</label>
                <div className="relative">
                  <FiBox className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text" required value={formData.itemName}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-blue-500/5 transition-all"
                    placeholder="Enter product name"
                    onChange={(e) => setFormData({ ...formData, itemName: e.target.value })}
                  />
                </div>
              </div>

              {/* SKU Number */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">SKU Number</label>
                <div className="h-[60px] flex items-center gap-3 px-6 bg-slate-100 border border-dashed border-slate-300 rounded-2xl">
                  <FiHash className="text-slate-400" />
                  <span className="font-black text-blue-600 tracking-widest">{formData.sku}</span>
                </div>
              </div>

              {/* Category */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Category</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <select
                      required value={formData.category}
                      className="w-full pl-4 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl appearance-none font-bold text-sm text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/5 transition-all"
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    >
                      <option value="">Category</option>
                      {categories.map(c => <option key={c._id} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCategoryModal(true)}
                    className="p-4 bg-blue-600 text-white rounded-2xl hover:scale-105 active:scale-95 transition-all shadow-lg shadow-blue-200"
                  >
                    <FiPlus size={24} />
                  </button>
                </div>
              </div>

              {/* Unit */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Unit</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <select
                      required value={formData.unit}
                      className="w-full pl-4 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl appearance-none font-bold text-sm text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/5 transition-all"
                      onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    >
                      <option value="">Unit</option>
                      {units.map(u => <option key={u._id} value={u.name}>{u.name}</option>)}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowUnitModal(true)}
                    className="p-4 bg-emerald-600 text-white rounded-2xl hover:scale-105 active:scale-95 transition-all shadow-lg shadow-emerald-200"
                  >
                    <FiPlus size={24} />
                  </button>
                </div>
              </div>

              {/* Current Stock */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Opening Stock</label>
                <div className="relative">
                  <input
                    type="number"
                    required
                    min="0"
                    value={formData.currentStock}
                    className="w-full pl-4 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-sm text-slate-700 focus:ring-4 focus:ring-blue-500/5 transition-all"
                    placeholder="0"
                    onChange={(e) => setFormData({ ...formData, currentStock: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Item Location */}
            <div className="space-y-2 md:col-span-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Item Location</label>
              <div className="relative">
                <FiMapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={formData.location}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-blue-500/5 transition-all"
                  placeholder="Warehouse Shelf, Rack No, etc. (Optional)"
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                />
              </div>
            </div>

            {/* Variant Group - links this item with its color/size siblings
                (e.g. "White Board Marker" Green/Red/Blue/Black) without
                merging their stock - each still keeps its own SKU/quantity. */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                Variant Group <span className="text-slate-400 font-normal lowercase">(optional)</span>
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={formData.variantGroup}
                  className="flex-1 min-w-0 pl-4 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl appearance-none font-bold text-sm text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/5 transition-all"
                  onChange={(e) => setFormData({ ...formData, variantGroup: e.target.value })}
                >
                  <option value="">Not a variant</option>
                  {variantGroups.map((g) => (
                    <option key={g.group} value={g.group}>{g.sampleName} ({g.count})</option>
                  ))}
                  {formData.variantGroup && !variantGroups.some((g) => g.group === formData.variantGroup) && (
                    <option value={formData.variantGroup}>{formData.variantGroup}</option>
                  )}
                </select>
                <button
                  type="button"
                  onClick={() => setShowAddGroup((v) => !v)}
                  title="Start a new variant group"
                  className="shrink-0 p-4 bg-slate-100 text-slate-500 rounded-2xl hover:bg-slate-200 transition-all"
                >
                  <FiPlus size={20} />
                </button>
              </div>
              {showAddGroup && (
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    autoFocus
                    placeholder="New group name, e.g. WHITE BOARD MARKER"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    className="flex-1 min-w-0 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-xs text-slate-700 focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const trimmed = newGroupName.trim();
                      if (!trimmed) return;
                      setFormData({ ...formData, variantGroup: trimmed });
                      setNewGroupName("");
                      setShowAddGroup(false);
                    }}
                    className="shrink-0 text-[10px] font-black uppercase tracking-widest text-blue-600 hover:text-blue-700 border border-blue-200 rounded-xl px-3 py-3"
                  >
                    Use
                  </button>
                </div>
              )}
            </div>

            {formData.variantGroup && (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                  Variant Label <span className="text-slate-400 font-normal lowercase">(e.g. "Green", "6x42 MM")</span>
                </label>
                <div className="relative">
                  <FiTag className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={formData.variantLabel}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-blue-500/5 transition-all"
                    placeholder="This item's own color/size"
                    onChange={(e) => setFormData({ ...formData, variantLabel: e.target.value })}
                  />
                </div>
              </div>
            )}

            {/* HSN/SAC (billing) */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                HSN/SAC <span className="text-slate-400 font-normal lowercase">(for Tax Invoice)</span>
              </label>
              <div className="relative">
                <FiHash className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={formData.hsnSac}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-blue-500/5 transition-all"
                  placeholder="E.G. 8471"
                  onChange={(e) => setFormData({ ...formData, hsnSac: e.target.value })}
                />
              </div>
            </div>

            {/* GST% (billing) */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                GST % <span className="text-slate-400 font-normal lowercase">(for Tax Invoice)</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0" max="28" step="0.1"
                  value={formData.gstPercent}
                  className="w-full pl-4 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-sm text-slate-700 focus:ring-4 focus:ring-blue-500/5 transition-all"
                  placeholder="18"
                  onChange={(e) => setFormData({ ...formData, gstPercent: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#0f172a] hover:bg-slate-800 text-white font-black py-5 rounded-2xl shadow-xl flex items-center justify-center gap-3 transition-all uppercase tracking-[0.2em] text-xs disabled:opacity-70"
          >
            <FiSave size={18} /> {loading ? (isEditing ? "Saving..." : "Registering...") : (isEditing ? "Save Changes" : "Save New Item")}
          </button>
        </form>

        {/* Internal Popups for Categories/Units */}
        {(showCategoryModal || showUnitModal) && (
          <div className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl border border-slate-200">
              <div className="bg-[#0f172a] p-6 text-white flex justify-between items-center">
                <h3 className="font-black uppercase tracking-widest text-[10px]">
                  Add New {showCategoryModal ? "Category" : "Unit"}
                </h3>
                <button
                  onClick={() => { setShowCategoryModal(false); setShowUnitModal(false); setNewName("") }}
                  className="text-white/60 hover:text-white"
                >
                  <FiX size={20} />
                </button>
              </div>
              <div className="p-8 space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Name</label>
                  <input
                    type="text"
                    value={newName}
                    autoFocus
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:border-blue-500"
                    placeholder="Type name here..."
                  />
                </div>
                <button
                  onClick={() => handleQuickAdd(showCategoryModal ? "category" : "unit")}
                  className={`w-full py-4 rounded-2xl font-black text-white uppercase tracking-widest text-[10px] transition-all shadow-lg ${showCategoryModal ? 'bg-blue-600 shadow-blue-100' : 'bg-emerald-600 shadow-emerald-100'
                    }`}
                >
                  Save {showCategoryModal ? "Category" : "Unit"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </BlockGuard>
  );
}