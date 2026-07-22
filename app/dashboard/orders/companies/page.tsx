"use client";
import { useState, useEffect } from "react";
import { FiBriefcase, FiHash, FiSave, FiArrowLeft, FiCheckCircle, FiEdit3, FiMapPin, FiX } from "react-icons/fi";
import { useRouter } from "next/navigation";
import BlockGuard from "@/components/BlockGuard";
import Link from "next/link";

interface Company {
  _id: string;
  firmName: string;
  firmCode: string;
  sellerRegisterAddress?: string;
  createdAt: string;
}

export default function CompaniesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [formData, setFormData] = useState({
    _id: "",
    firmName: "",
    firmCode: "",
    sellerRegisterAddress: ""
  });

  // 1. Fetch existing companies
  const fetchCompanies = async () => {
    try {
      const res = await fetch("/api/companies");
      const data = await res.json();
      if (Array.isArray(data)) {
        setCompanies(data);
      }
    } catch (err) {
      console.error("Failed to fetch companies");
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, []);

  const resetForm = () => {
    setFormData({
      _id: "",
      firmName: "",
      firmCode: "",
      sellerRegisterAddress: ""
    });
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
        setStatus(formData._id ? "Company Info Updated!" : "Company Registered!");
        resetForm();
        fetchCompanies();
        setTimeout(() => setStatus(""), 3000);
      }
    } catch (err) {
      setStatus("Error saving company.");
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (company: Company) => {
    setFormData({
      _id: company._id,
      firmName: company.firmName,
      firmCode: company.firmCode,
      sellerRegisterAddress: company.sellerRegisterAddress || ""
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <BlockGuard
      permission="addMyCompanies"
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
      <div className="p-4 md:p-12 max-w-4xl mx-auto space-y-4">
        {/* Back Button */}
        <div className="flex justify-between items-center">
          <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition-colors font-bold text-xs uppercase tracking-widest">
            <FiArrowLeft /> Back
          </button>
          {formData._id && (
            <button onClick={resetForm} className="flex items-center gap-1 text-rose-500 hover:text-rose-600 transition-colors font-bold text-[10px] uppercase tracking-widest">
              <FiX /> Cancel Edit
            </button>
          )}
        </div>

        {/* Registration / Edit Form */}
        <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
          <div className={`p-8 text-white flex items-center gap-4 transition-colors duration-500 ${formData._id ? 'bg-orange-600' : 'bg-[#0f172a]'}`}>
            <div className="p-4 bg-orange-500/20 rounded-2xl text-orange-400">
              <FiBriefcase size={32} />
            </div>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tight">
                {formData._id ? "Update Company" : "Company Setup"}
              </h1>
              <p className="text-orange-400 text-[10px] font-black tracking-[0.2em] uppercase mt-1">
                {formData._id ? "Edit Firm Information" : "Manual Firm Registration"}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
            {status && (
              <div className="md:col-span-2 bg-emerald-50 text-emerald-600 p-4 rounded-xl flex items-center gap-3 font-bold text-sm border border-emerald-100">
                <FiCheckCircle /> {status}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Firm Name</label>
              <div className="relative">
                <FiBriefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text" required
                  value={formData.firmName}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-orange-500/10 transition-all uppercase"
                  placeholder="E.G. ALFA LOGISTICS"
                  onChange={(e) => setFormData({ ...formData, firmName: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Manual Firm Code</label>
              <div className="relative">
                <FiHash className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text" required
                  maxLength={5}
                  value={formData.firmCode}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-black text-orange-600 tracking-widest focus:ring-4 focus:ring-orange-500/10 transition-all uppercase"
                  placeholder="E.G. ALF01"
                  onChange={(e) => setFormData({ ...formData, firmCode: e.target.value.toUpperCase() })}
                />
              </div>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Seller Register Address</label>
              <div className="relative">
                <FiMapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={formData.sellerRegisterAddress}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-orange-500/10 transition-all"
                  placeholder="Register Address / Office Address"
                  onChange={(e) => setFormData({ ...formData, sellerRegisterAddress: e.target.value })}
                />
              </div>
            </div>

            <button
              type="submit" disabled={loading}
              className={`md:col-span-2 w-full text-white font-black py-5 rounded-2xl shadow-lg flex items-center justify-center gap-3 transition-all uppercase tracking-widest text-sm active:scale-95 ${
                formData._id ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-100' : 'bg-[#ff5100] hover:bg-orange-700 shadow-orange-100'
              }`}
            >
              <FiSave size={18} /> {loading ? "Saving..." : formData._id ? "Update Company Information" : "Register Company"}
            </button>
          </form>
        </div>

        {/* Data Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50">
                  <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Registered Companies</th>
                  <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Seller Register Address</th>
                  <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Firm Code</th>
                  <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {companies.map((company) => (
                  <tr key={company._id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-5 font-black text-slate-700 uppercase">{company.firmName}</td>
                    <td className="p-5 font-medium text-slate-600 text-xs max-w-xs truncate" title={company.sellerRegisterAddress}>
                      {company.sellerRegisterAddress || "---"}
                    </td>
                    <td className="p-5">
                      <span className="bg-orange-50 text-orange-600 px-3 py-1 rounded-lg font-black text-xs tracking-widest border border-orange-100">
                        {company.firmCode}
                      </span>
                    </td>
                    <td className="p-5 text-right">
                      <button
                        onClick={() => handleEdit(company)}
                        className="p-2 bg-slate-100 text-slate-400 rounded-lg hover:bg-orange-600 hover:text-white transition-all shadow-sm cursor-pointer"
                        title="Edit Company"
                      >
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
    </BlockGuard>
  );
}