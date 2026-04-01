"use client";
import { useState, useEffect } from "react";
import { FiBriefcase, FiHash, FiSave, FiArrowLeft, FiCheckCircle, FiTrash2 } from "react-icons/fi";
import { useRouter } from "next/navigation";

interface Company {
  _id: string;
  firmName: string;
  firmCode: string;
  createdAt: string;
}

export default function CompaniesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [formData, setFormData] = useState({
    firmName: "",
    firmCode: ""
  });

  // 1. Fetch existing companies
  const fetchCompanies = async () => {
    try {
      const res = await fetch("/api/companies");
      const data = await res.json();
      if (Array.isArray(data)) {
        // Sort by newest first
        setCompanies(data.sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        ));
      }
    } catch (err) {
      console.error("Failed to fetch companies");
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, []);

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
        fetchCompanies(); // Refresh the list
        setTimeout(() => setStatus(""), 3000);
      }
    } catch (err) {
      setStatus("Error saving company.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this company?")) return;
    try {
      const res = await fetch(`/api/companies/${id}`, { method: "DELETE" });
      if (res.ok) fetchCompanies();
    } catch (err) {
      alert("Delete failed");
    }
  };

  return (
    <div className="p-4 md:p-12 max-w-4xl mx-auto space-y-4">
      {/* Back Button */}
      <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition-colors font-bold text-xs uppercase tracking-widest">
        <FiArrowLeft /> Back
      </button>

      {/* Registration Form */}
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="bg-[#0f172a] p-8 text-white flex items-center gap-4">
          <div className="p-4 bg-orange-500/20 rounded-2xl text-orange-400">
            <FiBriefcase size={32} />
          </div>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight">Company Setup</h1>
            <p className="text-orange-400 text-[10px] font-black tracking-[0.2em] uppercase mt-1">Manual Firm Registration</p>
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

          <button
            type="submit" disabled={loading}
            className="md:col-span-2 w-full bg-[#ff5100] hover:bg-orange-700 text-white font-black py-5 rounded-2xl shadow-lg shadow-orange-100 flex items-center justify-center gap-3 transition-all uppercase tracking-widest text-sm active:scale-95"
          >
            <FiSave size={18} /> {loading ? "Saving..." : "Register Company"}
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
                <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Firm Code</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companies.map((company) => (
                <tr key={company._id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-5">
                    <span className="font-black text-slate-700 uppercase block">{company.firmName}</span>
                  </td>
                  <td className="p-5 text-right">
                    <span className="bg-orange-50 text-orange-600 px-3 py-1 rounded-lg font-black text-xs tracking-widest border border-orange-100">
                      {company.firmCode}
                    </span>
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