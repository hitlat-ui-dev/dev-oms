"use client";
import { useState } from "react";
import { FiHome, FiUser, FiPhone, FiMapPin, FiSave, FiArrowLeft, FiCheckCircle, FiBriefcase } from "react-icons/fi";
import { useRouter } from "next/navigation";

export default function AddSellerPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [formData, setFormData] = useState({
    instituteName: "",
    buyerName: "",
    mobile: "",
    address: "",
    place: ""
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/sellers", {
        method: "POST",
        body: JSON.stringify(formData),
        headers: { "Content-Type": "application/json" }
      });
      if (res.ok) {
        setStatus("Seller Registered Successfully!");
        setFormData({ instituteName: "", buyerName: "", mobile: "", address: "", place: "" });
        setTimeout(() => setStatus(""), 3000);
      }
    } catch (err) {
      setStatus("Error saving seller data.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-12 max-w-4xl mx-auto">
      <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition-colors mb-6 font-bold text-xs uppercase tracking-widest">
        <FiArrowLeft /> Back to Orders
      </button>

      <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
        {/* Header Section */}
        <div className="bg-[#0f172a] p-8 text-white">
          <div className="flex items-center gap-4">
             <div className="p-4 bg-blue-500/20 rounded-2xl text-blue-400">
                <FiUser size={32} />
             </div>
             <div>
                <h1 className="text-2xl font-black uppercase tracking-tight">Add New Seller</h1>
                <p className="text-blue-400 text-[10px] font-black tracking-[0.2em] uppercase mt-1">Order Management System</p>
             </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          {status && (
            <div className="bg-emerald-50 text-emerald-600 p-4 rounded-xl flex items-center gap-3 font-bold text-sm border border-emerald-100">
              <FiCheckCircle /> {status}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Institute Name */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Name of Institute</label>
              <div className="relative">
                <FiBriefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text" required value={formData.instituteName}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-blue-500/10"
                  placeholder="Enter Institute Name"
                  onChange={(e) => setFormData({...formData, instituteName: e.target.value})}
                />
              </div>
            </div>

            {/* Buyer Name */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Name of Buyer</label>
              <div className="relative">
                <FiUser className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text" required value={formData.buyerName}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700"
                  placeholder="Enter Buyer Name"
                  onChange={(e) => setFormData({...formData, buyerName: e.target.value})}
                />
              </div>
            </div>

            {/* Mobile No */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Mobile No.</label>
              <div className="relative">
                <FiPhone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text" required value={formData.mobile}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700"
                  placeholder="00000 00000"
                  onChange={(e) => setFormData({...formData, mobile: e.target.value})}
                />
              </div>
            </div>

            {/* Place */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Place</label>
              <div className="relative">
                <FiMapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text" required value={formData.place}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700"
                  placeholder="City/State"
                  onChange={(e) => setFormData({...formData, place: e.target.value})}
                />
              </div>
            </div>

            {/* Address */}
            <div className="space-y-2 md:col-span-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Address</label>
              <div className="relative">
                <FiHome className="absolute left-4 top-4 text-slate-400" />
                <textarea 
                  required value={formData.address}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 min-h-24"
                  placeholder="Enter Full Address"
                  onChange={(e) => setFormData({...formData, address: e.target.value})}
                />
              </div>
            </div>
          </div>

          <button 
            type="submit" disabled={loading}
            className="w-full bg-[#1d63ff] hover:bg-blue-700 text-white font-black py-5 rounded-2xl shadow-lg flex items-center justify-center gap-3 transition-all uppercase tracking-widest text-sm"
          >
            <FiSave size={18} /> {loading ? "Saving..." : "Save Seller Info"}
          </button>
        </form>
      </div>
    </div>
  );
}