"use client";
import { useState, useEffect } from "react";
import { FiX, FiShoppingCart, FiEdit3, FiLayers, FiSave, FiPackage, FiSearch } from "react-icons/fi";

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
      fetch("/api/items")
        .then(res => res.json())
        .then(data => setItems(data.items || []));
    }
  }, [isOpen]);

  // Handle manual typing and selection
  const handleTextChange = (value: string) => {
    // Find if the typed text matches an existing item to auto-fill the unit
    const selectedItem = items.find(i => i.itemName.toLowerCase() === value.toLowerCase());
    
    setFormData({ 
      ...formData, 
      itemName: value, // Keep the raw text the user typed
      unit: selectedItem?.unit || formData.unit || "unit" 
    });
  };

  const handleSave = async () => {
    if (!formData.itemName || formData.qty <= 0) {
      alert("Please enter an item name and quantity.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemName: formData.itemName.toUpperCase(), // Ensure consistency in DB
          unit: formData.unit,
          prQty: formData.qty,
          remark: formData.remark,
          status: formData.status
        }),
      });
      
      if (res.ok) {
        onClose();
        setFormData({ itemName: "", unit: "", qty: 0, remark: "", status: "Purchase Request" });
      } else {
        const errorData = await res.json();
        alert(`Error: ${errorData.error}`);
      }
    } catch (error) {
      console.error("Save failed:", error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-2xl overflow-hidden shadow-2xl border border-white/20">
        
        <div className="bg-[#0f172a] p-8 text-white flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-500/20 rounded-xl text-blue-400">
              <FiShoppingCart size={24}/>
            </div>
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight">New Purchase Request</h2>
              <p className="text-blue-400 text-[10px] font-black tracking-widest uppercase mt-1">Automatic Route: {formData.status}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <FiX size={28} />
          </button>
        </div>

        <div className="p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2 md:col-span-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Search or Type Item Name</label>
              <div className="relative">
                <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  list="inventory-items"
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/10 transition-all uppercase"
                  placeholder="Start typing item name..."
                  value={formData.itemName}
                  onChange={(e) => handleTextChange(e.target.value)}
                />
                <datalist id="inventory-items">
                  {items.map((item, idx) => (
                    <option key={idx} value={item.itemName}>
                      {item.unit} stock available
                    </option>
                  ))}
                </datalist>
              </div>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Required Quantity</label>
              <div className="relative">
                <FiLayers className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="number" 
                  className="w-full pl-12 pr-16 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none focus:border-blue-500 transition-colors"
                  placeholder="Enter Qty needed"
                  value={formData.qty || ""}
                  onChange={(e) => setFormData({...formData, qty: Number(e.target.value)})}
                />
                <span className="absolute right-6 top-1/2 -translate-y-1/2 text-[10px] font-black text-blue-500 uppercase tracking-widest bg-blue-50 px-3 py-1 rounded-lg">
                  {formData.unit || "Unit"}
                </span>
              </div>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Additional Remarks</label>
              <div className="relative">
                <FiEdit3 className="absolute left-4 top-4 text-slate-400" />
                <textarea 
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none min-h-24 resize-none focus:border-blue-500 transition-colors"
                  placeholder="Why is this being requested? (Optional)"
                  value={formData.remark}
                  onChange={(e) => setFormData({...formData, remark: e.target.value})}
                />
              </div>
            </div>
          </div>

          <button 
            onClick={handleSave} 
            disabled={loading}
            className="w-full py-5 bg-[#1d63ff] hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl shadow-blue-200 flex items-center justify-center gap-3 transition-all active:scale-[0.98]"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving to Log...
              </span>
            ) : (
              <><FiSave size={20} /> Submit Purchase Request</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}