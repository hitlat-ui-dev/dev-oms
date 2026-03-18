"use client";
import { useState, useEffect } from "react";
import { FiRotateCcw, FiPackage, FiTruck, FiAlertCircle } from "react-icons/fi";

export default function PurchaseReturnPage() {
  const [stockList, setStockList] = useState([]);
  const [returnHistory, setReturnHistory] = useState([]);
  const [isSaving, setIsSaving] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    itemId: "",
    returnQty: 0,
    reason: ""
  });

  const fetchData = async () => {
    try {
      const res = await fetch("/api/purchase-return");
      const data = await res.json();
      setStockList(data.stock || []);
      setReturnHistory(data.returns || []);
    } catch (err) {
      console.error("Failed to fetch return data", err);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSaveReturn = async () => {
    const selectedItem: any = stockList.find((s: any) => s._id === formData.itemId);
    
    if (!selectedItem || formData.returnQty <= 0) {
      return alert("Please select an item and enter a valid quantity.");
    }
    
    if (formData.returnQty > selectedItem.quantity) {
      return alert(`Error: You only have ${selectedItem.quantity} in stock.`);
    }

    setIsSaving(true);
    try {
      const res = await fetch("/api/purchase-return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: formData.itemId,
          returnQty: formData.returnQty,
          reason: formData.reason,
          itemName: selectedItem.itemName,
          sku: selectedItem.sku,
          vendor: selectedItem.vendor,
          category: selectedItem.category
        }),
      });

      if (res.ok) {
        alert("✅ Return processed and stock updated.");
        setFormData({ itemId: "", returnQty: 0, reason: "" });
        fetchData();
      }
    } catch (err) {
      alert("❌ Error processing return.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-6 bg-slate-50 min-h-screen">
      {/* 1. Header & Form Section */}
      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-red-50 text-red-600 rounded-2xl">
            <FiRotateCcw size={20} />
          </div>
          <div>
            <h1 className="text-sm font-black uppercase tracking-tight text-slate-800">Purchase Return</h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase">Reduce stock and record vendor returns</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div className="md:col-span-1">
            <label className="text-[10px] font-black uppercase text-slate-400 mb-2 block ml-1">Select Stock Item</label>
            <select 
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
              value={formData.itemId}
              onChange={(e) => setFormData({...formData, itemId: e.target.value})}
            >
              <option value="">-- Select Item --</option>
              {stockList.map((s: any) => (
                <option key={s._id} value={s._id}>
                  {s.itemName} ({s.sku}) — Available: {s.quantity}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 mb-2 block ml-1">Return Qty</label>
            <input 
              type="number" 
              placeholder="0"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-red-500"
              value={formData.returnQty || ""}
              onChange={(e) => setFormData({...formData, returnQty: Number(e.target.value)})}
            />
          </div>
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 mb-2 block ml-1">Reason for Return</label>
            <input 
              type="text" 
              placeholder="e.g. Expired, Damaged"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-red-500"
              value={formData.reason}
              onChange={(e) => setFormData({...formData, reason: e.target.value})}
            />
          </div>
          <button 
            onClick={handleSaveReturn}
            disabled={isSaving}
            className="bg-slate-900 text-white font-black uppercase py-3.5 rounded-xl text-[10px] hover:bg-black transition-all shadow-xl shadow-slate-200 disabled:opacity-50"
          >
            {isSaving ? "Processing..." : "Confirm Return"}
          </button>
        </div>
      </div>

      {/* 2. History Table Section */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-slate-50 flex justify-between items-center">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Return History</h2>
        </div>
        <table className="w-full text-left">
          <thead className="bg-slate-50/80">
            <tr>
              <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400">Date</th>
              <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400">Item & SKU</th>
              <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400">Vendor</th>
              <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400 text-center">Qty</th>
              <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400">Reason</th>
              <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {returnHistory.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-[10px] font-bold text-slate-300 uppercase tracking-widest">No returns recorded yet</td>
              </tr>
            ) : (
              returnHistory.map((item: any) => (
                <tr key={item._id} className="hover:bg-red-50/30 transition-colors group">
                  <td className="py-4 px-6 text-[11px] font-bold text-slate-500">
                    {new Date(item.createdAt).toLocaleDateString('en-GB')}
                  </td>
                  <td className="py-4 px-6">
                    <div className="flex flex-col">
                      <span className="text-[9px] font-bold text-red-500 mb-0.5">{item.sku}</span>
                      <span className="font-black text-slate-800 text-xs uppercase">{item.itemName}</span>
                    </div>
                  </td>
                  <td className="py-4 px-6 text-[10px] font-black text-slate-600 uppercase">{item.vendor}</td>
                  <td className="py-4 px-6 text-center">
                    <span className="inline-block px-2 py-1 bg-red-100 text-red-700 rounded-md text-[11px] font-black">-{item.returnQty}</span>
                  </td>
                  <td className="py-4 px-6 text-[10px] font-bold text-slate-400 italic">"{item.reason}"</td>
                  <td className="py-4 px-6 text-right">
                    <span className="px-3 py-1 bg-slate-100 text-slate-500 rounded-full text-[9px] font-black uppercase">Processed</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}