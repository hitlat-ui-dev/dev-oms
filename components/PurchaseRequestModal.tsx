"use client";
import { useState, useMemo } from "react"; // Removed useEffect since we use props now
import { FiX, FiShoppingCart, FiEdit3, FiLayers, FiSave, FiSearch } from "react-icons/fi";
import BlockGuard from "./BlockGuard";
import Link from "next/link";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  stockData: any[]; // Data passed from parent
}

export default function PurchaseRequestModal({ isOpen, onClose, stockData }: ModalProps) {
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    itemName: "",
    unit: "",
    qty: 0,
    remark: "",
    status: "Purchase Request"
  });

  // 1. Find the current item in the passed stockData for stock display
  // const currentStockInfo = useMemo(() => {
  //   if (!formData.itemName) return null;
  //   return stockData.find(i =>
  //     i.itemName?.toLowerCase().trim() === formData.itemName.toLowerCase().trim()
  //   );
  // }, [formData.itemName, stockData]);

  // const currentStockInfo = useMemo(() => {
  //   if (!formData.itemName) return null;

  //   const searchStr = formData.itemName.toUpperCase().trim();

  //   return stockData.find((i) => {
  //     const dbName = (i.itemName || "").toUpperCase().trim();
  //     const dbSku = (i.sku || "").toUpperCase().trim();

  //     // Match if EITHER the name or the SKU matches what was typed/selected
  //     return dbName === searchStr || dbSku === searchStr;
  //   });
  // }, [formData.itemName, stockData]);

  const currentStockInfo = useMemo(() => {
    if (!formData.itemName) return null;
    const searchSku = formData.itemName.toUpperCase().trim();

    // STRICT LOOKUP: Match array items directly by SKU string
    return stockData.find((i) => (i.sku || "").toUpperCase().trim() === searchSku);
  }, [formData.itemName, stockData]);

  const handleTextChange = (value: string) => {
    // 1. Try to find an exact match in your stockData (excluding hidden items
    // - see the same-named hidden/active duplicate note in handleSave below)
    const selectedItem = stockData.find(
      (i) => i.itemName?.toLowerCase().trim() === value.toLowerCase().trim() && i.hidden !== true
    );

    setFormData({
      ...formData,
      itemName: value,
      // Auto-fill unit only if a match is found
      unit: selectedItem?.unit || formData.unit || "",
    });
  };

  // const handleSave = async () => {
  //   const isValidItem = stockData.some(
  //     (i) => i.itemName?.toLowerCase().trim() === formData.itemName.toLowerCase().trim()
  //   );

  //   if (!isValidItem) {
  //     alert("Please select a valid item from the list. You cannot create a request for a new item here.");
  //     return;
  //   }

  //   if (formData.qty <= 0) {
  //     alert("Please enter a valid quantity.");
  //     return;
  //   }

  //   setLoading(true);
  //   if (!formData.itemName || formData.qty <= 0) {
  //     alert("Please enter an item name and quantity.");
  //     return;
  //   }

  //   setLoading(true);
  //   try {
  //     const res = await fetch("/api/purchase", {
  //       method: "POST",
  //       headers: { "Content-Type": "application/json" },
  //       body: JSON.stringify({
  //         itemName: formData.itemName.toUpperCase(),
  //         unit: formData.unit,
  //         prQty: formData.qty,
  //         remark: formData.remark,
  //         status: formData.status,
  //         // Use currentStockInfo to fill missing details for the DB
  //         sku: currentStockInfo?.sku || "N/A",
  //         category: currentStockInfo?.category || "General"
  //       }),
  //     });

  //     if (res.ok) {
  //       onClose();
  //       setFormData({ itemName: "", unit: "", qty: 0, remark: "", status: "Purchase Request" });
  //     }
  //   } catch (error) {
  //     console.error("Save failed:", error);
  //   } finally {
  //     setLoading(false);
  //   }
  // };

 // Inside PurchaseRequestModal.tsx -> handleSave
