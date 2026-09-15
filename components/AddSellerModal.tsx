"use client";
import { useEffect, useState } from "react";
import { FiX, FiSave, FiBriefcase, FiUser, FiPhone, FiMessageCircle, FiMapPin, FiFileText } from "react-icons/fi";

interface AddSellerModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Called with the newly-created seller doc right after a successful save,
  // before onClose - lets the caller (e.g. Verify GeM Order) auto-select it.
  onCreated?: (seller: { _id: string; instituteName: string }) => void;
  // Pre-fills the form from context the caller already has (e.g. the raw
  // GeM order's own institute/location text) so less has to be retyped.
  prefill?: { instituteName?: string; gemLocationText?: string };
}

const emptyForm = {
  instituteName: "",
  buyerName: "",
  mobile: "",
  whatsappNumber: "",
  address: "",
  place: "",
  state: "",
  sellerBillName: "",
  gemLocationText: "",
};

export default function AddSellerModal({ isOpen, onClose, onCreated, prefill }: AddSellerModalProps) {
  const [formData, setFormData] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setFormData({
      ...emptyForm,
      instituteName: prefill?.instituteName || "",
      gemLocationText: prefill?.gemLocationText || "",
    });
    setError("");
  }, [isOpen, prefill?.instituteName, prefill?.gemLocationText]);

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
    if (!formData.instituteName.trim()) {
      setError("Institute Name is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/sellers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save seller.");
        return;
      }
      onCreated?.(data);
      onClose();
    } catch (err) {
      setError("Network error while saving seller.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="bg-[#0f172a] p-5 text-white flex justify-between items-center">
          <h2 className="font-black uppercase tracking-widest text-xs text-blue-400">Add Seller / Institute</h2>
          <button onClick={onClose} className="hover:bg-white/10 p-2 rounded-lg transition-colors">
            <FiX size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {error && (
            <div className="bg-red-50 text-red-600 border border-red-100 rounded-lg p-3 text-xs font-bold">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
              Institute Name <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <FiBriefcase className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                autoFocus
                required
                value={formData.instituteName}
                onChange={(e) => setFormData({ ...formData, instituteName: e.target.value })}
                className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-sm text-slate-700 focus:ring-4 focus:ring-blue-500/10 transition-all"
                placeholder="Institute Name"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Buyer Name</label>
              <div className="relative">
                <FiUser className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input
                  type="text"
                  value={formData.buyerName}
                  onChange={(e) => setFormData({ ...formData, buyerName: e.target.value })}
                  className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-sm text-slate-700 focus:ring-4 focus:ring-blue-500/10 transition-all"
                  placeholder="Contact person"
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
                  className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-sm text-slate-700 focus:ring-4 focus:ring-blue-500/10 transition-all"
                  placeholder="Mobile"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">WhatsApp No.</label>
              <div className="relative">
                <FiMessageCircle className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input
                  type="text"
                  value={formData.whatsappNumber}
                  onChange={(e) => setFormData({ ...formData, whatsappNumber: e.target.value })}
                  className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-sm text-slate-700 focus:ring-4 focus:ring-blue-500/10 transition-all"
                  placeholder="For courier updates"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Place</label>
              <div className="relative">
                <FiMapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input
                  type="text"
                  value={formData.place}
                  onChange={(e) => setFormData({ ...formData, place: e.target.value })}
                  className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-sm text-slate-700 focus:ring-4 focus:ring-blue-500/10 transition-all"
                  placeholder="City"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
              State <span className="text-slate-400 font-normal lowercase">(for CGST/SGST vs IGST)</span>
            </label>
            <div className="relative">
              <FiMapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-sm text-slate-700 focus:ring-4 focus:ring-blue-500/10 transition-all"
                placeholder="e.g. Gujarat"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Seller Bill Name</label>
            <div className="relative">
              <FiFileText className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                value={formData.sellerBillName}
                onChange={(e) => setFormData({ ...formData, sellerBillName: e.target.value })}
                className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-sm text-slate-700 focus:ring-4 focus:ring-blue-500/10 transition-all"
                placeholder="Name used on invoices"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Full Address</label>
            <div className="relative">
              <FiMapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-sm text-slate-700 focus:ring-4 focus:ring-blue-500/10 transition-all"
                placeholder="Street Address"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
              GeM Location <span className="text-slate-400 font-normal lowercase">(for auto-match on future orders)</span>
            </label>
            <div className="relative">
              <FiMapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                value={formData.gemLocationText}
                onChange={(e) => setFormData({ ...formData, gemLocationText: e.target.value })}
                className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-sm text-slate-700 focus:ring-4 focus:ring-blue-500/10 transition-all"
                placeholder='e.g. "Govt. industrial training institute, deodar..."'
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-black py-3.5 rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all tracking-widest text-xs uppercase"
          >
            <FiSave size={16} /> {saving ? "Saving..." : "Save Seller"}
          </button>
        </form>
      </div>
    </div>
  );
}
