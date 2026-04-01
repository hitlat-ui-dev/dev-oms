"use client";
import { useState, useEffect, useMemo } from "react";
import { FiHome, FiUser, FiPhone, FiMapPin, FiSave, FiArrowLeft, FiCheckCircle, FiBriefcase, FiEdit3, FiSearch, FiChevronUp, FiChevronDown, FiX } from "react-icons/fi";
import { useRouter } from "next/navigation";

interface Seller {
  _id: string;
  instituteName: string;
  buyerName?: string;
  mobile?: string;
  address?: string;
  place?: string;
  createdAt: string;
}

export default function AddSellerPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [search, setSearch] = useState("");
  const [sortConfig, setSortConfig] = useState<{ key: keyof Seller; direction: 'asc' | 'desc' } | null>(null);

  // Added _id to formData to handle updates correctly
  const [formData, setFormData] = useState({
    _id: "", 
    instituteName: "",
    buyerName: "",
    mobile: "",
    address: "",
    place: ""
  });

  const fetchSellers = async () => {
    try {
      const res = await fetch("/api/sellers");
      const data = await res.json();
      if (Array.isArray(data)) setSellers(data);
    } catch (err) { console.error("Fetch error"); }
  };

  useEffect(() => { fetchSellers(); }, []);

  const handleSort = (key: keyof Seller) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedSellers = useMemo(() => {
    let items = [...sellers].filter(s => 
      s.instituteName.toLowerCase().includes(search.toLowerCase()) || 
      s.buyerName?.toLowerCase().includes(search.toLowerCase())
    );
    if (sortConfig !== null) {
      items.sort((a, b) => {
        const valA = (a[sortConfig.key] || "").toString().toLowerCase();
        const valB = (b[sortConfig.key] || "").toString().toLowerCase();
        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return items;
  }, [sellers, sortConfig, search]);

  // Unified reset function
  const resetForm = () => {
    setFormData({ _id: "", instituteName: "", buyerName: "", mobile: "", address: "", place: "" });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/sellers", {
        method: "POST", // API handles update if _id is present
        body: JSON.stringify(formData),
        headers: { "Content-Type": "application/json" }
      });
      if (res.ok) {
        setStatus(formData._id ? "Seller Updated successfully!" : "Seller Registered successfully!");
        resetForm();
        fetchSellers();
        setTimeout(() => setStatus(""), 3000);
      }
    } catch (err) {
      setStatus("Error saving data.");
    } finally { setLoading(false); }
  };

  const handleEdit = (seller: Seller) => {
    setFormData({
      _id: seller._id, // Set the ID so the backend knows to update
      instituteName: seller.instituteName,
      buyerName: seller.buyerName || "",
      mobile: seller.mobile || "",
      address: seller.address || "",
      place: seller.place || ""
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="p-4 md:p-4 max-w-7xl mx-auto space-y-4">
      <div className="flex justify-between items-center mt-4">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition-colors font-bold text-xs uppercase tracking-widest">
          <FiArrowLeft /> Back
        </button>
        {formData._id && (
          <button onClick={resetForm} className="flex items-center gap-1 text-rose-500 hover:text-rose-600 transition-colors font-bold text-[10px] uppercase tracking-widest">
            <FiX /> Cancel Edit
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
        <div className={`p-8 text-white flex items-center gap-4 transition-colors duration-500 ${formData._id ? 'bg-blue-600' : 'bg-[#0f172a]'}`}>
          <div className="p-4 bg-white/20 rounded-2xl">
            <FiUser size={32} />
          </div>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight">
                {formData._id ? "Update Seller" : "Seller Registration"}
            </h1>
            <p className="opacity-70 text-[10px] font-black tracking-[0.2em] uppercase mt-1">Order Management System</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          {status && (
            <div className="bg-emerald-50 text-emerald-600 p-4 rounded-xl flex items-center gap-3 font-bold text-sm border border-emerald-100 animate-in fade-in">
              <FiCheckCircle /> {status}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2 lg:col-span-1">
              <label className="text-[10px] font-black text-slate-400 tracking-widest uppercase ml-1">Institute Name <span className="text-red-500">*</span></label>
              <div className="relative">
                <FiBriefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" required value={formData.instituteName} className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-blue-500/10 transition-all" placeholder="Institute Name" onChange={(e) => setFormData({...formData, instituteName: e.target.value})} />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Buyer Name</label>
              <div className="relative">
                <FiUser className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" value={formData.buyerName} className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700" placeholder="Buyer Name" onChange={(e) => setFormData({...formData, buyerName: e.target.value})} />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Mobile No.</label>
              <div className="relative">
                <FiPhone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" value={formData.mobile} className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700" placeholder="Mobile" onChange={(e) => setFormData({...formData, mobile: e.target.value})} />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Place</label>
              <div className="relative">
                <FiMapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" value={formData.place} className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700" placeholder="City" onChange={(e) => setFormData({...formData, place: e.target.value})} />
              </div>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Full Address</label>
              <div className="relative">
                <FiHome className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" value={formData.address} className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700" placeholder="Street Address" onChange={(e) => setFormData({...formData, address: e.target.value})} />
              </div>
            </div>
          </div>

          <button type="submit" disabled={loading} className={`w-full text-white font-black py-5 rounded-2xl shadow-xl flex items-center justify-center gap-3 transition-all tracking-widest text-sm active:scale-95 ${formData._id ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-100' : 'bg-[#1d63ff] hover:bg-blue-700 shadow-blue-100'}`}>
            <FiSave size={18} /> {loading ? "Processing..." : formData._id ? "Update Information" : "Save Seller Info"}
          </button>
        </form>
      </div>

      {/* Table Section */}
<div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
  <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4 bg-slate-50/50">
    <h2 className="font-black text-slate-800 uppercase tracking-tight">Seller Directory</h2>
    <div className="relative w-full md:w-72">
      <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
      <input type="text" placeholder="Search sellers..." className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 text-xs font-bold focus:ring-2 focus:ring-blue-500/20 outline-none" value={search} onChange={(e) => setSearch(e.target.value)} />
    </div>
  </div>

  <div className="overflow-x-auto">
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="bg-slate-50">
          <th onClick={() => handleSort('instituteName')} className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest cursor-pointer hover:text-blue-600 transition-colors">
            <div className="flex items-center gap-1">Institute {sortConfig?.key === 'instituteName' && (sortConfig.direction === 'asc' ? <FiChevronUp /> : <FiChevronDown />)}</div>
          </th>
          <th onClick={() => handleSort('buyerName')} className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest cursor-pointer hover:text-blue-600 transition-colors">
            <div className="flex items-center gap-1">Buyer {sortConfig?.key === 'buyerName' && (sortConfig.direction === 'asc' ? <FiChevronUp /> : <FiChevronDown />)}</div>
          </th>
          <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Contact</th>
          
          {/* NEW ADDRESS HEADER */}
          <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Full Address</th>
          
          <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Location</th>
          <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Edit</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {sortedSellers.map((seller) => (
          <tr key={seller._id} className="hover:bg-slate-50/50 transition-colors group">
            <td className="p-5 font-black text-slate-700 text-xs">{seller.instituteName}</td>
            <td className="p-5 font-bold text-slate-500 text-xs">{seller.buyerName || "---"}</td>
            <td className="p-5 font-bold text-slate-500 text-xs">{seller.mobile || "---"}</td>
            
            {/* NEW ADDRESS DATA CELL */}
            <td 
              className="p-5 font-medium text-slate-500 text-[11px] max-w-52 truncate cursor-help" 
              title={seller.address}
            >
              {seller.address || "---"}
            </td>

            <td className="p-5 font-bold text-slate-400 text-[10px]">{seller.place || "---"}</td>
            <td className="p-5 text-right">
              <button onClick={() => handleEdit(seller)} className="p-2 bg-slate-100 text-slate-400 rounded-lg hover:bg-blue-600 hover:text-white transition-all shadow-sm">
                <FiEdit3 size={16} />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</div>
    </div>
  );
}