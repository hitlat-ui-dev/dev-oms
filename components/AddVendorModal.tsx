"use client";
import { useEffect, useState } from "react";
import { FiX, FiSave, FiUserPlus, FiMapPin, FiPhone, FiHome } from "react-icons/fi";

interface AddVendorModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Called with the newly-created vendor doc right after a successful save,
  // before onClose - lets the caller (e.g. Purchase page) immediately select
  // it and merge it into its own vendor list without a full refetch.
  onCreated?: (vendor: { _id: string; name: string; place: string; mobile?: string; address?: string }) => void;
}

const emptyForm = { name: "", place: "", mobile: "", address: "" };

export default function AddVendorModal({ isOpen, onClose, onCreated }: AddVendorModalProps) {
  const [formData, setFormData] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setFormData(emptyForm);
    setError("");
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.place.trim()) {
      setError("Vendor Name and Place are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || "Failed to save vendor.");
        return;
      }
      onCreated?.(data.data);
      onClose();
    } catch (err) {
      setError("Network error while saving vendor.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="bg-[#0f172a] p-5 text-white flex justify-between items-center">
          <h2 className="font-black uppercase tracking-widest text-xs text-purple-400">Add Vendor</h2>
          <button onClick={onClose} className="hover:bg-white/10 p-2 rounded-lg transition-colors">
            <FiX size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-600 border border-red-100 rounded-lg p-3 text-xs font-bold">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
              Vendor Name <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <FiUserPlus className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                autoFocus
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-sm uppercase text-slate-700 focus:ring-4 focus:ring-purple-500/10 transition-all"
                placeholder="Company/vendor name"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                Place <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <FiMapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input
                  type="text"
                  required
                  value={formData.place}
                  onChange={(e) => setFormData({ ...formData, place: e.target.value })}
                  className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-sm uppercase text-slate-700 focus:ring-4 focus:ring-purple-500/10 transition-all"
                  placeholder="City/town"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Mobile No.</label>
              <div className="relative">
                <FiPhone className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input
                  type="text"
                  value={formData.mobile}
                  onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                  className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-sm text-slate-700 focus:ring-4 focus:ring-purple-500/10 transition-all"
                  placeholder="Mobile"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Address</label>
            <div className="relative">
              <FiHome className="absolute left-3.5 top-3 text-slate-400" size={14} />
              <textarea
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-sm text-slate-700 focus:ring-4 focus:ring-purple-500/10 transition-all min-h-20 resize-none"
                placeholder="Full business address"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-[#8b2ef5] hover:bg-purple-700 disabled:bg-slate-300 text-white font-black py-3.5 rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all tracking-widest text-xs uppercase"
          >
            <FiSave size={16} /> {saving ? "Saving..." : "Save Vendor"}
          </button>
        </form>
      </div>
    </div>
  );
}
