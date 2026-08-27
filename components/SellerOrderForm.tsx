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
  // Editing an existing order is always a single record - variant selection
  // there just re-points it at a different SKU (unchanged behavior). Only a
  // brand-new order can be split across several variant quantities at once.
  const isEditing = !!initialData?._id;
  const [loading, setLoading] = useState(false);
  const [sellers, setSellers] = useState<any[]>([]);
  const [stocks, setStocks] = useState<any[]>([]);
  const [firms, setFirms] = useState<any[]>([]);
  const [parties, setParties] = useState<string[]>([]);
  const [showAddParty, setShowAddParty] = useState(false);
  const [newPartyName, setNewPartyName] = useState("");
  const [addingParty, setAddingParty] = useState(false);
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

  useEffect(() => {
    if (!isModal) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.(savedOrdersRef.current);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isModal, onClose]);

  const blankFormData = {
    firmCode: "",
    subParty: "",
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
    // Advance Order Merge System: material shipped before the buyer's
    // official GeM order exists. deliveryDate doubles as "Material Sent
    // Date" here - same schema field the ship flow already uses elsewhere.
    isAdvance: false,
    deliveryDate: ""
  };
  const [formData, setFormData] = useState(blankFormData);
  // Populated when the picked item belongs to a variant group (e.g. "White
  // Board Marker" Green/Red/Blue/Black) - each sibling is its own SKU with
  // its own stock, this just lets the user pick the right one by label
  // instead of having to know/type the exact per-color/size item name.
  const [variantSiblings, setVariantSiblings] = useState<any[]>([]);
  // Create-mode only: per-variant _id -> qty (keyed by _id, not sku - some
  // real variant groups share one sku across all their color/size siblings),
  // so one contract can be split across several colors/sizes (e.g. 10 Red +
  // 10 Blue + 5 Black + 5 Green) and saved as one seller-order line per
  // variant with qty > 0.
  const [variantQtyMap, setVariantQtyMap] = useState<Record<string, number>>({});
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
      subParty: initialData.subParty || "",
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
      isAdvance: !!initialData.isAdvance,
      deliveryDate: initialData.deliveryDate || ""
    });
    loadedRecordRef.current = recordKey;
  }, [initialData, sellers, stocks]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [selRes, stkRes, firmRes, partyRes] = await Promise.all([
          fetch("/api/sellers"),
          fetch("/api/stock"),
          fetch("/api/companies"),
          fetch("/api/order-parties")
        ]);
        const selData = await selRes.json();
        const stkData = await stkRes.json();
        const firmData = await firmRes.json();
        const partyData = await partyRes.json();

        setSellers(Array.isArray(selData) ? selData : []);
        setStocks(Array.isArray(stkData) ? stkData : []);
        setFirms(Array.isArray(firmData) ? firmData : []);
        setParties(Array.isArray(partyData) ? partyData : []);
      } catch (err) {
        console.error("Load error", err);
      } finally {
        setDataLoaded(true);
      }
    };
    loadData();
  }, []);

  // Create-mode + a variant group with >1 sibling means this order is a
  // per-variant quantity split, not a single-item order.
  const isSplitMode = !isEditing && variantSiblings.length > 1;
  const variantQtySum = useMemo(
    () => Object.values(variantQtyMap).reduce((sum: number, q: any) => sum + (Number(q) || 0), 0),
    [variantQtyMap]
  );

  // const totalAmount = useMemo(() => formData.orderQty * formData.rate, [formData.orderQty, formData.rate]);
  const totalAmount = useMemo(() => {
    // Use reQty if available, otherwise orderQty, fallback to 0
    const qty = isSplitMode ? variantQtySum : (formData.reQty ?? formData.orderQty ?? 0);
    const rate = formData.rate ?? 0;

    return qty * rate;
  }, [isSplitMode, variantQtySum, formData.reQty, formData.orderQty, formData.rate]);

  const handleAddParty = async () => {
    const name = newPartyName.trim().toLowerCase();
    if (!name) return;
    setAddingParty(true);
    try {
      const res = await fetch("/api/order-parties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setParties((prev) => (prev.includes(name) ? prev : [...prev, name].sort()));
        setFormData((prev) => ({ ...prev, subParty: name }));
        setNewPartyName("");
        setShowAddParty(false);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to add party");
      }
    } finally {
      setAddingParty(false);
    }
  };

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
    // Advance Order: firmCode is the literal placeholder "ADVANCE" (no real
    // firm chosen yet - that happens later when the buyer's actual GeM order
    // is merged in), so the normal known-firm-list check doesn't apply here.
    const isValidFirm = formData.isAdvance || firms.some((f: any) => f.firmCode === formData.firmCode);
    if (!isValidFirm) {
      alert("❌ Error: Please select a valid Firm Code from the dropdown list suggestions.");
      return false; // Block database submit action pipeline completely
    }

    // Build the list of {item, qty} lines to save. Normally there's just one
    // (the single selected item), but a variant-group item with per-variant
    // quantities filled in (e.g. one GeM contract split 10 Red / 10 Blue / 5
    // Black / 5 Green) saves one seller-order line per non-zero variant, all
    // sharing this same contractNo/contractDate/firmCode/rate/remark.
    let lines: { item: any; qty: number }[] = [];
    if (isSplitMode) {
      lines = variantSiblings
        .map((v: any) => ({ item: v, qty: Number(variantQtyMap[v._id]) || 0 }))
        .filter((l) => l.qty > 0);
      if (lines.length === 0) {
        alert("Please enter a quantity for at least one variant.");
        return false;
      }
    } else {
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
      lines = [{ item: matchedStockItem, qty: formData.reQty }];
    }

    setLoading(true);
    try {
      const method = isEditing ? "PATCH" : "POST";
      const url = isEditing ? `/api/seller-orders/${initialData._id}` : "/api/seller-orders";

      // Saved sequentially (not in parallel) since seller-orders generate
      // their orderNo by reading the current highest one - concurrent POSTs
      // could race and collide on the same orderNo.
      for (const { item, qty } of lines) {
        // sellerId is an ObjectId field server-side - "" (no institute match
        // found, e.g. a GeM-verify order matched by name only) must not be
        // sent as-is, or the update throws a Mongoose cast error. Omit the
        // key entirely rather than nulling it: on an edit, that leaves
        // whatever sellerId already exists on the order untouched instead of
        // silently wiping out a valid link just because this save's
        // institute-name match happened not to resolve.
        const payload: any = {
          ...formData,
          itemId: item._id,
          itemName: item.itemName,
          category: item.category,
          unit: item.unit,
          sku: item.sku,
          reQty: qty,
          orderQty: qty,
          totalAmount: qty * (formData.rate || 0),
          ...(isEditing ? {} : { createdBy: currentUsername }),
        };
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
        } else {
          const err = await res.json();
          alert(`Error saving ${item.variantLabel || item.itemName}: ${err.error || "Failed to save"}`);
          return false; // lines already saved before this one stay saved
        }
      }
      return true;
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
    setVariantSiblings([]);
    setVariantQtyMap({});
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

            {!isEditing && (
              <label className="md:col-span-3 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 cursor-pointer w-fit">
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 accent-amber-600"
                  checked={formData.isAdvance}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    // "AD" is the real registered firm code (firmName "ADVANCE")
                    // this firm's team already uses as the placeholder for
                    // advance shipments - not an invented value.
                    setFormData(prev => ({ ...prev, isAdvance: checked, firmCode: checked ? "AD" : "" }));
                  }}
                />
                <span className="text-[10px] font-black text-amber-700 uppercase tracking-widest">
                  Advance Order — material shipped before official GeM order exists
                </span>
              </label>
            )}

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
                disabled={formData.isAdvance}
                placeholder="Search Firm..."
                className="w-full p-4 bg-slate-50 border rounded-xl text-sm outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                value={formData.firmCode}
                onChange={(e) => setFormData({ ...formData, firmCode: e.target.value })}
                onBlur={(e) => {
                  if (formData.isAdvance) return; // "ADVANCE" is a valid placeholder, not a real firm to check
                  const typedVal = e.target.value.trim();
                  if (!typedVal) return; // Allow them to leave it blank if they want to fill it later

                  // Check if the typed word matches an actual code from the firms database
                  // ("AD" excluded here too - it's the Advance placeholder, not
                  // a firm to manually type/select outside Advance Order mode)
                  const matchFound = typedVal !== "AD" && firms.some((f: any) => f.firmCode === typedVal);

                  if (!matchFound) {
                    alert(`❌ "${typedVal}" is not a valid firm code! Please pick an option from the list.`);
                    setFormData({ ...formData, firmCode: "" }); // Erase the invalid words completely
                  }
                }}
              />
              <datalist id="firm-options">
                {/* "AD" (firmName "ADVANCE") is a placeholder, not a real firm
                    to ship under - hidden from normal search so nobody picks
                    it by hand. The Advance Order checkbox above sets it
                    programmatically instead. */}
                {firms.filter((f: any) => f.firmCode !== "AD").map((f: any) => (
                  <option key={f._id} value={f.firmCode}>
                    {f.firmName}
                  </option>
                ))}
              </datalist>
              <div className="flex items-center gap-1.5">
                <select
                  className="flex-1 min-w-0 px-3 py-1.5 bg-transparent text-[10px] lowercase text-slate-400 outline-none"
                  value={formData.subParty}
                  onChange={(e) => setFormData({ ...formData, subParty: e.target.value })}
                  title="If an outside party actually supplied/handled this order (billed under this firm's GST), pick them here — keeps Firm Code as the real firm for billing."
                >
                  <option value="">party (optional)</option>
                  {parties.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                  {/* Guards against an existing order's subParty (e.g. from before
                      this party was added to the shared list, or since removed)
                      not matching any option and silently getting blanked out. */}
                  {formData.subParty && !parties.includes(formData.subParty) && (
                    <option value={formData.subParty}>{formData.subParty}</option>
                  )}
                </select>
                <button
                  type="button"
                  onClick={() => setShowAddParty((v) => !v)}
                  title="Add a new party to the list"
                  className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:text-blue-600 hover:bg-blue-50 text-xs font-black leading-none"
                >
                  +
                </button>
              </div>
              {showAddParty && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    autoFocus
                    placeholder="New party name..."
                    className="flex-1 min-w-0 px-3 py-1.5 bg-slate-50 border rounded-lg text-[10px] lowercase outline-none"
                    value={newPartyName}
                    onChange={(e) => setNewPartyName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddParty();
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={addingParty || !newPartyName.trim()}
                    onClick={handleAddParty}
                    className="shrink-0 text-[9px] font-black uppercase tracking-widest text-blue-600 hover:text-blue-700 disabled:opacity-40 border border-blue-200 rounded-lg px-2 py-1.5"
                  >
                    {addingParty ? "..." : "Add"}
                  </button>
                </div>
              )}
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
                    // If this item has color/size siblings, offer them below -
                    // matched on variantGroup (a real shared field), never on
                    // name, for the same reason hidden-duplicate matching was
                    // banned elsewhere in this file.
                    setVariantSiblings(
                      selectedItem.variantGroup
                        ? stocks.filter((x: any) => x.variantGroup === selectedItem.variantGroup && x.hidden !== true)
                        : []
                    );
                    setVariantQtyMap({});
                  } else {
                    setVariantSiblings([]);
                    setVariantQtyMap({});
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

            {/* Full-width (md:col-span-3) so this block always occupies its
                own row - appearing/disappearing only pushes the fields below
                it down as a whole row, instead of shifting them sideways
                into different grid columns (the old "cells jump" bug). */}
            {variantSiblings.length > 1 && (
              isEditing ? (
                <div className="md:col-span-3 space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Variant *</label>
                  <select
                    required
                    className="w-full md:w-1/3 p-4 bg-slate-50 border rounded-xl text-sm outline-none"
                    value={formData.itemId}
                    onChange={(e) => {
                      const chosen = variantSiblings.find((v: any) => v._id === e.target.value);
                      if (!chosen) return;
                      setFormData(prev => ({
                        ...prev,
                        itemId: chosen._id,
                        itemName: chosen.itemName,
                        category: chosen.category,
                        unit: chosen.unit,
                        sku: chosen.sku
                      }));
                    }}
                  >
                    {variantSiblings.map((v: any) => (
                      <option key={v._id} value={v._id}>{v.variantLabel || v.sku}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="md:col-span-3 space-y-3 bg-blue-50/70 border border-blue-200 rounded-2xl p-5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-black text-blue-700 uppercase tracking-widest">
                      Split This Order Across Variants
                    </label>
                    <span className="text-xs font-black text-blue-700">
                      Total: {variantQtySum}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {variantSiblings.map((v: any) => (
                      <div key={v._id} className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase truncate block" title={v.variantLabel || v.sku}>
                          {v.variantLabel || v.sku}
                        </label>
                        <input
                          type="number"
                          min={0}
                          className="w-full p-3 bg-white border border-blue-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400"
                          placeholder="0"
                          value={variantQtyMap[v._id] || ""}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            setVariantQtyMap(prev => ({ ...prev, [v._id]: val }));
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-[9px] text-blue-600 font-semibold px-1">
                    Enter the quantity for each color/size you're shipping under this one contract — one order line is created per variant filled in.
                  </p>
                </div>
              )
            )}

            {formData.isAdvance ? (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Material Sent Date *</label>
                <input type="date" required className="w-full p-4 bg-slate-50 border rounded-xl text-sm" value={formData.deliveryDate} onChange={(e) => setFormData({ ...formData, deliveryDate: e.target.value })} />
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Contract Date</label>
                <input type="date" className="w-full p-4 bg-slate-50 border rounded-xl text-sm" value={formData.contractDate} onChange={(e) => setFormData({ ...formData, contractDate: e.target.value })} />
              </div>
            )}

            <div className="md:col-span-2 space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Contract No. (Paste Link here)</label>
              <input type="text" className="w-full p-4 bg-slate-50 border rounded-xl text-sm focus:ring-2 focus:ring-blue-400 outline-none" placeholder="Paste GEM Link..." value={formData.contractNo} onPaste={handleContractPaste} onChange={(e) => setFormData({ ...formData, contractNo: e.target.value })} />
              {formData.contractUrl && <p className="text-[9px] text-blue-600 font-bold px-2 italic truncate">URL: {formData.contractUrl}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Order Qty *</label>
              {isSplitMode ? (
                <div className="w-full p-4 bg-slate-100 border rounded-xl text-sm text-slate-600 font-black">
                  {variantQtySum} <span className="font-medium text-slate-400 normal-case">(sum of variants above)</span>
                </div>
              ) : (
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
              )}
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Rate</label>
              <input type="number" step="0.01" className="w-full p-4 bg-slate-50 border rounded-xl text-sm" placeholder="Enter Rate" value={formData.rate} onChange={(e) => setFormData({ ...formData, rate: Number(e.target.value) })} />
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