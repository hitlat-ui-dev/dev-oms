"use client";
import { useState, useEffect, useMemo } from "react";
import { FiHome, FiUser, FiPhone, FiMapPin, FiSave, FiArrowLeft, FiCheckCircle, FiBriefcase, FiEdit3, FiSearch, FiChevronUp, FiChevronDown, FiX, FiFileText, FiTag, FiPlus, FiTrash2, FiMessageCircle } from "react-icons/fi";
import { useRouter } from "next/navigation";
import BlockGuard from "@/components/BlockGuard";
import Link from "next/link";

interface Seller {
  _id: string;
  instituteName: string;
  buyerName?: string;
  mobile?: string;
  whatsappNumber?: string;
  address?: string;
  place?: string;
  state?: string;
  sellerBillName?: string;
  gemLocationText?: string;
  statementDescriptionName?: string[];
  createdAt: string;
}

export default function AddSellerPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [search, setSearch] = useState("");
  const [sortConfig, setSortConfig] = useState<{ key: keyof Seller; direction: 'asc' | 'desc' } | null>(null);

  const [formData, setFormData] = useState({
    _id: "",
    instituteName: "",
    buyerName: "",
    mobile: "",
    whatsappNumber: "",
    address: "",
    place: "",
    state: "",
    sellerBillName: "",
    gemLocationText: "",
    statementDescriptionName: [] as string[]
  });
  const [descInput, setDescInput] = useState("");

  const fetchSellers = async () => {
    try {
      const res = await fetch("/api/sellers");
      const data = await res.json();
      if (Array.isArray(data)) setSellers(data);
    } catch (err) { console.error("Fetch error"); }
  };

  const handleDeleteSeller = async (seller: Seller) => {
    if (!confirm(`Delete "${seller.instituteName}" from the Seller Directory? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/sellers/${seller._id}`, { method: "DELETE" });
      if (res.ok) {
        setSellers(prev => prev.filter(s => s._id !== seller._id));
      } else {
        const err = await res.json();
        alert(err.error || "Failed to delete seller");
      }
    } catch (err) {
      alert("Error deleting seller");
    }
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
      s.buyerName?.toLowerCase().includes(search.toLowerCase()) ||
      s.sellerBillName?.toLowerCase().includes(search.toLowerCase()) ||
      s.statementDescriptionName?.some(d => d.toLowerCase().includes(search.toLowerCase()))
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

  const resetForm = () => {
    setFormData({
      _id: "",
      instituteName: "",
      buyerName: "",
      mobile: "",
      whatsappNumber: "",
      address: "",
      place: "",
      state: "",
      sellerBillName: "",
      gemLocationText: "",
      statementDescriptionName: []
    });
    setDescInput("");
  };

  const handleAddDescName = () => {
    const trimmed = descInput.trim();
    if (!trimmed) return;
    // The whole typed value is saved as one tag, commas and all — a name like
    // "teasury,meh" is one bank statement description, not two names to split.
    if (formData.statementDescriptionName.includes(trimmed)) {
      setDescInput("");
      return;
    }
    setFormData({ ...formData, statementDescriptionName: [...formData.statementDescriptionName, trimmed] });
    setDescInput("");
  };

  const handleRemoveDescName = (indexToRemove: number) => {
    setFormData({
      ...formData,
      statementDescriptionName: formData.statementDescriptionName.filter((_, idx) => idx !== indexToRemove)
    });
  };

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
    const descNames = Array.isArray(seller.statementDescriptionName)
      ? seller.statementDescriptionName
      : (seller.statementDescriptionName ? [seller.statementDescriptionName] : []);

    setFormData({
      _id: seller._id,
      instituteName: seller.instituteName,
      buyerName: seller.buyerName || "",
      mobile: seller.mobile || "",
      whatsappNumber: seller.whatsappNumber || "",
      address: seller.address || "",
      place: seller.place || "",
      state: seller.state || "",
      sellerBillName: seller.sellerBillName || "",
      gemLocationText: seller.gemLocationText || "",
      statementDescriptionName: descNames
    });
    setDescInput("");
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <BlockGuard
      permission="addSeller"
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
                  <input type="text" required value={formData.instituteName} className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-blue-500/10 transition-all" placeholder="Institute Name" onChange={(e) => setFormData({ ...formData, instituteName: e.target.value })} />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Buyer Name</label>
                <div className="relative">
                  <FiUser className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="text" value={formData.buyerName} className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-blue-500/10 transition-all" placeholder="Buyer Name" onChange={(e) => setFormData({ ...formData, buyerName: e.target.value })} />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Mobile No.</label>
                <div className="relative">
                  <FiPhone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="text" value={formData.mobile} className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-blue-500/10 transition-all" placeholder="Mobile" onChange={(e) => setFormData({ ...formData, mobile: e.target.value })} />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">WhatsApp No.</label>
                <div className="relative">
                  <FiMessageCircle className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="text" value={formData.whatsappNumber} className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-blue-500/10 transition-all" placeholder="For courier tracking updates" onChange={(e) => setFormData({ ...formData, whatsappNumber: e.target.value })} />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Place</label>
                <div className="relative">
                  <FiMapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="text" value={formData.place} className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-blue-500/10 transition-all" placeholder="City" onChange={(e) => setFormData({ ...formData, place: e.target.value })} />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Seller Bill Name</label>
                <div className="relative">
                  <FiFileText className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="text" value={formData.sellerBillName} className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-blue-500/10 transition-all" placeholder="Seller Bill Name" onChange={(e) => setFormData({ ...formData, sellerBillName: e.target.value })} />
                </div>
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Full Address</label>
                <div className="relative">
                  <FiHome className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="text" value={formData.address} className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-blue-500/10 transition-all" placeholder="Street Address" onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                  State <span className="text-slate-400 font-normal lowercase">(for CGST/SGST vs IGST)</span>
                </label>
                <div className="relative">
                  <FiMapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="text" value={formData.state} className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-blue-500/10 transition-all" placeholder="E.G. Gujarat" onChange={(e) => setFormData({ ...formData, state: e.target.value })} />
                </div>
              </div>

              <div className="space-y-2 md:col-span-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-1">
                  <span>GeM Location (for auto-match)</span>
                  <span className="text-slate-400 font-normal lowercase">(paste the exact "Location" text GeM shows on this institute's orders)</span>
                </label>
                <div className="relative">
                  <FiMapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={formData.gemLocationText}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-blue-500/10 transition-all"
                    placeholder='e.g. "Govt. industrial training institute, deodar, opp. mamlatdar office, ta - deodar, di - banaskantha"'
                    onChange={(e) => setFormData({ ...formData, gemLocationText: e.target.value })}
                  />
                </div>
              </div>

              {/* Statement Description Name - Multi-input */}
              <div className="space-y-2 md:col-span-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-1">
                  <span>Statement Description Name</span>
                  <span className="text-slate-400 font-normal lowercase">(supports multiple names)</span>
                </label>
                <div className="space-y-3">
                  <div className="relative flex items-center">
                    <FiTag className="absolute left-4 text-slate-400" />
                    <input
                      type="text"
                      value={descInput}
                      className="w-full pl-12 pr-28 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-blue-500/10 transition-all"
                      placeholder="Type name and click Add or press Enter"
                      onChange={(e) => setDescInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddDescName();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleAddDescName}
                      className="absolute right-3 px-4 py-2.5 bg-slate-900 text-white rounded-xl font-black text-xs hover:bg-slate-800 transition-all flex items-center gap-1.5 uppercase tracking-wider"
                    >
                      <FiPlus size={14} /> Add
                    </button>
                  </div>

                  {formData.statementDescriptionName.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {formData.statementDescriptionName.map((name, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-2 px-3.5 py-2 bg-blue-50 text-blue-700 border border-blue-200/80 rounded-xl text-xs font-bold shadow-sm"
                        >
                          <span>{name}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveDescName(idx)}
                            className="text-blue-400 hover:text-rose-600 transition-colors p-0.5 rounded-md hover:bg-rose-50"
                          >
                            <FiX size={14} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
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
                  <th onClick={() => handleSort('instituteName')} className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest cursor-pointer hover:text-blue-600 transition-colors">
                    <div className="flex items-center gap-1">Institute {sortConfig?.key === 'instituteName' && (sortConfig.direction === 'asc' ? <FiChevronUp /> : <FiChevronDown />)}</div>
                  </th>
                  <th onClick={() => handleSort('buyerName')} className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest cursor-pointer hover:text-blue-600 transition-colors">
                    <div className="flex items-center gap-1">Buyer / Bill Name {sortConfig?.key === 'buyerName' && (sortConfig.direction === 'asc' ? <FiChevronUp /> : <FiChevronDown />)}</div>
                  </th>
                  <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Contact & Address</th>
                  <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">GeM Match Location</th>
                  <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Statement Descriptions</th>
                  <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedSellers.map((seller) => {
                  const isIncomplete = !seller.buyerName && !seller.mobile && !seller.address && !seller.place && !seller.sellerBillName;
                  return (
                  <tr key={seller._id} className="hover:bg-slate-50/50 transition-colors group align-top">
                    <td className="p-4 text-xs">
                      <div className="font-black text-slate-700">{seller.instituteName}</div>
                      {isIncomplete && (
                        <span className="inline-block mt-1 px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-black uppercase tracking-wider rounded-md">
                          Incomplete
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-xs">
                      <div className="font-bold text-slate-600">{seller.buyerName || "---"}</div>
                      {seller.sellerBillName && <div className="text-slate-400 text-[10px] font-semibold mt-0.5">{seller.sellerBillName}</div>}
                    </td>
                    <td className="p-4 text-xs">
                      <div className="font-bold text-slate-600">{seller.mobile || "---"}</div>
                      <div
                        className="text-slate-400 text-[10px] font-medium mt-0.5 max-w-56 truncate cursor-help"
                        title={[seller.address, seller.place, seller.state].filter(Boolean).join(", ")}
                      >
                        {[seller.address, seller.place, seller.state].filter(Boolean).join(", ") || "---"}
                      </div>
                    </td>
                    <td
                      className="p-4 font-medium text-slate-500 text-[11px] max-w-64 truncate cursor-help"
                      title={seller.gemLocationText}
                    >
                      {seller.gemLocationText || "---"}
                    </td>
                    <td className="p-4">
                      {seller.statementDescriptionName && seller.statementDescriptionName.length > 0 ? (
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {seller.statementDescriptionName.map((name, i) => (
                            <span key={i} className="inline-block px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-bold rounded-lg border border-blue-200/60">
                              {name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs font-bold text-slate-400">---</span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => handleEdit(seller)} className="p-2 bg-slate-100 text-slate-400 rounded-lg hover:bg-blue-600 hover:text-white transition-all shadow-sm">
                          <FiEdit3 size={16} />
                        </button>
                        <button onClick={() => handleDeleteSeller(seller)} className="p-2 bg-slate-100 text-slate-400 rounded-lg hover:bg-rose-600 hover:text-white transition-all shadow-sm">
                          <FiTrash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </BlockGuard>
  );
}