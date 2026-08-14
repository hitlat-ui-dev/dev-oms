"use client";
import { useState, useEffect, useMemo, useRef } from "react";
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
  const [currentUsername, setCurrentUsername] = useState("");

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
    remark: "",
    isAdvanceOrder: false
  });

  // Advance Order auto-merge: candidate open Advance Orders matching the currently
  // selected Institute + Item, so a real GeM order can be one-click merged against
  // whatever was already shipped early instead of needing a separate manual step.
  interface AdvanceCandidate {
    orderId: string;
    orderNo: string;
    remainingQty: number;
  }
  const [advanceCandidates, setAdvanceCandidates] = useState<AdvanceCandidate[]>([]);
  const [selectedMergeId, setSelectedMergeId] = useState("");
  const [mergeEnabled, setMergeEnabled] = useState(true);

  useEffect(() => {
    if (formData.isAdvanceOrder || !formData.instituteName || !formData.itemId) {
      setAdvanceCandidates([]);
      setSelectedMergeId("");
      return;
    }
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ instituteName: formData.instituteName, itemId: formData.itemId });
      fetch(`/api/advance-order-links/candidates?${params.toString()}`)
        .then((res) => res.json())
        .then((data: AdvanceCandidate[]) => {
          const list = Array.isArray(data) ? data : [];
          setAdvanceCandidates(list);
          setSelectedMergeId(list[0]?.orderId || "");
          setMergeEnabled(list.length > 0);
        })
        .catch((err) => console.error("Failed to load advance order candidates", err));
    }, 400);
    return () => clearTimeout(timer);
  }, [formData.instituteName, formData.itemId, formData.isAdvanceOrder]);

  const selectedCandidate = advanceCandidates.find((c) => c.orderId === selectedMergeId) || null;
  const requestedQty = Number(formData.reQty) || 0;
  const mergeCoverPreview = selectedCandidate ? Math.min(requestedQty, selectedCandidate.remainingQty) : 0;

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
      remark: initialData.remark || "",
      isAdvanceOrder: initialData.isAdvanceOrder || false,
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
    const isValidItem = stocks.some((x: any) => x.itemName === formData.itemName);
    if (!isValidItem) {
      alert("❌ Error: Invalid Product! Please select a valid item from the search suggestion dropdown list.");
      return;
    }

    if (!formData.reQty || formData.reQty <= 0) {
      alert("Please enter a quantity more than 0");
      return; // STOP the function here
    }
    setLoading(true);
    try {
      // Decide if we are updating or creating
      const isEditing = !!initialData?._id;
      const method = isEditing ? "PATCH" : "POST";
      const url = isEditing ? `/api/seller-orders/${initialData._id}` : "/api/seller-orders";

      // Advance Order auto-merge only applies to brand-new, non-advance orders with a
      // selected + enabled matching candidate.
      const mergeFields =
        !isEditing && !formData.isAdvanceOrder && mergeEnabled && selectedCandidate && mergeCoverPreview > 0
          ? { mergeAdvanceOrderId: selectedCandidate.orderId, mergeLinkedQty: mergeCoverPreview }
          : {};

      const res = await fetch(url, {
        method: method,
        headers: { "Content-Type": "application/json" },
        // createdBy is only sent on create — an edit shouldn't reassign authorship
        body: JSON.stringify({ ...formData, totalAmount, ...(isEditing ? {} : { createdBy: currentUsername, ...mergeFields }) })
      });

      if (res.ok) {
        const result = await res.json();
        if (result?.mergeWarning) {
          alert(`⚠ ${result.mergeWarning}`);
        } else {
          alert(isEditing ? "Order Updated Successfully!" : "Order Saved Successfully!");
        }
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

            {!formData.isAdvanceOrder && advanceCandidates.length > 0 && (
              <div className="md:col-span-3 p-4 bg-amber-50 border border-amber-300 rounded-xl space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black text-amber-800 uppercase tracking-wide">⚡ Advance Order Match Found</p>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      This Institute + Item already has material shipped early under{" "}
                      <span className="font-bold">{selectedCandidate?.orderNo}</span> (Remaining:{" "}
                      {selectedCandidate?.remainingQty}). Merging will cover{" "}
                      <span className="font-bold">{mergeCoverPreview}</span> of this order's {requestedQty || 0} unit(s) —
                      {mergeCoverPreview >= requestedQty && requestedQty > 0
                        ? " this order will be marked Fulfilled directly, no shipment needed."
                        : " the rest will still need a normal shipment."}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 shrink-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mergeEnabled}
                      onChange={(e) => setMergeEnabled(e.target.checked)}
                      className="w-4 h-4 accent-amber-600"
                    />
                    <span className="text-[10px] font-black text-amber-800 uppercase">Merge</span>
                  </label>
                </div>
                {advanceCandidates.length > 1 && (
                  <select
                    value={selectedMergeId}
                    onChange={(e) => setSelectedMergeId(e.target.value)}
                    className="w-full bg-white border border-amber-300 rounded-lg py-2 px-3 text-xs font-bold"
                  >
                    {advanceCandidates.map((c) => (
                      <option key={c.orderId} value={c.orderId}>
                        {c.orderNo} — Remaining {c.remainingQty}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <label className="md:col-span-3 flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl cursor-pointer">
              <input
                type="checkbox"
                checked={formData.isAdvanceOrder}
                onChange={(e) => setFormData({ ...formData, isAdvanceOrder: e.target.checked })}
                className="w-5 h-5 accent-amber-600"
              />
              <span className="text-xs font-bold text-amber-800">
                This is an Advance Order <span className="font-normal text-amber-700">(material delivered before the real GeM order exists)</span>
              </span>
            </label>

            <button type="submit" disabled={loading} className=" bg-blue-600 text-white font-black py-5 rounded-xl shadow-xl active:scale-95 transition-all uppercase tracking-widest">
              {loading ? "Saving..." : "Save Order"}
            </button>
          </form>
        </div>
      </div>
    </BlockGuard>
  );
}