// 2. Update handleSave to validate strictly by SKU first
  const handleSave = async () => {
    //console.log("=== DEBUG START ===");
   // console.log("1. Raw typed input from user state:", formData.itemName);

    // Baseline empty string protection
    if (!formData.itemName || formData.itemName.trim() === "") {
      alert("DEBUG ALERT: Blocked because input text is completely empty.");
      //console.log("Result: Blocked at step 1 (Empty Input)");
      return;
    }

    const cleanInput = formData.itemName.trim().toUpperCase();
    //console.log("2. Normalized user input text (Cleaned & Uppercased):", cleanInput);
    //console.log("3. Complete local stockData array available in component:", stockData);

    // Locating the item inside the stock database list strictly by Name match
    // A hidden item is often a retired duplicate sharing the exact same name
    // as its active replacement (see app/api/items/route.ts's duplicate-name
    // check) - matched separately below so a hidden hit gets its own clear
    // error instead of silently resolving to the wrong (retired) SKU.
    const matchedItem = stockData.find((i) => {
      const dbName = (i.itemName || "").trim().toUpperCase();
      return dbName === cleanInput && i.hidden !== true;
    });

    //console.log("4. Result of stockData.find():", matchedItem);

    if (!matchedItem) {
      const hiddenMatch = stockData.find((i) => (i.itemName || "").trim().toUpperCase() === cleanInput && i.hidden === true);
      if (hiddenMatch) {
        alert(`❌ Error: "${hiddenMatch.itemName}" (SKU ${hiddenMatch.sku}) is hidden/retired — it can't be used. Please select its active replacement from the search list.`);
        return;
      }
      alert(`DEBUG ALERT: System could not find ANY item in stockData matching name: "${cleanInput}"`);
      //console.log("Result: Blocked at step 4 (No item match found)");
      return;
    }

    // Extract the precise database string for the SKU
    const dbSkuValue = (matchedItem.sku || "").trim().toUpperCase();
    //console.log("5. Extracted database SKU value string found inside matched item:", `"${dbSkuValue}"`);

    // CRITICAL CONDITION CHECK
    if (dbSkuValue === "" || dbSkuValue === "N/A" || dbSkuValue.length < 2) {
      alert(`DEBUG ALERT: Blocked! Item matched, but its SKU value inside MongoDB is invalid. Found SKU: "${dbSkuValue}"`);
      //console.log("Result: Blocked at step 5 (SKU check failed validation)");
      return;
    }

    //console.log("6. SUCCESS: Validation passed perfectly! Sending request to API...");
    setLoading(true);

    try {
      const payload = {
        itemId: matchedItem.itemId?.$oid || matchedItem._id?.$oid || matchedItem.itemId || matchedItem._id,
        itemName: matchedItem.itemName, 
        sku: matchedItem.sku, 
        category: matchedItem.category || "GENERAL",
        unit: matchedItem.unit || "NOS",
        prQty: Number(formData.qty),
        remark: formData.remark,
        status: formData.status,
      };
      
     // console.log("7. Final outgoing JSON payload text body being sent to /api/purchase:", payload);

      const res = await fetch("/api/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

     // console.log("8. Server API response status code received:", res.status);

      if (res.ok) {
       // console.log("9. Success status 200 returned from server route.");
        onClose();
        setFormData({ itemName: "", unit: "", qty: 0, remark: "", status: "Purchase Request" });
      } else {
        //console.error("9. Server accepted the call but returned a failure error status code.");
      }
    } catch (error) {
      //console.error("CRITICAL EXCEPTION: Fetch network call failed completely:", error);
    } finally {
      setLoading(false);
      ///console.log("=== DEBUG END ===");
    }
  };


  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-2xl overflow-hidden shadow-2xl border border-white/20">

        {/* Header */}
        <div className="bg-[#0f172a] p-8 text-white flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-500/20 rounded-xl text-blue-400">
              <FiShoppingCart size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight">New Purchase Request</h2>
              <p className="text-blue-400 text-[10px] font-black tracking-widest uppercase mt-1">Status: {formData.status}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <FiX size={28} />
          </button>
        </div>
        <BlockGuard
          permission="purchaseReq"
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
          <div className="p-8 space-y-6">
            <div className="grid grid-cols-1 gap-6">

              {/* Item Name & Stock Display */}
              <div className="space-y-2">
                <div className="flex justify-between items-end px-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Item Name</label>

                  {/* DISPLAY STOCK QUANTITY (e.g., 54 NOS) */}
                  {currentStockInfo && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${(currentStockInfo.totalQty || currentStockInfo.quantity || 0) > 0
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-red-100 text-red-700'
                      }`}>
                      {/* Check both totalQty and quantity */}
                      {currentStockInfo.totalQty ?? currentStockInfo.quantity ?? 0} {currentStockInfo.unit} IN STOCK
                    </span>
                  )}
                </div>

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
                    {stockData.filter((item: any) => item.hidden !== true).map((item, idx) => (
                      <option key={idx} value={item.itemName}>
                        {/* This shows the SKU next to the name in the dropdown */}
                        {item.sku} | {item.category} | {item.totalQty ?? item.quantity ?? 0} in stock
                      </option>
                    ))}
                  </datalist>
                </div>
              </div>

              {/* Quantity */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Required Quantity</label>
                <div className="relative">
                  <FiLayers className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="number"
                    className="w-full pl-12 pr-16 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none focus:border-blue-500 transition-colors"
                    placeholder="Enter Qty needed"
                    value={formData.qty || ""}
                    onChange={(e) => setFormData({ ...formData, qty: Number(e.target.value) })}
                  />
                  <span className="absolute right-6 top-1/2 -translate-y-1/2 text-[10px] font-black text-blue-500 uppercase tracking-widest bg-blue-50 px-3 py-1 rounded-lg">
                    {formData.unit || "Unit"}
                  </span>
                </div>
              </div>

              {/* Remarks */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Additional Remarks</label>
                <div className="relative">
                  <FiEdit3 className="absolute left-4 top-4 text-slate-400" />
                  <textarea
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none min-h-24 resize-none focus:border-blue-500 transition-colors"
                    placeholder="Optional notes..."
                    value={formData.remark}
                    onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={loading}
              className="w-full py-5 bg-[#1d63ff] hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl shadow-blue-200 flex items-center justify-center gap-3 transition-all active:scale-[0.98]"
            >
              {loading ? "Processing..." : <><FiSave size={20} /> Submit Request</>}
            </button>
          </div>
        </BlockGuard>
      </div>
    </div>
  );
}