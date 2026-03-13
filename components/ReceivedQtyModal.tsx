"use client";
import { useState } from "react";
import { FiX, FiCheck, FiAlertCircle } from "react-icons/fi";

export default function ReceivedQtyModal({ isOpen, request, onClose }: any) {
  const [receivedQty, setReceivedQty] = useState(request?.qty || 0);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSave = async () => {
    const qtyNum = Number(receivedQty);
    if (qtyNum <= 0) return alert("Please enter a valid quantity");
    if (qtyNum > request.qty) return alert("Received quantity cannot exceed requested quantity");

    setLoading(true);
    try {
      // Use request._id to match MongoDB's ID format
      const res = await fetch(`/api/purchase-requests/${request._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receivedQty: qtyNum }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Server Error");
      }

      alert("Success: Inventory Updated!");
      onClose(); // This should trigger the data refresh in the parent
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-md p-8 shadow-2xl border border-slate-100">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-black uppercase tracking-tight text-slate-800">Receiveggfg Stock</h2>
            <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Inward Entry</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><FiX size={20}/></button>
        </div>
        
        <div className="bg-slate-50 p-4 rounded-2xl mb-6 border border-slate-100">
          <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Item Name</p>
          <p className="font-bold text-slate-800 uppercase">{request.itemName}</p>
          <div className="mt-2 flex justify-between items-center">
             <span className="text-[10px] font-black text-slate-400 uppercase">Total Requested</span>
             <span className="font-black text-slate-900">{request.qty} {request.unit}</span>
          </div>
        </div>

        <div className="mb-6">
          <label className="text-[10px] font-black uppercase text-slate-500 mb-2 block ml-1">Actual Qty Received</label>
          <div className="relative">
            <input 
              type="number" 
              autoFocus
              value={receivedQty}
              onChange={(e) => setReceivedQty(e.target.value)}
              className="w-full bg-white border-2 border-slate-200 rounded-2xl p-5 text-2xl font-black outline-none focus:border-green-500 focus:ring-4 focus:ring-green-500/10 transition-all"
            />
            <span className="absolute right-5 top-1/2 -translate-y-1/2 font-black text-slate-300 uppercase text-xs">{request.unit}</span>
          </div>
          {Number(receivedQty) < request.qty && (
            <div className="mt-3 flex items-center gap-2 text-amber-600 bg-amber-50 p-3 rounded-xl border border-amber-100">
              <FiAlertCircle size={14}/>
              <p className="text-[10px] font-bold uppercase">Partial: {request.qty - Number(receivedQty)} will remain pending</p>
            </div>
          )}
        </div>

        <button 
          onClick={handleSave}
          disabled={loading}
          className="w-full bg-slate-900 hover:bg-green-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-3 shadow-xl transition-all active:scale-[0.98] disabled:opacity-50"
        >
          {loading ? "Processing..." : <><FiCheck size={18}/> Update Inventory</>}
        </button>
      </div>
    </div>
  );
}