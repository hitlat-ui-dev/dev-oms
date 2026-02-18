"use client";
import { useState } from "react";
import { FiBriefcase, FiHash, FiSave, FiArrowLeft, FiCheckCircle } from "react-icons/fi";
import { useRouter } from "next/navigation";

export default function CompaniesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [formData, setFormData] = useState({
    firmName: "",
    firmCode: ""
  });

  // Automatically generate 3-character Firm Code
  const handleNameChange = (name: string) => {
    const code = name.trim().substring(0, 3).toUpperCase();
    setFormData({ ...formData, firmName: name, firmCode: code });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        body: JSON.stringify(formData),
        headers: { "Content-Type": "application/json" }
      });
      if (res.ok) {
        setStatus("Company Registered!");
        setFormData({ firmName: "", firmCode: "" });
        setTimeout(() => setStatus(""), 3000);
      }
    } catch (err) {
      setStatus("Error saving company.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-12 max-w-2xl mx-auto">
      <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition-colors mb-6 font-bold text-xs uppercase tracking-widest">
        <FiArrowLeft /> Back
      </button>

      <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-[#0f172a] p-8 text-white flex justify-between items-center">
          <div className="flex items-center gap-4">
             <div className="p-4 bg-orange-500/20 rounded-2xl text-orange-400">
                <FiBriefcase size={32} />
             </div>
             <div>
                <h1 className="text-2xl font-black uppercase tracking-tight">Add Company</h1>
                <p className="text-orange-400 text-[10px] font-black tracking-[0.2em] uppercase mt-1">Firm Registration</p>
             </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-8">
          {status && (
            <div className="bg-emerald-50 text-emerald-600 p-4 rounded-xl flex items-center gap-3 font-bold text-sm border border-emerald-100">
              <FiCheckCircle /> {status}
            </div>
          )}

          <div className="space-y-6">
            {/* Firm Name */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Firm Name</label>
              <div className="relative">
                <FiBriefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text" required value={formData.firmName}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-orange-500/10 transition-all"
                  placeholder="Enter Firm Name"
                  onChange={(e) => handleNameChange(e.target.value)}
                />
              </div>
            </div>

            {/* Firm Code (Generated) */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Firm Code (Generated)</label>
              <div className="h-16 flex items-center gap-3 px-6 bg-slate-100 border border-dashed border-slate-300 rounded-2xl">
                <FiHash className="text-slate-400" />
                <span className="font-black text-orange-600 tracking-[0.3em] text-xl">
                  {formData.firmCode || "---"}
                </span>
              </div>
            </div>
          </div>

          <button 
            type="submit" disabled={loading}
            className="w-full bg-[#ff5100] hover:bg-orange-700 text-white font-black py-5 rounded-2xl shadow-lg shadow-orange-200 flex items-center justify-center gap-3 transition-all uppercase tracking-widest text-sm"
          >
            <FiSave size={18} /> {loading ? "Registering..." : "Save Company"}
          </button>
        </form>
      </div>
    </div>
  );
}