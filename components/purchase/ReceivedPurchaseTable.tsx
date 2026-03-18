"use client";
import { useState, useMemo } from "react";
import { FiSave, FiSearch, FiCalendar, FiUser, FiTag } from "react-icons/fi";

export default function ReceivedPurchaseTable({ data, onRefresh }: { data: any[], onRefresh: () => void }) {
  const [editState, setEditState] = useState<Record<string, any>>({});
  const [isUpdating, setIsUpdating] = useState<string | null>(null);

  // Filter States
  const [filterDate, setFilterDate] = useState("");
  const [filterItem, setFilterItem] = useState("");
  const [filterVendor, setFilterVendor] = useState("");
  const [filterCategory, setFilterCategory] = useState("");

  // 1. Filter Logic
  const filteredData = useMemo(() => {
    if (!Array.isArray(data)) return [];
    return data.filter((item) => {
      const dateStr = new Date(item.receivedAt).toLocaleDateString('en-CA'); // yyyy-mm-dd
      const dateMatch = filterDate ? dateStr.includes(filterDate) : true;
      const itemMatch = item.itemName?.toLowerCase().includes(filterItem.toLowerCase()) || 
                         item.sku?.toLowerCase().includes(filterItem.toLowerCase());
      const vendorMatch = (item.vendor || "").toLowerCase().includes(filterVendor.toLowerCase());
      const catMatch = (item.category || "").toLowerCase().includes(filterCategory.toLowerCase());
      
      return dateMatch && itemMatch && vendorMatch && catMatch;
    });
  }, [data, filterDate, filterItem, filterVendor, filterCategory]);

  const handleLocalChange = (id: string, field: string, value: any) => {
    setEditState(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value }
    }));
  };

  const handleUpdate = async (item: any) => {
    const updates = editState[item._id];
    setIsUpdating(item._id);
    
    try {
      const res = await fetch("/api/received-purchase", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item._id,
          receivedQty: updates.receivedQty ?? item.receivedQty,
          rate: updates.rate ?? item.rate,
        }),
      });

      if (res.ok) {
        alert("✅ Update saved!");
        setEditState(prev => {
          const newState = { ...prev };
          delete newState[item._id];
          return newState;
        });
        onRefresh(); 
      }
    } catch (err) {
      alert("❌ Update failed");
    } finally {
      setIsUpdating(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 2. Filter Bar */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="relative">
          <label className="text-[10px] font-black uppercase text-slate-400 mb-1.5 block px-1">Date</label>
          <div className="relative">
            <FiCalendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="date" className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500" onChange={(e) => setFilterDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="text-[10px] font-black uppercase text-slate-400 mb-1.5 block px-1">Item / SKU</label>
          <div className="relative">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Search item..." className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500" onChange={(e) => setFilterItem(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="text-[10px] font-black uppercase text-slate-400 mb-1.5 block px-1">Vendor</label>
          <div className="relative">
            <FiUser className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Vendor name..." className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500" onChange={(e) => setFilterVendor(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="text-[10px] font-black uppercase text-slate-400 mb-1.5 block px-1">Category</label>
          <div className="relative">
            <FiTag className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Category..." className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500" onChange={(e) => setFilterCategory(e.target.value)} />
          </div>
        </div>
      </div>

      {/* 3. Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50/80 border-b border-slate-100">
            <tr>
              <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400">Order ID</th>
              <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400">Date</th>
              <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400">Item Details</th>
              <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400">Category</th>
              <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400">Vendor</th>
              <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400 text-center">Rec. Qty</th>
              <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400 text-center">Rate</th>
              <th className="py-4 px-6 text-[10px] font-black uppercase text-slate-400 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filteredData.map((item) => (
              <tr key={item._id} className="hover:bg-slate-50 transition-colors">
                <td className="py-4 px-6 font-black text-blue-600 text-xs">{item.orderNumber || "---"}</td>
                <td className="py-4 px-6 text-[11px] font-bold text-slate-500">
                  {new Date(item.receivedAt).toLocaleDateString('en-GB')}
                </td>
                <td className="py-4 px-6">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-bold text-blue-500 mb-0.5">{item.sku || "N/A"}</span>
                    <span className="font-black text-slate-800 text-xs uppercase">{item.itemName}</span>
                  </div>
                </td>
                <td className="py-4 px-6 text-[10px] font-bold text-slate-400 uppercase">{item.category || "General"}</td>
                <td className="py-4 px-6 text-[10px] font-black text-slate-600 uppercase">{item.vendor}</td>
                
                <td className="py-4 px-6 text-center">
                  <input 
                    type="number"
                    className="w-16 bg-blue-50 border border-blue-100 rounded-lg px-2 py-1.5 text-xs font-black text-blue-700 text-center outline-none focus:ring-2 focus:ring-blue-500"
                    value={editState[item._id]?.receivedQty ?? item.receivedQty}
                    onChange={(e) => handleLocalChange(item._id, 'receivedQty', e.target.value)}
                  />
                </td>

                <td className="py-4 px-6 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <span className="text-xs font-bold text-slate-400">₹</span>
                    <input 
                      type="number"
                      className="w-20 bg-green-50 border border-green-100 rounded-lg px-2 py-1.5 text-xs font-black text-green-700 text-center outline-none focus:ring-2 focus:ring-green-500"
                      value={editState[item._id]?.rate ?? item.rate}
                      onChange={(e) => handleLocalChange(item._id, 'rate', e.target.value)}
                    />
                  </div>
                </td>

                <td className="py-4 px-6 text-right">
                  {editState[item._id] && (
                    <button 
                      onClick={() => handleUpdate(item)}
                      disabled={isUpdating === item._id}
                      className="p-2.5 bg-slate-900 text-white rounded-xl hover:bg-black transition-all shadow-md active:scale-95 disabled:opacity-50"
                    >
                      <FiSave size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredData.length === 0 && (
          <div className="p-10 text-center text-slate-400 font-bold uppercase text-[10px] tracking-widest">
            No matching records found
          </div>
        )}
      </div>
    </div>
  );
}