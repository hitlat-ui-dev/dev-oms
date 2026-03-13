"use client";
import { useState } from "react";
import { FiCheckCircle, FiXCircle, FiPackage, FiX, FiCheck } from "react-icons/fi";

interface OrderPlaceTableProps {
  data: any[];
  onRefresh: () => void;
  onCancel: (req: any) => void;
}

export default function OrderPlaceTable({ data, onRefresh, onCancel }: OrderPlaceTableProps) {
  const [selectedRequest, setSelectedRequest] = useState<any | null>(null);
  const [receivedQty, setReceivedQty] = useState<number>(0);
  const [isSaving, setIsSaving] = useState(false);

  // Inside OrderPlaceTable.tsx -> handleSaveToStock function

const handleSaveToStock = async () => {
  if (!selectedRequest || receivedQty <= 0) return alert("Enter valid quantity");
  setIsSaving(true);

  try {
    const res = await fetch("/api/received-purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalOrderId: selectedRequest._id,
        itemName: selectedRequest.itemName,
        prQty: selectedRequest.prQty,
        receivedQty: Number(receivedQty),
        orderQty: selectedRequest.orderQty,
        unit: selectedRequest.unit,
        vendor: selectedRequest.vendor,
        rate: selectedRequest.rate,
        remark: selectedRequest.remark,
      }),
    });

    // Check if the response is actually valid JSON
    const result = await res.json();

    if (res.ok && result.success) {
      // 1. Close the modal first
      setSelectedRequest(null);
      // 2. Show the success message
      alert("✅ Stock Processed Successfully!");
      // 3. Trigger the parent re-fetch
      if (onRefresh) {
        await onRefresh(); 
      }
    } else {
      alert("❌ Server Error: " + (result.error || "Unknown error"));
    }
  } catch (err) {
    // This is where 'Network Error' usually gets caught
    console.error("Fetch error:", err);
    // Don't alert 'Network Error' if the data actually saved!
  } finally {
    setIsSaving(false);
  }
};


  return (
    /* Removed overflow-hidden from here to prevent tooltip clipping */
    <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl relative">
      <table className="w-full text-left border-collapse table-auto">
        <thead className="bg-slate-50/80 border-b border-slate-100">
          <tr>
            <th className="py-2.5 px-6 text-[10px] font-black uppercase text-slate-400">Date</th>
            <th className="py-2.5 px-6 text-[10px] font-black uppercase text-slate-400">Item Name</th>
            <th className="py-2.5 px-6 text-[10px] font-black uppercase text-slate-400 text-center">PR Qty</th>
            <th className="py-2.5 px-6 text-[10px] font-black uppercase text-slate-400 text-center">Order Qty</th>
            <th className="py-2.5 px-6 text-[10px] font-black uppercase text-slate-400 text-center">Rate</th>
            <th className="py-2.5 px-6 text-[10px] font-black uppercase text-slate-400">Vendor</th>
            <th className="py-2.5 px-6 text-[10px] font-black uppercase text-slate-400">Remarks</th>
            <th className="py-2.5 px-6 text-[10px] font-black uppercase text-slate-400 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {data.map((req) => (
            <tr key={req._id} className="hover:bg-gray-100 odd:bg-gray-50 transition-all group">
              <td className="py-1 px-6 text-[11px] font-bold text-slate-500">
                {new Date(req.orderedAt || req.createdAt).toLocaleDateString('en-GB')}
              </td>
              <td className="py-1 px-6 font-black text-slate-800 text-[13px] uppercase tracking-tight">
                {req.itemName}
              </td>
              <td className="py-1 px-6 text-center font-bold text-slate-500 text-xs">
                {req.prQty} <span className="text-[9px] text-slate-400 uppercase">{req.unit}</span>
              </td>
              <td className="py-1 px-6 text-center font-black text-slate-700 text-sm">
                {req.orderQty} <span className="text-[9px] text-slate-400 uppercase">{req.unit}</span>
              </td>
              <td className="py-1 px-6 text-center font-bold text-blue-600 text-sm">₹{req.rate}</td>
              <td className="py-1 px-6 text-[10px] font-black text-slate-600 uppercase whitespace-nowrap">{req.vendor}</td>
              <td className="py-1 px-6 max-w-52 text-[11px] text-slate-400 italic truncate" title={req.remark}>
                {req.remark || "---"}
              </td>
              <td className="py-1 px-6 text-right">
                <div className="flex justify-end gap-2">
                  
                  {/* Receive Button with Fixed Tooltip */}
                  <div className="relative group/tooltip">
                    <button 
                      onClick={() => { setSelectedRequest(req); setReceivedQty(req.orderQty); }}
                      className="p-1.5 bg-green-50 text-green-600 rounded-lg hover:bg-green-600 hover:text-white transition-all shadow-sm"
                    >
                      <FiCheckCircle size={16} />
                    </button>
                    {/* Tooltip positioned with high z-index and fixed visibility */}
                    <span className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-slate-800 text-white text-[8px] font-black uppercase rounded opacity-0 group-hover/tooltip:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
                      Receive Stock
                    </span>
                  </div>

                  {/* Cancel Button with Fixed Tooltip */}
                  <div className="relative group/tooltip">
                    <button 
                      onClick={() => onCancel(req)}
                      className="p-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-600 hover:text-white transition-all shadow-sm"
                    >
                      <FiXCircle size={16} />
                    </button>
                    <span className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-slate-800 text-white text-[8px] font-black uppercase rounded opacity-0 group-hover/tooltip:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
                      Revert to PR
                    </span>
                  </div>

                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* --- POPUP MODAL --- */}
      {selectedRequest && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-200">
            <div className="bg-slate-900 p-5 text-white flex justify-between items-center">
              <div className="flex items-center gap-3">
                <FiPackage className="text-blue-400" size={20} />
                <h3 className="font-black uppercase text-xs tracking-widest">Receive Purchase</h3>
              </div>
              <button onClick={() => setSelectedRequest(null)} className="hover:text-red-400 transition-colors">
                <FiX size={20} />
              </button>
            </div>
            
            <div className="p-6">
              <div className="mb-4">
                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Confirm Item</p>
                <p className="text-sm font-black text-slate-800 uppercase leading-tight">{selectedRequest.itemName}</p>
                <p className="text-[10px] font-bold text-slate-500 mt-1">Vendor: {selectedRequest.vendor}</p>
              </div>
              
              <div className="mb-6">
                <label className="text-[10px] font-black uppercase text-slate-400 mb-2 block">
                  Received Quantity ({selectedRequest.unit})
                </label>
                
<input 
  type="number" 
  value={receivedQty === 0 ? "" : receivedQty} 
  onChange={(e) => {
    const val = e.target.value;
    setReceivedQty(val === "" ? 0 : Number(val));
  }}
  onFocus={(e) => e.target.select()} // Highlights text so you can just start typing
  className="..." 
  autoFocus
/>
                <p className="text-[9px] text-slate-400 mt-2 font-bold uppercase">Ordered: {selectedRequest.orderQty} {selectedRequest.unit}</p>
              </div>
              
              <button 
                onClick={handleSaveToStock}
                disabled={isSaving}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black uppercase py-4 rounded-xl shadow-lg shadow-blue-100 flex items-center justify-center gap-2 text-[11px] tracking-widest disabled:bg-slate-300 transition-all"
              >
                {isSaving ? "Saving..." : <><FiCheck size={18} /> Confirm Received</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}