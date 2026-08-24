"use client";
import { useState, useEffect, useMemo } from "react";
import { FiKey, FiUser, FiLock, FiMail, FiSave, FiArrowLeft, FiCheckCircle, FiEdit3, FiSearch, FiX, FiEye, FiEyeOff, FiTrash2, FiPlus, FiLogIn } from "react-icons/fi";
import { useRouter } from "next/navigation";
import { triggerGemLogin } from "@/lib/triggerGemSubmit";

interface Company {
  _id: string;
  firmName: string;
  firmCode: string;
}

interface GemCredential {
  _id: string;
  firmCode: string;
  gemUserId: string;
  gemPassword: string;
  gemMailId: string;
  updatedAt: string;
}

const emptyForm = {
  firmCode: "",
  gemUserId: "",
  gemPassword: "",
  gemMailId: "",
};

export default function GemCredentialsPage() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [credentials, setCredentials] = useState<GemCredential[]>([]);
  const [search, setSearch] = useState("");
  const [formData, setFormData] = useState(emptyForm);
  const [isEditing, setIsEditing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [revealedRows, setRevealedRows] = useState<Set<string>>(new Set());
  const [loggingInFirm, setLoggingInFirm] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("oms_user");
      setUsername(stored ? JSON.parse(stored)?.username || "" : "");
    } catch {
      setUsername("");
    }
  }, []);

  const fetchCompanies = async () => {
    try {
      const res = await fetch("/api/companies");
      const data = await res.json();
      if (Array.isArray(data)) setCompanies(data);
    } catch (err) {
      console.error("Failed to fetch companies", err);
    }
  };

  const fetchCredentials = async (forUsername: string) => {
    try {
      const res = await fetch(`/api/gem-credentials?username=${encodeURIComponent(forUsername)}`);
      const data = await res.json();
      if (Array.isArray(data)) setCredentials(data);
    } catch (err) {
      console.error("Failed to fetch GeM credentials", err);
    }
  };

  useEffect(() => {
    if (username === null) return; // still resolving from localStorage
    fetchCompanies();
    if (username) fetchCredentials(username);
  }, [username]);

  // Firms that don't already have a saved credential - keeps the dropdown
  // from suggesting a firm you'd just overwrite by accident when adding new,
  // while editing an existing row still allows re-selecting its own firm.
  const firmOptions = useMemo(() => {
    const taken = new Set(credentials.map((c) => c.firmCode));
    return companies.filter((c) => !taken.has(c.firmCode) || c.firmCode === formData.firmCode);
  }, [companies, credentials, formData.firmCode]);

  const filteredCredentials = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return credentials;
    return credentials.filter((c) =>
      c.firmCode?.toLowerCase().includes(q) ||
      c.gemUserId?.toLowerCase().includes(q) ||
      c.gemMailId?.toLowerCase().includes(q)
    );
  }, [credentials, search]);

  const closeModal = () => {
    setShowModal(false);
    setFormData(emptyForm);
    setIsEditing(false);
    setShowPassword(false);
    setStatus("");
  };

  const openAddModal = () => {
    setFormData(emptyForm);
    setIsEditing(false);
    setShowPassword(false);
    setStatus("");
    setShowModal(true);
  };

  useEffect(() => {
    if (!showModal) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showModal]);

  const openEditModal = (cred: GemCredential) => {
    setFormData({
      firmCode: cred.firmCode,
      gemUserId: cred.gemUserId || "",
      gemPassword: cred.gemPassword || "",
      gemMailId: cred.gemMailId || "",
    });
    setIsEditing(true);
    setShowPassword(false);
    setStatus("");
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username) return;
    if (!formData.firmCode.trim()) {
      setStatus("Please select a firm.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/gem-credentials", {
        method: "POST",
        body: JSON.stringify({ ...formData, username }),
        headers: { "Content-Type": "application/json" },
      });
      const result = await res.json();
      if (res.ok) {
        fetchCredentials(username);
        closeModal();
      } else {
        setStatus(result.error || "Error saving credentials.");
      }
    } catch (err) {
      setStatus("Error saving credentials.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (firmCode: string) => {
    if (!username) return;
    if (!confirm(`Remove your saved GeM credentials for ${firmCode}?`)) return;
    try {
      const res = await fetch(`/api/gem-credentials?firmCode=${encodeURIComponent(firmCode)}&username=${encodeURIComponent(username)}`, { method: "DELETE" });
      if (res.ok) {
        fetchCredentials(username);
        if (formData.firmCode === firmCode) closeModal();
      }
    } catch (err) {
      console.error("Failed to delete credentials", err);
    }
  };

  const toggleReveal = (firmCode: string) => {
    setRevealedRows((prev) => {
      const next = new Set(prev);
      if (next.has(firmCode)) next.delete(firmCode);
      else next.add(firmCode);
      return next;
    });
  };

  const firmName = (firmCode: string) => companies.find((c) => c.firmCode === firmCode)?.firmName || firmCode;

  const handleLogin = async (cred: GemCredential) => {
    if (!cred.gemUserId || !cred.gemPassword) {
      alert("Pehle User ID aur Password save karo.");
      return;
    }
    setLoggingInFirm(cred.firmCode);
    try {
      await triggerGemLogin({ gemUserId: cred.gemUserId, gemPassword: cred.gemPassword, gemMailId: cred.gemMailId });
    } catch (err: any) {
      alert("GeM login trigger nahi hua: " + err.message);
    } finally {
      setLoggingInFirm(null);
    }
  };

  if (username === null) return null; // resolving session
  if (!username) {
    return (
      <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center">
        <p className="text-red-500 font-bold uppercase">Please log in to manage your GeM logins.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-12 max-w-5xl mx-auto space-y-4">
      <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition-colors font-bold text-xs uppercase tracking-widest">
        <FiArrowLeft /> Back
      </button>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-8 text-white flex items-center justify-between gap-4 bg-[#0f172a]">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-orange-500/20 rounded-2xl text-orange-400">
              <FiKey size={32} />
            </div>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tight">GeM Login Setup</h1>
              <p className="text-orange-400 text-[10px] font-black tracking-[0.2em] uppercase mt-1">
                Your Own Firm-Wise GeM Portal Credentials
              </p>
            </div>
          </div>
          <button
            onClick={openAddModal}
            className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white font-black text-[11px] uppercase tracking-widest px-5 py-3 rounded-xl transition-all shrink-0"
          >
            <FiPlus size={16} /> Add
          </button>
        </div>

        <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4 bg-slate-50/50">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">
            Only visible to you — other team members save their own separately.
          </p>
          <div className="relative w-full md:w-72">
            <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search firm, user id, mail..."
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 text-xs font-bold focus:ring-2 focus:ring-orange-500/20 outline-none"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50">
                <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Firm</th>
                <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">User ID</th>
                <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Password</th>
                <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Mail ID</th>
                <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCredentials.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-10 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">
                    No GeM credentials saved yet — click "Add" to save your first one
                  </td>
                </tr>
              ) : (
                filteredCredentials.map((cred) => {
                  const revealed = revealedRows.has(cred.firmCode);
                  return (
                    <tr key={cred._id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-5">
                        <span className="bg-orange-50 text-orange-600 px-3 py-1 rounded-lg font-black text-xs tracking-widest border border-orange-100">
                          {cred.firmCode}
                        </span>
                        <div className="text-[10px] text-slate-400 font-bold mt-1 uppercase">{firmName(cred.firmCode)}</div>
                      </td>
                      <td className="p-5 font-bold text-slate-700 text-xs">{cred.gemUserId || "---"}</td>
                      <td className="p-5 font-bold text-slate-700 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-mono">{revealed ? (cred.gemPassword || "---") : "••••••••"}</span>
                          {cred.gemPassword && (
                            <button
                              type="button"
                              onClick={() => toggleReveal(cred.firmCode)}
                              className="text-slate-400 hover:text-slate-600"
                              title={revealed ? "Hide password" : "Show password"}
                            >
                              {revealed ? <FiEyeOff size={14} /> : <FiEye size={14} />}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="p-5 font-medium text-slate-600 text-xs">{cred.gemMailId || "---"}</td>
                      <td className="p-5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleLogin(cred)}
                            disabled={loggingInFirm === cred.firmCode}
                            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-[10px] uppercase tracking-widest px-3 py-2 rounded-lg transition-all"
                            title="Open GeM and fill in this Username/Password (Captcha still needs you)"
                          >
                            <FiLogIn size={14} /> {loggingInFirm === cred.firmCode ? "Opening..." : "Login"}
                          </button>
                          <button
                            onClick={() => openEditModal(cred)}
                            className="p-2 bg-slate-100 text-slate-400 rounded-lg hover:bg-orange-600 hover:text-white transition-all shadow-sm cursor-pointer"
                            title="Edit Credentials"
                          >
                            <FiEdit3 size={16} />
                          </button>
                          <button
                            onClick={() => handleDelete(cred.firmCode)}
                            className="p-2 bg-slate-100 text-slate-400 rounded-lg hover:bg-rose-600 hover:text-white transition-all shadow-sm cursor-pointer"
                            title="Delete Credentials"
                          >
                            <FiTrash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl overflow-hidden w-full max-w-xl">
            <div className={`p-6 text-white flex items-center justify-between gap-4 transition-colors duration-300 ${isEditing ? "bg-orange-600" : "bg-[#0f172a]"}`}>
              <div className="flex items-center gap-3">
                <div className="p-3 bg-orange-500/20 rounded-xl text-orange-400">
                  <FiKey size={22} />
                </div>
                <div>
                  <h2 className="text-lg font-black uppercase tracking-tight">
                    {isEditing ? "Update GeM Login" : "Add GeM Login"}
                  </h2>
                  <p className="text-orange-400 text-[9px] font-black tracking-[0.2em] uppercase mt-0.5">Only saved for you</p>
                </div>
              </div>
              <button onClick={closeModal} className="text-white/60 hover:text-white transition-colors">
                <FiX size={22} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              {status && (
                <div className="bg-rose-50 text-rose-600 p-3 rounded-xl flex items-center gap-3 font-bold text-xs border border-rose-100">
                  {status}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Firm *</label>
                <select
                  required
                  autoFocus
                  disabled={isEditing}
                  value={formData.firmCode}
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-orange-500/10 transition-all disabled:opacity-60"
                  onChange={(e) => setFormData({ ...formData, firmCode: e.target.value })}
                >
                  <option value="">Select Firm</option>
                  {firmOptions.map((f) => (
                    <option key={f._id} value={f.firmCode}>{f.firmCode} - {f.firmName}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">GeM User ID</label>
                <div className="relative">
                  <FiUser className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={formData.gemUserId}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-orange-500/10 transition-all"
                    placeholder="GeM portal login ID"
                    onChange={(e) => setFormData({ ...formData, gemUserId: e.target.value })}
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">GeM Password</label>
                <div className="relative">
                  <FiLock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={formData.gemPassword}
                    className="w-full pl-12 pr-12 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-orange-500/10 transition-all"
                    placeholder="GeM portal password"
                    onChange={(e) => setFormData({ ...formData, gemPassword: e.target.value })}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    tabIndex={-1}
                  >
                    {showPassword ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Mail ID</label>
                <div className="relative">
                  <FiMail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    value={formData.gemMailId}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-orange-500/10 transition-all"
                    placeholder="mail linked to this GeM account"
                    onChange={(e) => setFormData({ ...formData, gemMailId: e.target.value })}
                  />
                </div>
              </div>

              <button
                type="submit" disabled={loading}
                className={`w-full text-white font-black py-4 rounded-2xl shadow-lg flex items-center justify-center gap-3 transition-all uppercase tracking-widest text-sm active:scale-95 ${
                  isEditing ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-100" : "bg-[#ff5100] hover:bg-orange-700 shadow-orange-100"
                }`}
              >
                <FiSave size={18} /> {loading ? "Saving..." : isEditing ? "Update Credentials" : "Save Credentials"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
