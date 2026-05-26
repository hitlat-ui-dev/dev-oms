"use client";
import { useState, useEffect, useMemo } from "react";
import { FiSave, FiArrowLeft, FiX } from "react-icons/fi";
import { useRouter } from "next/navigation";
import BlockGuard from "./BlockGuard";
import Link from "next/link";

interface SellerOrderFormProps {
  onClose?: () => void; // Used for Modal
  isModal?: boolean;
  initialData?: any;
}

export default function SellerOrderForm({ onClose, initialData, isModal = false }: SellerOrderFormProps) {
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
    sku: "",
    contractDate: "",
    contractNo: "",
    contractUrl: "",
    orderQty: "" as any,
    reQty: 0,
    rate: "" as any,
    remark: ""
  });

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    }
  }, [initialData]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [selRes, stkRes, firmRes] = await Promise.all([
          fetch("/api/sellers"),
          fetch("/api/stock"),
          fetch("/api/companies")
        ]);
        const selData = await selRes.json();
        const stkData = await stkRes.json();
        const firmData = await firmRes.json();

        setSellers(Array.isArray(selData) ? selData : []);
        setStocks(Array.isArray(stkData) ? stkData : []);
        setFirms(Array.isArray(firmData) ? firmData : []);
      } catch (err) {
        console.error("Load error", err);
      }
    };
    loadData();
  }, []);

  // const totalAmount = useMemo(() => formData.orderQty * formData.rate, [formData.orderQty, formData.rate]);
  const totalAmount = useMemo(() => {
    // Use reQty if available, otherwise orderQty, fallback to 0
    const qty = formData.reQty ?? formData.orderQty ?? 0;
    const rate = formData.rate ?? 0;

    return qty * rate;
  }, [formData.reQty, formData.orderQty, formData.rate]);

  const handleContractPaste = (e: React.ClipboardEvent) => {
    const html = e.clipboardData.getData("text/html");
    const plainText = e.clipboardData.getData("text/plain");
    if (html) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const link = doc.querySelector("a");
      if (link) {
        e.preventDefault();
        setFormData({ ...formData, contractNo: link.textContent || plainText, contractUrl: link.href });
        return;
      }
    }
    setFormData({ ...formData, contractNo: plainText });
  };

  // const handleSubmit = async (e: React.FormEvent) => {
  //   e.preventDefault();
  //   setLoading(true);
  //   try {
  //     const res = await fetch("/api/seller-orders", {
  //       method: "POST",
  //       headers: { "Content-Type": "application/json" },
  //       body: JSON.stringify({ ...formData, totalAmount })
  //     });

  //     if (res.ok) {
  //         alert("Order Saved Successfully!");
  //         window.location.reload();
  //       if (isModal && onClose) {
  //           onClose();
  //       } else {
  //           window.location.reload();
  //       }
  //     } else {
  //       const err = await res.json();
  //       alert(`Error: ${err.error || "Failed to save"}`);
  //     }
  //   } catch (error) {
  //     alert("Check your server connection.");
  //   } finally {
  //     setLoading(false);
  //   }
  // };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    //console.log("Data being sent to DB:", formData);
    const isValidFirm = firms.some((f: any) => f.firmCode === formData.firmCode);
    if (!isValidFirm) {
    alert("❌ Error: Please select a valid Firm Code from the dropdown list suggestions.");
    return; // Block database submit action pipeline completely
  }
    setLoading(true);

    if (!formData.reQty || formData.reQty <= 0) {
      alert("Please enter a quantity more than 0");
      return; // STOP the function here
    }

    try {
      // Decide if we are updating or creating
      const isEditing = !!initialData?._id;
      const method = isEditing ? "PATCH" : "POST";
      const url = isEditing ? `/api/seller-orders/${initialData._id}` : "/api/seller-orders";

      const res = await fetch(url, {
        method: method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, totalAmount })
      });

      if (res.ok) {
        alert(isEditing ? "Order Updated Successfully!" : "Order Saved Successfully!");
        if (onClose) {
          onClose();
        }
        if (isModal && onClose) {
          onClose(); // This will trigger fetchOrders() in your main page
        } else {
          window.location.reload();
        }
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

  useEffect(() => {
    if (initialData && sellers.length > 0 && stocks.length > 0) {
      // If editing, ensure we have the readable names for the search inputs
      const seller = sellers.find(s => s._id === initialData.sellerId);
      const item = stocks.find(i => i._id === initialData.itemId);

      setFormData({
        ...initialData,
        instituteName: seller?.instituteName || initialData.instituteName,
        itemName: item?.itemName || initialData.itemName
      });
    }
  }, [initialData, sellers, stocks]);

  return (
    <BlockGuard
      permission="addOrder"
      fallback={
        <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50">
          <p className="text-red-500 font-bold uppercase">You have no Access for this Page.</p>
          <Link
            href="/dashboard"
            className="text-sm bg-slate-900 text-white px-4 mt-4 py-2 rounded-lg hover:bg-slate-800 transition-all"
          >
            Go to Dashboard
          </Link>
        </div>
      }
    >
      <div className={`${isModal ? "bg-white rounded-xl shadow-2xl overflow-hidden w-full max-w-5xl" : "space-y-8"}`}>

        {/* Header logic: Back button for page, Close button for Modal */}
        {!isModal && (
          <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 font-bold text-xs uppercase tracking-widest mb-4">
            <FiArrowLeft /> Back
          </button>
        )}

        <div className={`${!isModal ? "bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden" : ""}`}>
          <div className="bg-[#1e293b] p-4 text-white flex justify-between items-center">
            <h1 className="text-2xl font-black uppercase tracking-tight pl-5">Seller Order Entry</h1>
            {isModal && (
              <button onClick={onClose} className="text-white/50 hover:text-white transition-colors">
                <FiX size={24} />
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit} className="p-8 grid grid-cols-1 md:grid-cols-3 gap-4 max-h-[80vh] overflow-y-auto">

            {/* <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Firm Code *</label>
              <select required className="w-full p-4 bg-slate-50 border rounded-xl  text-sm outline-none" value={formData.firmCode} onChange={(e) => setFormData({ ...formData, firmCode: e.target.value })}>
                <option value="">Select Firm</option>
                {firms.map((f: any) => <option key={f._id} value={f.firmCode}>{f.firmCode} - {f.firmName}</option>)}
              </select>
            </div> */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Firm Code *</label>
              <input
                list="firm-options"
                required
                placeholder="Search Firm..."
                className="w-full p-4 bg-slate-50 border rounded-xl text-sm outline-none"
                value={formData.firmCode}
                onChange={(e) => setFormData({ ...formData, firmCode: e.target.value })}
                onBlur={(e) => {
                  const typedVal = e.target.value.trim();
                  if (!typedVal) return; // Allow them to leave it blank if they want to fill it later

                  // Check if the typed word matches an actual code from the firms database
                  const matchFound = firms.some((f: any) => f.firmCode === typedVal);

                  if (!matchFound) {
                    alert(`❌ "${typedVal}" is not a valid firm code! Please pick an option from the list.`);
                    setFormData({ ...formData, firmCode: "" }); // Erase the invalid words completely
                  }
                }}
              />
              <datalist id="firm-options">
                {firms.map((f: any) => (
                  <option key={f._id} value={f.firmCode}>
                    {f.firmName}
                  </option>
                ))}
              </datalist>
            </div>

            {/* <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Institute Name *</label>
              <select required className="w-full p-4 bg-slate-50 border rounded-xl  text-sm outline-none" value={formData.sellerId} onChange={(e) => {
                const s: any = sellers.find((x: any) => x._id === e.target.value);
                setFormData({ ...formData, sellerId: e.target.value, instituteName: s?.instituteName || "" });
              }}>
                <option value="">Select Institute</option>
                {sellers.map((s: any) => <option key={s._id} value={s._id}>{s.instituteName}</option>)}
              </select>
            </div> */}

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Institute Name *</label>
              <input
                list="institute-options"
                required
                placeholder="Search Institute..."
                className="w-full p-4 bg-slate-50 border rounded-xl text-sm outline-none"
                value={formData.instituteName} // Use the name for the display
                onChange={(e) => {
                  const val = e.target.value;
                  const s: any = sellers.find((x: any) => x.instituteName === val);
                  setFormData({
                    ...formData,
                    instituteName: val,
                    sellerId: s?._id || "" // Update the ID if a match is found
                  });
                }}
              />
              <datalist id="institute-options">
                {sellers.map((s: any) => (
                  <option key={s._id} value={s.instituteName} />
                ))}
              </datalist>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Search Item Name *</label>
              <input
                list="stock-items"
                required
                placeholder="Type to search..."
                className="w-full p-4 bg-slate-50 border rounded-xl text-sm outline-none"
                // ADD THIS LINE:
                value={formData.itemName}
                onChange={(e) => {
                  const val = e.target.value;
                  // First, update the text so the user can actually type
                  setFormData(prev => ({ ...prev, itemName: val }));

                  // Second, check if the typed text matches an item in your list
                  const selectedItem = stocks.find((x: any) => x.itemName === val);
                  if (selectedItem) {
                    setFormData(prev => ({
                      ...prev,
                      itemId: selectedItem._id,
                      itemName: selectedItem.itemName,
                      category: selectedItem.category,
                      unit: selectedItem.unit,
                      sku: selectedItem.sku
                    }));
                  }
                }}
              />
              <datalist id="stock-items">
                {stocks.map((i: any) => (
                  <option key={i._id} value={i.itemName}>
                    {i.sku} — {i.category} ({i.unit})
                  </option>
                ))}
              </datalist>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Contract Date</label>
              <input type="date" className="w-full p-4 bg-slate-50 border rounded-xl text-sm" value={formData.contractDate} onChange={(e) => setFormData({ ...formData, contractDate: e.target.value })} />
            </div>

            <div className="md:col-span-2 space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Contract No. (Paste Link here)</label>
              <input type="text" className="w-full p-4 bg-slate-50 border rounded-xl text-sm focus:ring-2 focus:ring-blue-400 outline-none" placeholder="Paste GEM Link..." value={formData.contractNo} onPaste={handleContractPaste} onChange={(e) => setFormData({ ...formData, contractNo: e.target.value })} />
              {formData.contractUrl && <p className="text-[9px] text-blue-600 font-bold px-2 italic truncate">URL: {formData.contractUrl}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Order Qty *</label>
              {/* <input type="number" required className="w-full p-4 bg-slate-50 border rounded-xl text-sm" placeholder="Enter quantity" value={formData.orderQty} onChange={(e) => setFormData({...formData, orderQty: Number(e.target.value)})} /> */}
              <input
                type="number"
                required
                className="w-full p-4 bg-slate-50 border rounded-xl text-sm"
                placeholder="Enter quantity"
                value={formData.reQty ?? formData.orderQty ?? ""}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setFormData({
                    ...formData,
                    reQty: val,   // Always update reQty so the UI stays in sync
                    orderQty: val // Keep orderQty updated for new records
                  });
                }}
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Rate</label>
              <input type="number" className="w-full p-4 bg-slate-50 border rounded-xl text-sm" placeholder="Enter Rate" value={formData.rate} onChange={(e) => setFormData({ ...formData, rate: Number(e.target.value) })} />
            </div>

            <div className="px-6 pt-1 bg-slate-900 mt-5 rounded-xl flex justify-between items-center text-white">
              <span className="font-black uppercase tracking-widest text-xs">Total</span>
              <span className="text-2xl font-black">₹ {totalAmount.toLocaleString()}</span>
            </div>

            <div className="md:col-span-2 space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Remark</label>
              <textarea className="w-full p-4 bg-slate-50 border rounded-xl  text-sm" placeholder="Optional notes..." value={formData.remark} onChange={(e) => setFormData({ ...formData, remark: e.target.value })} />
            </div>

            <button type="submit" disabled={loading} className=" bg-blue-600 text-white font-black py-5 rounded-xl shadow-xl active:scale-95 transition-all uppercase tracking-widest">
              {loading ? "Saving..." : "Save Order"}
            </button>
          </form>
        </div>
      </div>
    </BlockGuard>
  );
}