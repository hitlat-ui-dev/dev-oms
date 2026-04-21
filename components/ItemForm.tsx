"use client";
import { useState, useEffect } from "react";
import { 
  FiBox, FiTag, FiSave, FiPlus, FiHash, 
  FiLayers, FiCheckCircle, FiX, FiMapPin 
} from "react-icons/fi";

interface ItemFormProps {
  onSuccess?: () => void;
}

export default function ItemForm({ onSuccess }: ItemFormProps) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [categories, setCategories] = useState<{ _id: string; name: string }[]>([]);
  const [units, setUnits] = useState<{ _id: string; name: string }[]>([]);
  
  // Quick-add modal states
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showUnitModal, setShowUnitModal] = useState(false);
  const [newName, setNewName] = useState("");

  const [formData, setFormData] = useState({
    itemName: "",
    category: "",
    unit: "",
    sku: "Loading...",
    location: ""
  });

  // Fetch Initial Data
  const fetchData = async () => {
    try {
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
    
    const res = await fetch("/api/items", {
      method: "POST",
      body: JSON.stringify(formData),
      headers: { "Content-Type": "application/json" }
    });

    if (res.ok) {
      setStatus("Item Registered Successfully!");
      setFormData({
        itemName: "",
        category: "",
        unit: "",
        sku: "Loading...",
        location: ""
      });
      fetchData(); // Get next SKU
      if (onSuccess) onSuccess(); 
      setTimeout(() => setStatus(""), 3000);
    }
    setLoading(false);
  };

  return (
    <div className="space-y-8">
      {status && (
        <div className="bg-emerald-50 text-emerald-600 p-4 rounded-xl flex items-center gap-3 font-bold text-sm border border-emerald-100 animate-in fade-in slide-in-from-top-2">
          <FiCheckCircle className="shrink-0" /> {status}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Item Name */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Item Name</label>
            <div className="relative">
              <FiBox className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" required value={formData.itemName}
                className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-blue-500/5 transition-all"
                placeholder="Enter product name"
                onChange={(e) => setFormData({...formData, itemName: e.target.value})}
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
                <FiTag className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <select 
                  required value={formData.category}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl appearance-none font-bold text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/5 transition-all"
                  onChange={(e) => setFormData({...formData, category: e.target.value})}
                >
                  <option value="">Select Category</option>
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
                <FiLayers className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <select 
                  required value={formData.unit}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl appearance-none font-bold text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/5 transition-all"
                  onChange={(e) => setFormData({...formData, unit: e.target.value})}
                >
                  <option value="">Select Unit</option>
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
                onChange={(e) => setFormData({...formData, location: e.target.value})}
              />
            </div>
          </div>
        </div>

        <button 
          type="submit" 
          disabled={loading} 
          className="w-full bg-[#0f172a] hover:bg-slate-800 text-white font-black py-5 rounded-2xl shadow-xl flex items-center justify-center gap-3 transition-all uppercase tracking-[0.2em] text-xs disabled:opacity-70"
        >
          <FiSave size={18} /> {loading ? "Registering..." : "Save New Item"}
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
                onClick={() => {setShowCategoryModal(false); setShowUnitModal(false); setNewName("")}} 
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
                className={`w-full py-4 rounded-2xl font-black text-white uppercase tracking-widest text-[10px] transition-all shadow-lg ${
                  showCategoryModal ? 'bg-blue-600 shadow-blue-100' : 'bg-emerald-600 shadow-emerald-100'
                }`}
              >
                Save {showCategoryModal ? "Category" : "Unit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}