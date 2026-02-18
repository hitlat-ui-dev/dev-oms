"use client";
import { useState, useEffect } from "react";
import { FiBox, FiTag, FiSave, FiArrowLeft, FiPlus, FiHash, FiLayers, FiCheckCircle, FiX } from "react-icons/fi";
import { useRouter } from "next/navigation";
import PurchaseRequestModal from "@/components/PurchaseRequestModal";

export default function AddItemPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Data State
  const [categories, setCategories] = useState<{_id: string, name: string}[]>([]);
  const [units, setUnits] = useState<{_id: string, name: string}[]>([]);
  
  // Modals state
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showUnitModal, setShowUnitModal] = useState(false);
  const [newName, setNewName] = useState("");

  // Form State
  const [formData, setFormData] = useState({
    itemName: "",
    category: "",
    unit: "",
    sku: "Loading..." 
  });

  // 1. Fetch Initial Data (SKU, Categories, Units)
  const fetchData = async () => {
    const [itemRes, catRes, unitRes] = await Promise.all([
      fetch("/api/items"),
      fetch("/api/categories"),
      fetch("/api/units")
    ]);
    
    const itemData = await itemRes.json();
    const catData = await catRes.json();
    const unitData = await unitRes.json();

    setFormData(prev => ({ ...prev, sku: itemData.nextSku || "S1100" }));
    setCategories(catData);
    setUnits(unitData);
  };

  useEffect(() => { fetchData(); }, []);

  // 2. Handle Quick Add (Category/Unit)
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

  // 3. Final Form Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/items", {
      method: "POST",
      body: JSON.stringify(formData),
      headers: { "Content-Type": "application/json" }
    });
    if (res.ok) {
      setStatus("Item Registered Successfully!");
      setFormData(prev => ({ ...prev, itemName: "", category: "", unit: "" }));
      fetchData(); // Get next SKU
      setTimeout(() => setStatus(""), 3000);
    }
    setLoading(false);
  };

  return (
    <div className="p-4 md:p-12 max-w-4xl mx-auto">
      <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition-colors mb-6 font-bold text-xs uppercase tracking-widest">
        <FiArrowLeft /> Back to Purchase
      </button>

      <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
        {/* Top Banner */}
        <div className="bg-[#0f172a] p-8 text-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
             <div className="p-4 bg-blue-500/20 rounded-2xl text-blue-400">
                <FiBox size={32} />
             </div>
             <div>
                <h1 className="text-2xl font-black uppercase tracking-tight">Add New Item</h1>
                <p className="text-blue-400 text-[10px] font-black tracking-[0.2em] uppercase mt-1">Inventory Management System</p>
             </div>
          </div>
          <div className="bg-white/10 px-6 py-4 rounded-2xl border border-white/20 backdrop-blur-md text-right min-w-36">
            <span className="block text-[10px] font-black uppercase text-blue-300 mb-1 leading-none tracking-widest">Available Stock</span>
            <div className="flex items-baseline justify-end gap-1">
              <span className="text-3xl font-black tracking-tighter">0</span>
              <span className="text-xs font-bold text-blue-400 uppercase">{formData.unit || "unit"}</span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-8">
          {status && (
            <div className="bg-emerald-50 text-emerald-600 p-4 rounded-xl flex items-center gap-3 font-bold text-sm border border-emerald-100">
              <FiCheckCircle /> {status}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Item Name</label>
              <div className="relative">
                <FiBox className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text" required value={formData.itemName}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-blue-500/10"
                  placeholder="Enter Product Name"
                  onChange={(e) => setFormData({...formData, itemName: e.target.value})}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">SKU Number</label>
              <div className="h-16 flex items-center gap-3 px-6 bg-slate-100 border border-dashed border-slate-300 rounded-2xl">
                <FiHash className="text-slate-400" />
                <span className="font-black text-blue-600 tracking-widest">{formData.sku}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Category</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <FiTag className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <select 
                    required value={formData.category}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl appearance-none font-bold text-slate-700 outline-none"
                    onChange={(e) => setFormData({...formData, category: e.target.value})}
                  >
                    <option value="">Select Category</option>
                    {categories.map(c => <option key={c._id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <button type="button" onClick={() => setShowCategoryModal(true)} className="p-4 bg-[#1d63ff] text-white rounded-2xl hover:scale-105 transition-all shadow-lg shadow-blue-200">
                  <FiPlus size={24} />
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Unit</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <FiLayers className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <select 
                    required value={formData.unit}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl appearance-none font-bold text-slate-700 outline-none"
                    onChange={(e) => setFormData({...formData, unit: e.target.value})}
                  >
                    <option value="">Select Unit</option>
                    {units.map(u => <option key={u._id} value={u.name}>{u.name}</option>)}
                  </select>
                </div>
                <button type="button" onClick={() => setShowUnitModal(true)} className="p-4 bg-[#00a86b] text-white rounded-2xl hover:scale-105 transition-all shadow-lg shadow-emerald-200">
                  <FiPlus size={24} />
                </button>
              </div>
            </div>
          </div>

          <button type="submit" disabled={loading} className="w-full bg-[#0f172a] hover:bg-slate-800 text-white font-black py-5 rounded-2xl shadow-xl flex items-center justify-center gap-3 transition-all uppercase tracking-widest text-sm">
            <FiSave size={18} /> {loading ? "Registering..." : "Save New Item"}
          </button>
        </form>
      </div>
      <button onClick={() => setIsModalOpen(true)}>Open Request</button>
    <PurchaseRequestModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />

      {/* MODALS */}
      {(showCategoryModal || showUnitModal) && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="bg-[#0f172a] p-6 text-white flex justify-between items-center">
              <h3 className="font-black uppercase tracking-widest text-sm">Add New {showCategoryModal ? "Category" : "Unit"}</h3>
              <button onClick={() => {setShowCategoryModal(false); setShowUnitModal(false); setNewName("")}} className="text-white/60 hover:text-white"><FiX size={24} /></button>
            </div>
            <div className="p-8 space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Name</label>
                <input type="text" value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold focus:border-blue-500" placeholder="Type here..." />
              </div>
              <button onClick={() => handleQuickAdd(showCategoryModal ? "category" : "unit")} className={`w-full py-4 rounded-2xl font-black text-white uppercase tracking-widest text-xs transition-all ${showCategoryModal ? 'bg-[#1d63ff]' : 'bg-[#00a86b]'}`}>
                Save {showCategoryModal ? "Category" : "Unit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}