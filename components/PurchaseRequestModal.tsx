"use client";
import { useState, useEffect } from "react";
import { FiX, FiShoppingCart, FiEdit3, FiActivity, FiLayers, FiSave, FiPackage } from "react-icons/fi";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PurchaseRequestModal({ isOpen, onClose }: ModalProps) {
  const [items, setItems] = useState<{itemName: string, unit: string, currentStock: number}[]>([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    itemName: "",
    unit: "",
    qty: 0,
    remark: "",
    status: "Purchase Request"
  });

  useEffect(() => {
    if (isOpen) {
      fetch("/api/items").then(res => res.json()).then(data => setItems(data.items || []));
    }
  }, [isOpen]);

  const handleItemChange = (name: string) => {
    const selectedItem = items.find(i => i.itemName === name);
    setFormData({ 
      ...formData, 
      itemName: name, 
      unit: selectedItem?.unit || "unit" 
    });
  };

  const handleSave = async () => {
    setLoading(true);
    const res = await fetch("/api/purchase-requests", {
      method: "POST",
      body: JSON.stringify(formData),
      headers: { "Content-Type": "application/json" }
    });
    if (res.ok) {
      setLoading(false);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-2xl overflow-hidden shadow-2xl">
        {/* Simplified Header */}
        <div className="bg-[#0f172a] p-8 text-white flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-500/20 rounded-xl text-blue-400">
              <FiShoppingCart size={24}/>
            </div>
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight">Purchase Request</h2>
              <p className="text-blue-400 text-[10px] font-black tracking-widest uppercase mt-1">Inventory Management</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <FiX size={28} />
          </button>
        </div>

        <div className="p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Item Select (Now shows Name + Unit) */}
            <div className="space-y-2 md:col-span-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Select Item</label>
              <div className="relative">
                <FiPackage className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <select 
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/10 transition-all appearance-none"
                  onChange={(e) => handleItemChange(e.target.value)}
                  value={formData.itemName}
                >
                  <option value="">Select Item</option>
                  {items.map((item, idx) => (
                    <option key={idx} value={item.itemName}>
                      {item.itemName} — ({item.unit})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Qty Input */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Required Quantity</label>
              <div className="relative">
                <FiLayers className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="number" 
                  className="w-full pl-12 pr-16 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none"
                  placeholder="0"
                  onChange={(e) => setFormData({...formData, qty: Number(e.target.value)})}
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-blue-500 uppercase tracking-widest">
                  {formData.unit || "unit"}
                </span>
              </div>
            </div>

            {/* Status Select */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Request Status</label>
              <div className="relative">
                <FiActivity className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <select 
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none appearance-none"
                  onChange={(e) => setFormData({...formData, status: e.target.value})}
                >
                  <option value="Purchase Request">Purchase Request</option>
                  <option value="Purchase Placed">Purchase Placed</option>
                  <option value="Purchase Received">Purchase Received</option>
                  <option value="Canceled">Canceled</option>
                  <option value="On Hold">On Hold</option>
                  <option value="Return to Vendor">Return to Vendor</option>
                </select>
              </div>
            </div>

            {/* Remark */}
            <div className="space-y-2 md:col-span-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Additional Remarks</label>
              <div className="relative">
                <FiEdit3 className="absolute left-4 top-4 text-slate-400" />
                <textarea 
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none min-h-32 resize-none"
                  placeholder="Mention any specific requirements..."
                  onChange={(e) => setFormData({...formData, remark: e.target.value})}
                />
              </div>
            </div>
          </div>

          <button 
            onClick={handleSave} 
            disabled={loading}
            className="w-full py-5 bg-[#1d63ff] hover:bg-blue-700 text-white rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl shadow-blue-200 flex items-center justify-center gap-3 transition-all"
          >
            <FiSave size={20} /> {loading ? "Processing..." : "Submit Purchase Request"}
          </button>
        </div>
      </div>
    </div>
  );
}