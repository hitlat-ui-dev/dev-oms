"use client";
import { useState, useEffect, useMemo } from "react";
import { FiSave, FiArrowLeft } from "react-icons/fi";
import { useRouter } from "next/navigation";

export default function AddSellerOrderPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [sellers, setSellers] = useState<any[]>([]);
  const [stocks, setStocks] = useState<any[]>([]);
  const [firms, setFirms] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    firmCode: "",
    sellerId: "",
    instituteName: "",
    itemId: "",
    itemName: "",
    category: "",
    unit: "",
    contractDate: "",
    contractNo: "",
    contractUrl: "",
    orderQty: 0,
    rate: 0,
    remark: ""
  });

  // Load all dependency data
  useEffect(() => {
    const loadData = async () => {
      try {
        const [selRes, stkRes, firmRes] = await Promise.all([
          fetch("/api/sellers"),
          fetch("/api/stock"),
          fetch("/api/companies")
        ]);

        const selData = await selRes.json() as any;
        const stkData = await stkRes.json() as any;
        const firmData = await firmRes.json() as any;

        setSellers(Array.isArray(selData) ? selData : []);
        setStocks(Array.isArray(stkData) ? stkData : []);
        setFirms(Array.isArray(firmData) ? firmData : []);
        
      } catch (err) { 
        console.error("Load error", err); 
      }
    };
    loadData();
  }, []);

  const totalAmount = useMemo(() => formData.orderQty * formData.rate, [formData.orderQty, formData.rate]);

  /** * SMART PASTE LOGIC
   * When you paste a link, it extracts the URL and the Text separately.
   */
  const handleContractPaste = (e: React.ClipboardEvent) => {
    const html = e.clipboardData.getData("text/html");
    const plainText = e.clipboardData.getData("text/plain");

    if (html) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const link = doc.querySelector("a");

      if (link) {
        e.preventDefault(); // Stop default paste
        setFormData({
          ...formData,
          contractNo: link.textContent || plainText,
          contractUrl: link.href
        });
        return;
      }
    }
    // Default behavior if not a link
    setFormData({ ...formData, contractNo: plainText });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/seller-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, totalAmount })
      });

      if (res.ok) {
        alert("Order Saved Successfully!");
        window.location.reload(); 
      } else {
        const err = await res.json();
        alert(`Error: ${err.error || "Failed to save"}`);
      }
    } catch (error) {
      alert("Check your server connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-12 max-w-5xl mx-auto space-y-8">
      <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 font-bold text-xs uppercase tracking-widest">
        <FiArrowLeft /> Back
      </button>

      <div className="bg-white rounded-[2.5rem] shadow-2xl border border-slate-200 overflow-hidden">
        <div className="bg-[#1e293b] p-8 text-white">
          <h1 className="text-2xl font-black uppercase tracking-tight">Seller Order Entry</h1>
        </div>

        <form onSubmit={handleSubmit} className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Firm Code *</label>
            <select 
              required 
              className="w-full p-4 bg-slate-50 border rounded-2xl font-bold outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.firmCode}
              onChange={(e) => setFormData({...formData, firmCode: e.target.value})}
            >
              <option value="">Select Firm</option>
              {firms.map((f: any) => (
                <option key={f._id} value={f.firmCode}>
                  {f.firmCode} - {f.firmName}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Institute Name *</label>
            <select 
              required 
              className="w-full p-4 bg-slate-50 border rounded-2xl font-bold outline-none"
              value={formData.sellerId}
              onChange={(e) => {
                const s: any = sellers.find((x: any) => x._id === e.target.value);
                setFormData({...formData, sellerId: e.target.value, instituteName: s?.instituteName || ""});
              }}>
              <option value="">Select Institute</option>
              {sellers.map((s: any) => <option key={s._id} value={s._id}>{s.instituteName}</option>)}
            </select>
          </div>

          <div className="md:col-span-2 space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Item Name (Category | Unit) *</label>
            <select 
              required 
              className="w-full p-4 bg-slate-50 border rounded-2xl font-bold outline-none"
              value={formData.itemId}
              onChange={(e) => {
                const i: any = stocks.find((x: any) => x._id === e.target.value);
                setFormData({
                    ...formData, 
                    itemId: e.target.value, 
                    itemName: i?.itemName || "", 
                    category: i?.category || "", 
                    unit: i?.unit || ""
                });
              }}>
              <option value="">Select Item</option>
              {stocks.map((i: any) => (
                <option key={i._id} value={i._id}>
                  {i.itemName} — {i.category} ({i.unit})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Contract Date</label>
            <input type="date" className="w-full p-4 bg-slate-50 border rounded-2xl font-bold" 
              value={formData.contractDate}
              onChange={(e) => setFormData({...formData, contractDate: e.target.value})} />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Contract No. (Paste Link here) *</label>
            <input 
              type="text" 
              required
              className="w-full p-4 bg-slate-50 border rounded-2xl font-bold focus:ring-2 focus:ring-blue-400 outline-none" 
              placeholder="Paste GEM Link..."
              value={formData.contractNo}
              onPaste={handleContractPaste}
              onChange={(e) => setFormData({...formData, contractNo: e.target.value})} 
            />
            {formData.contractUrl && (
              <p className="text-[9px] text-blue-600 font-bold px-2 italic truncate">URL: {formData.contractUrl}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Order Qty *</label>
            <input type="number" required className="w-full p-4 bg-slate-50 border rounded-2xl font-bold" 
              value={formData.orderQty}
              onChange={(e) => setFormData({...formData, orderQty: Number(e.target.value)})} />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Rate</label>
            <input type="number" className="w-full p-4 bg-slate-50 border rounded-2xl font-bold" 
              value={formData.rate}
              onChange={(e) => setFormData({...formData, rate: Number(e.target.value)})} />
          </div>

          <div className="md:col-span-2 p-6 bg-slate-900 rounded-2xl flex justify-between items-center text-white">
             <span className="font-black uppercase tracking-widest text-xs">Calculated Total</span>
             <span className="text-2xl font-black">₹ {totalAmount.toLocaleString()}</span>
          </div>

          <div className="md:col-span-2 space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Remark</label>
            <textarea className="w-full p-4 bg-slate-50 border rounded-2xl font-bold"
              placeholder="Optional notes..."
              value={formData.remark}
              onChange={(e) => setFormData({...formData, remark: e.target.value})} />
          </div>

          <button type="submit" disabled={loading} className="md:col-span-2 w-full bg-blue-600 text-white font-black py-5 rounded-2xl shadow-xl active:scale-95 transition-all uppercase tracking-widest">
            {loading ? "Saving..." : "Save Seller Order"}
          </button>
        </form>
      </div>
    </div>
  );
}