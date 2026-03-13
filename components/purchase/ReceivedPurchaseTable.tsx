"use client";
import { useState } from "react";
import { FiSave } from "react-icons/fi";

export default function ReceivedPurchaseTable({ data, onRefresh }: { data: any[], onRefresh: () => void }) {
  const [editState, setEditState] = useState<Record<string, any>>({});

  const handleLocalChange = (id: string, field: string, value: any) => {
    setEditState(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value }
    }));
  };

const handleUpdate = async (item: any) => {
  const updates = editState[item._id];
  
  try {
    const res = await fetch("/api/received-purchase", { // Same URL as POST
      method: "PATCH", // Different method triggers the PATCH function above
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: item._id,
        receivedQty: updates.receivedQty ?? item.receivedQty,
        rate: updates.rate ?? item.rate,
      }),
    });

    if (res.ok) {
      alert("✅ Update saved!");
      onRefresh(); 
    }
  } catch (err) {
    alert("❌ Update failed");
  }
};

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden">
      <table className="w-full text-left border-collapse table-auto">
        <thead className="bg-slate-50 border-b border-slate-100">
          <tr>
            <th className="py-3 px-6 text-[10px] font-black uppercase text-slate-400">Date</th>
            <th className="py-3 px-6 text-[10px] font-black uppercase text-slate-400">Item Name</th>
            <th className="py-3 px-6 text-[10px] font-black uppercase text-slate-400">Vendor</th>
            <th className="py-3 px-6 text-[10px] font-black uppercase text-slate-400 text-center">R-Qty</th>
            <th className="py-3 px-6 text-[10px] font-black uppercase text-slate-400 text-center">PR-Qty</th>
            <th className="py-3 px-6 text-[10px] font-black uppercase text-slate-400 text-center">OP-Qty</th>
            <th className="py-3 px-6 text-[10px] font-black uppercase text-slate-400 text-center">Rate</th>
            <th className="py-3 px-6 text-[10px] font-black uppercase text-slate-400 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {data.map((item) => (
            <tr key={item._id} className="hover:bg-gray-50 transition-all group">
              <td className="py-3 px-6 text-[11px] font-bold text-slate-500">
                {new Date(item.receivedAt).toLocaleDateString('en-GB')}
              </td>
              <td className="py-3 px-6 font-black text-slate-800 text-xs uppercase">{item.itemName}</td>
              <td className="py-3 px-6 text-[10px] font-black text-slate-600 uppercase">{item.vendor}</td>
              
              {/* Editable Received Qty */}
              <td className="py-3 px-6 text-center">
                <input 
                  type="number"
                  className="w-16 bg-blue-50 border border-blue-100 rounded px-2 py-1 text-xs font-bold text-blue-700 text-center outline-none focus:border-blue-500"
                  value={editState[item._id]?.receivedQty ?? item.receivedQty}
                  onChange={(e) => handleLocalChange(item._id, 'receivedQty', e.target.value)}
                />
              </td>

              <td className="py-3 px-6 text-center font-bold text-slate-400 text-xs">{item.prQty}</td>
              <td className="py-3 px-6 text-center font-bold text-slate-400 text-xs">{item.orderQty}</td>

              {/* Editable Rate */}
              <td className="py-3 px-6 text-center">
                <input 
                  type="number"
                  className="w-20 bg-green-50 border border-green-100 rounded px-2 py-1 text-xs font-bold text-green-700 text-center outline-none focus:border-green-500"
                  value={editState[item._id]?.rate ?? item.rate}
                  onChange={(e) => handleLocalChange(item._id, 'rate', e.target.value)}
                />
              </td>

              <td className="py-3 px-6 text-right">
                {editState[item._id] && (
                  <button 
                    onClick={() => handleUpdate(item)}
                    className="p-2 bg-slate-900 text-white rounded-lg hover:bg-black transition-all shadow-lg"
                  >
                    <FiSave size={14} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}