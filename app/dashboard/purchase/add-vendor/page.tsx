"use client";
import { useEffect, useState } from "react";
import { FiUserPlus, FiMapPin, FiHome, FiPhone, FiSave, FiArrowLeft, FiCheckCircle } from "react-icons/fi";
import { useRouter } from "next/navigation";
import BlockGuard from "@/components/BlockGuard";
import Link from "next/link";

export default function AddVendorPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [vendors, setVendors] = useState([]);
  const [formData, setFormData] = useState({
    name: "",
    place: "",
    address: "",
    mobile: ""
  });

  const fetchVendors = async () => {
    try {
      const res = await fetch("/api/vendors");
      const data = await res.json();
      if (res.ok) setVendors(data);
    } catch (err) {
      console.error("Failed to fetch vendors");
    }
  };

  useEffect(() => {
    fetchVendors();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/vendors", {
        method: "POST",
        body: JSON.stringify(formData),
        headers: { "Content-Type": "application/json" }
      });
      if (res.ok) {
        setStatus("Vendor Added Successfully!");
        setFormData({ name: "", place: "", address: "", mobile: "" });
        setTimeout(() => setStatus(""), 3000);
      }
    } catch (err) {
      setStatus("Error saving vendor.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <BlockGuard
      permission="stock"
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
      <div className="p-4 md:p-12 max-w-4xl mx-auto">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition-colors mb-6 font-bold text-xs uppercase tracking-widest">
          <FiArrowLeft /> Back to Purchase
        </button>

        <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
          {/* Header Section */}
          <div className="bg-[#0f172a] p-8 text-white flex justify-between items-center">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-purple-500/20 rounded-2xl text-purple-400">
                <FiUserPlus size={32} />
              </div>
              <div>
                <h1 className="text-2xl font-black uppercase tracking-tight">Add Vendor</h1>
                <p className="text-purple-400 text-[10px] font-black tracking-[0.2em] uppercase mt-1">Supplier Directory</p>
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
              {/* Vendor Name */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Name of Vendor</label>
                <div className="relative">
                  <FiUserPlus className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text" required value={formData.name}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700"
                    placeholder="Enter Vendor Name"
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
              </div>

              {/* Mobile No */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Mobile No.</label>
                <div className="relative">
                  <FiPhone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text" //required 
                    value={formData.mobile}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700"
                    placeholder="00000 00000"
                    onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
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
                    onChange={(e) => setFormData({ ...formData, place: e.target.value })}
                  />
                </div>
              </div>

              {/* Address */}
              <div className="space-y-2 md:col-span-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Address</label>
                <div className="relative">
                  <FiHome className="absolute left-4 top-4 text-slate-400" />
                  <textarea
                    //required
                    value={formData.address}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 min-h-24"
                    placeholder="Full Business Address"
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <button
              type="submit" disabled={loading}
              className="w-full bg-[#8b2ef5] hover:bg-purple-700 text-white font-black py-5 rounded-2xl shadow-lg flex items-center justify-center gap-3 transition-all uppercase tracking-widest text-sm"
            >
              <FiSave size={18} /> {loading ? "Saving..." : "Save Vendor"}
            </button>
          </form>
        </div>
        <div className="space-y-4 mt-6">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black uppercase tracking-tight text-slate-800">Vendor List</h2>
            <span className="bg-slate-200 text-slate-600 px-3 py-1 rounded-full text-xs font-black">{vendors.length}</span>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Name</th>
                    <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Mobile</th>
                    <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Place</th>
                    <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Address</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {vendors.map((vendor: any) => (
                    <tr key={vendor._id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-4 font-bold text-slate-700">{vendor.name}</td>
                      <td className="p-4 font-bold text-slate-600">{vendor.mobile || "N/A"}</td>
                      <td className="p-4">
                        <span className="bg-purple-50 text-purple-600 px-3 py-1 rounded-full text-xs font-black uppercase">
                          {vendor.place}
                        </span>
                      </td>
                      <td className="p-4 text-xs text-slate-500 font-medium max-w-[200px] truncate">
                        {vendor.address || "No address"}
                      </td>
                    </tr>
                  ))}
                  {vendors.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-12 text-center text-slate-400 font-bold uppercase text-xs tracking-widest">
                        No vendors found in directory
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </BlockGuard>
  );
}