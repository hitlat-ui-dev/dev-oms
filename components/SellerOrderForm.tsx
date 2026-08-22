"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { FiSave, FiArrowLeft, FiX } from "react-icons/fi";
import { useRouter } from "next/navigation";
import BlockGuard from "./BlockGuard";
import Link from "next/link";

interface SellerOrderFormProps {
  // Called on every way the modal closes (X, or after a successful save).
  // Passes back every order created/updated during this session (usually
  // one, but "Save & Add Another" can accumulate several) so the parent can
  // merge them into its own list locally instead of refetching everything.
  onClose?: (savedOrders?: any[]) => void;
  isModal?: boolean;
  initialData?: any;
}

export default function SellerOrderForm({ onClose, initialData, isModal = false }: SellerOrderFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [sellers, setSellers] = useState<any[]>([]);
  const [stocks, setStocks] = useState<any[]>([]);
  const [firms, setFirms] = useState<any[]>([]);
  const [currentUsername, setCurrentUsername] = useState("");
  // Guards against a race where Save is clicked before the firms/sellers/stock
  // reference lists (fetched async below) have loaded — with an edit modal
  // pre-filled instantly from initialData, that could happen fast enough to
  // wrongly flag an already-valid firmCode as "invalid" (list was just empty).
  const [dataLoaded, setDataLoaded] = useState(false);
  // Accumulates every order saved in this modal session (handles "Save &
  // Add Another" saving several before the modal actually closes) so
  // whichever close path fires can hand all of them back at once.
  const savedOrdersRef = useRef<any[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("oms_user");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.username) setCurrentUsername(parsed.username);
      }
    } catch (err) {
      console.error("Failed to read logged-in user", err);
    }
  }, []);

  const blankFormData = {
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
  };
  const [formData, setFormData] = useState(blankFormData);
  // "Save & Add Another" clears the form to enter the next order back-to-back
  // - the button itself keeps focus after being clicked, so re-focusing Firm
  // Code here means the user can start typing immediately instead of tabbing
  // back to the top of the form.
  const firmCodeInputRef = useRef<HTMLInputElement>(null);
  // Brief inline confirmation shown after "Save & Add Another" instead of a
  // blocking alert() - a blocking dialog on every entry would defeat the
  // point of typing several orders back-to-back without leaving the modal.
  const [savedFlash, setSavedFlash] = useState("");

  // Tracks which record (by _id/contractNo) has already been loaded into the
  // form, so this effect populates formData exactly once per "open for
  // editing" - not on every sellers/stocks/initialData re-render. Without
  // this guard, the async sellers/stocks fetch finishing (see loadData
  // below) would re-fire this and reset formData mid-edit, wiping out
  // whatever the user had just typed (the "first keystroke disappears" bug).
  const loadedRecordRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialData) {
      loadedRecordRef.current = null;
      return;
    }

    const recordKey = initialData._id || initialData.contractNo || "new";
    if (loadedRecordRef.current === recordKey) return;

    const seller = sellers.find((s: any) => s._id === initialData.sellerId);
    const item = stocks.find((i: any) => i._id === initialData.itemId);

    setFormData({
      firmCode: initialData.firmCode || "",
      sellerId: initialData.sellerId || "",
      instituteName: seller?.instituteName || initialData.instituteName || "",
      itemId: initialData.itemId || "",
      itemName: item?.itemName || initialData.itemName || "",
      category: initialData.category || "",
      unit: initialData.unit || "",
      sku: initialData.sku || "",
      contractDate: initialData.contractDate || "",
      contractNo: initialData.contractNo || "",
      contractUrl: initialData.contractUrl || "",
      orderQty: initialData.orderQty || "",
      reQty: initialData.reQty || 0,
      rate: initialData.rate || "",
      remark: initialData.remark || ""
    });
    loadedRecordRef.current = recordKey;
  }, [initialData, sellers, stocks]);

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
      } finally {
        setDataLoaded(true);
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

  // Shared validate+save core. Returns true on success so the two submit
  // buttons (Save & Close vs Save & Add Another) can each decide what to do
  // afterwards without duplicating the validation/POST logic.
  const saveOrder = async (): Promise<boolean> => {
    if (!dataLoaded) {
      alert("Still loading firm/institute/item lists — please wait a second and press Save again.");
      return false;
    }
    const isValidFirm = firms.some((f: any) => f.firmCode === formData.firmCode);
    if (!isValidFirm) {
      alert("❌ Error: Please select a valid Firm Code from the dropdown list suggestions.");
      return false; // Block database submit action pipeline completely
    }
    // Matched by itemId (not name) so an edit re-opened on an order that
    // already references a hidden item gets caught too, not just the
    // itemName datalist's own hidden-item selection.
    const matchedStockItem = stocks.find((x: any) => x._id === formData.itemId);
    if (!matchedStockItem) {
      alert("❌ Error: Invalid Product! Please select a valid item from the search suggestion dropdown list.");
      return false;
    }
    if (matchedStockItem.hidden === true) {
      alert(`❌ Error: "${matchedStockItem.itemName}" (SKU ${matchedStockItem.sku}) is hidden/retired — it can't be used. Please select its active replacement from the search list.`);
      return false;
    }

    if (!formData.reQty || formData.reQty <= 0) {
      alert("Please enter a quantity more than 0");
      return false; // STOP the function here
    }
    setLoading(true);
    try {
      // Decide if we are updating or creating
      const isEditing = !!initialData?._id;
      const method = isEditing ? "PATCH" : "POST";
      const url = isEditing ? `/api/seller-orders/${initialData._id}` : "/api/seller-orders";

      // sellerId is an ObjectId field server-side - "" (no institute match
      // found, e.g. a GeM-verify order matched by name only) must not be
      // sent as-is, or the update throws a Mongoose cast error. Omit the key
      // entirely rather than nulling it: on an edit, that leaves whatever
      // sellerId already exists on the order untouched instead of silently
      // wiping out a valid link just because this save's institute-name
      // match happened not to resolve.
      const payload: any = { ...formData, totalAmount, ...(isEditing ? {} : { createdBy: currentUsername }) };
      if (!payload.sellerId) delete payload.sellerId;

      const res = await fetch(url, {
        method: method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const result = await res.json();
        if (result?.mergeWarning) {
          alert(`⚠ ${result.mergeWarning}`);
        }
        if (result?._id) savedOrdersRef.current.push(result);
        return true;
      } else {
        const err = await res.json();
        alert(`Error: ${err.error || "Failed to save"}`);
        return false;
      }
    } catch (error) {
      alert("Check your server connection.");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await saveOrder();
    if (!ok) return;

    alert(initialData?._id ? "Order Updated Successfully!" : "Order Saved Successfully!");
    if (isModal && onClose) {
      onClose(savedOrdersRef.current); // parent merges these locally - no refetch/reload
    } else {
      window.location.reload();
    }
  };

  // Saves the current order but keeps the modal open with a blank form for
  // the next one - firms/institutes/stock are already loaded, so there's no
  // refetch, and there's no reopen-"Add Order" round trip between entries.
  const handleSaveAndAddAnother = async () => {
    const ok = await saveOrder();
    if (!ok) return;

    setFormData(blankFormData);
    setSavedFlash("✓ Order saved — add the next one");
    setTimeout(() => setSavedFlash(""), 2500);
    firmCodeInputRef.current?.focus();
  };

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
              <button
                onClick={() => onClose?.(savedOrdersRef.current)}
                className="text-white/50 hover:text-white transition-colors"
              >
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
                ref={firmCodeInputRef}
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

                  // Second, check if the typed text matches an item in your list -
                  // excluding hidden items, since a hidden item is often a retired
                  // duplicate sharing the exact same name as its active replacement
                  // (see app/api/items/route.ts's duplicate-name check), and a plain
                  // name match here would otherwise silently pick whichever one
                  // happens to come first in the array.
                  const selectedItem = stocks.find((x: any) => x.itemName === val && x.hidden !== true);
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
                {stocks.filter((i: any) => i.hidden !== true).map((i: any) => (
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

            <div className="md:col-span-3 flex flex-col sm:flex-row gap-3 items-center">
              <button type="submit" disabled={loading} className="flex-1 w-full bg-blue-600 text-white font-black py-5 rounded-xl shadow-xl active:scale-95 transition-all uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? "Saving..." : initialData?._id ? "Update Order" : "Save & Close"}
              </button>
              {isModal && !initialData?._id && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleSaveAndAddAnother}
                  className="flex-1 w-full bg-emerald-600 text-white font-black py-5 rounded-xl shadow-xl active:scale-95 transition-all uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? "Saving..." : "Save & Add Another"}
                </button>
              )}
            </div>
            {savedFlash && (
              <div className="md:col-span-3 text-center text-emerald-600 font-black text-xs uppercase tracking-widest animate-in fade-in">
                {savedFlash}
              </div>
            )}
          </form>
        </div>
      </div>
    </BlockGuard>
  );
}