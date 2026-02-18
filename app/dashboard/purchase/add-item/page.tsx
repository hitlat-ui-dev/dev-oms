"use client";
import { useState } from "react";
import { FiBox, FiTag, FiSave, FiArrowLeft, FiCheckCircle } from "react-icons/fi";
import { useRouter } from "next/navigation";

export default function AddItemPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({ itemName: "", category: "" });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setStatus("Item Saved Successfully!");
        setFormData({ itemName: "", category: "" });
        setTimeout(() => setStatus(""), 3000);
      }
    } catch (err) {
      setStatus("Error saving item.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-12 max-w-2xl mx-auto">
      <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition-colors mb-6 font-bold text-xs uppercase tracking-widest">
        <FiArrowLeft /> Back to Purchase
      </button>

      <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="bg-[#0f172a] p-8 text-white">
          <h1 className="text-2xl font-black uppercase tracking-tight">Add New Item</h1>
          <p className="text-blue-400 text-[10px] font-black tracking-[0.2em] uppercase mt-1">Inventory Management</p>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          {status && (
            <div className="bg-emerald-50 text-emerald-600 p-4 rounded-xl flex items-center gap-3 font-bold text-sm border border-emerald-100">
              <FiCheckCircle /> {status}
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Item Name</label>
              <div className="relative">
                <FiBox className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text"
                  required
                  value={formData.itemName}
                  placeholder="Enter Item Name"
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all font-bold text-slate-700"
                  onChange={(e) => setFormData({...formData, itemName: e.target.value})}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Category</label>
              <div className="relative">
                <FiTag className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <select 
                  required
                  value={formData.category}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all font-bold text-slate-700 appearance-none"
                  onChange={(e) => setFormData({...formData, category: e.target.value})}
                >
                  <option value="">Select Category</option>
                  <option value="Hardware">Hardware</option>
                  <option value="Electrical">Electrical</option>
                  <option value="General">General</option>
                </select>
              </div>
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-[#1d63ff] hover:bg-blue-700 text-white font-black py-5 rounded-2xl shadow-lg shadow-blue-500/30 flex items-center justify-center gap-3 transition-all uppercase tracking-widest text-sm"
          >
            <FiSave size={18} /> {loading ? "Saving..." : "Save Item"}
          </button>
        </form>
      </div>
    </div>
  );
}