"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { FiSave, FiArrowLeft, FiX, FiTrash2, FiPlus } from "react-icons/fi";
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

// One item line in the multi-item section - a single contract/entry can now
// bundle several different items at once ("Add Another Item"), each saved as
// its own SellerOrder document (see saveOrder below / app/api/seller-orders/bulk).
interface ItemRow {
  key: string;
  itemId: string;
  itemName: string;
  category: string;
  unit: string;
  sku: string;
  qty: number | "";
  rate: number | "";
  remark: string;
}

export default function SellerOrderForm({ onClose, initialData, isModal = false }: SellerOrderFormProps) {
  const router = useRouter();
  // Editing an existing order is always a single record - variant selection
  // there just re-points it at a different SKU (unchanged behavior). Only a
  // brand-new order can be split across several variant quantities, or now,
  // several entirely different items.
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

  // Common fields - shared across every item row in one save. Item-specific
  // fields (name/qty/rate/remark/etc.) live in itemRows instead - Remark used
  // to be one shared field for the whole entry, now each row carries its own.
  const blankFormData = {
    firmCode: "",
    subParty: "",
    sellerId: "",
    instituteName: "",
    contractDate: "",
    contractNo: "",
    contractUrl: "",
    // Advance Order Merge System: material shipped before the buyer's
    // official GeM order exists. deliveryDate doubles as "Material Sent
    // Date" here - same schema field the ship flow already uses elsewhere.
    isAdvance: false,
    deliveryDate: ""
  };
  const [formData, setFormData] = useState(blankFormData);

  const itemRowKeyRef = useRef(0);
  const makeEmptyItemRow = (): ItemRow => ({
    key: `row-${++itemRowKeyRef.current}`,
    itemId: "", itemName: "", category: "", unit: "", sku: "",
    qty: "" as any, rate: "" as any, remark: "",
  });
  const [itemRows, setItemRows] = useState<ItemRow[]>([makeEmptyItemRow()]);
  // Row keys that failed validation on the last save attempt - only used in
  // multi-row mode, to red-border the offending rows.
  const [rowErrors, setRowErrors] = useState<Set<string>>(new Set());
  const itemRowInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);

  useEffect(() => {
    if (pendingFocusKey) {
      itemRowInputRefs.current[pendingFocusKey]?.focus();
      setPendingFocusKey(null);
    }
  }, [itemRows, pendingFocusKey]);

  // Populated when the picked item (single-row mode only) belongs to a
  // variant group (e.g. "White Board Marker" Green/Red/Blue/Black) - each
  // sibling is its own SKU with its own stock, this just lets the user split
  // one contract across several colors/sizes by quantity instead of adding
  // each as its own generic item row.
  const [variantSiblings, setVariantSiblings] = useState<any[]>([]);
  // Create-mode only: per-variant _id -> qty (keyed by _id, not sku - some
  // real variant groups share one sku across all their color/size siblings).
  const [variantQtyMap, setVariantQtyMap] = useState<Record<string, number>>({});
  // "Save & Add Another" clears the form to enter the next order back-to-back
  // - the button itself keeps focus after being clicked, so re-focusing Firm
  // Code here means the user can start typing immediately instead of tabbing
  // back to the top of the form.
  const firmCodeInputRef = useRef<HTMLInputElement>(null);
  // "Save & Add Another" focuses here (not Firm Code) so back-to-back
  // Advance Order entries can Tab straight into it without reaching back up
  // past Firm Code/Institute/Item.
  const advanceCheckboxRef = useRef<HTMLInputElement>(null);
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
      contractDate: initialData.contractDate || "",
      contractNo: initialData.contractNo || "",
      contractUrl: initialData.contractUrl || "",
      isAdvance: !!initialData.isAdvance,
      deliveryDate: initialData.deliveryDate || ""
    });
    setItemRows([{
      key: `row-${++itemRowKeyRef.current}`,
      itemId: initialData.itemId || "",
      itemName: item?.itemName || initialData.itemName || "",
      category: initialData.category || "",
      unit: initialData.unit || "",
      sku: initialData.sku || "",
      qty: initialData.orderQty ?? initialData.reQty ?? "",
      rate: initialData.rate ?? "",
      remark: initialData.remark || "",
    }]);
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

  // Create-mode, exactly one item row, and that item belongs to a variant
  // group with >1 sibling means this order is a per-variant quantity split,
  // not a single-item order. Only available in single-row mode - once a
  // second (independent) item row is added, variant-split's own grid isn't
  // shown any more (each variant can still be added as its own row by name).
  const isSplitMode = !isEditing && itemRows.length === 1 && variantSiblings.length > 1;
  const variantQtySum = useMemo(
    () => Object.values(variantQtyMap).reduce((sum: number, q: any) => sum + (Number(q) || 0), 0),
    [variantQtyMap]
  );

  const grandTotal = useMemo(() => {
    if (isSplitMode) return variantQtySum * (Number(itemRows[0]?.rate) || 0);
    return itemRows.reduce((sum, r) => sum + (Number(r.qty) || 0) * (Number(r.rate) || 0), 0);
  }, [isSplitMode, variantQtySum, itemRows]);

  // How many item rows actually have something in them - used for the
  // "X Items" label and to know whether this save is single- or multi-item.
  const filledRowCount = useMemo(
    () => itemRows.filter((r) => r.itemId || Number(r.qty) > 0).length,
    [itemRows]
  );

  const updateItemRow = (index: number, patch: Partial<ItemRow>) => {
    setItemRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addItemRow = () => {
    const row = makeEmptyItemRow();
    setItemRows((prev) => [...prev, row]);
    setPendingFocusKey(row.key);
  };

  const removeItemRow = (index: number) => {
    setItemRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };

  // Shared item-search handler for both the single-row field and each
  // multi-row row - matches by exact name (excluding hidden items, a
  // retired duplicate often shares the exact same name as its active
  // replacement) same as the original single-item logic did.
  const handleItemSelectForRow = (index: number, val: string) => {
    updateItemRow(index, { itemName: val, itemId: "", category: "", unit: "", sku: "" });

    const selectedItem = stocks.find((x: any) => x.itemName === val && x.hidden !== true);
    if (selectedItem) {
      updateItemRow(index, {
        itemId: selectedItem._id,
        itemName: selectedItem.itemName,
        category: selectedItem.category,
        unit: selectedItem.unit,
        sku: selectedItem.sku,
      });
      if (index === 0 && itemRows.length === 1 && !isEditing) {
        setVariantSiblings(
          selectedItem.variantGroup
            ? stocks.filter((x: any) => x.variantGroup === selectedItem.variantGroup && x.hidden !== true)
            : []
        );
        setVariantQtyMap({});
      }
    } else if (index === 0 && itemRows.length === 1 && !isEditing) {
      setVariantSiblings([]);
      setVariantQtyMap({});
    }
  };

  // Non-blocking "this item is already in another row" warning (point 4 of
  // the spec) - flags every row sharing an itemId with an earlier row,
  // naming that earlier row's number.
  const getDuplicateRowMessage = (row: ItemRow, index: number): string | null => {
    if (!row.itemId) return null;
    const firstIndex = itemRows.findIndex((r) => r.itemId === row.itemId);
    if (firstIndex === -1 || firstIndex === index) return null;
    return `Yeh item pehle se Row ${firstIndex + 1} me hai`;
  };

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

  // A copied GeM contract link's anchor text sometimes contains its own
  // label twice (e.g. a visually-hidden accessibility duplicate) - collapse
  // an exact self-repeated string ("GEMC-XGEMC-X" -> "GEMC-X") so that never
  // lands in contractNo. This previously created a handful of orders whose
  // contractNo silently doubled, which broke duplicate-contract detection
  // (both direct order entry and GeM Order Intake) since it never matched
  // the real, single contract number scraped later.
  const dedupeRepeatedString = (s: string) => {
    const trimmed = (s || "").trim();
    const len = trimmed.length;
    if (len > 0 && len % 2 === 0) {
      const half = len / 2;
      if (trimmed.slice(0, half) === trimmed.slice(half)) return trimmed.slice(0, half);
    }
    return trimmed;
  };

  const handleContractPaste = (e: React.ClipboardEvent) => {
    // Always take over the paste ourselves - previously this only called
    // preventDefault() when an <a> tag was found in the pasted HTML, so a
    // paste with HTML clipboard data but no link (e.g. pasting into a
    // field that already had a value, cursor at the end) let the browser's
    // native paste insert into the DOM *in addition to* the setFormData
    // below, doubling the visible text.
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const plainText = e.clipboardData.getData("text/plain");
    if (html) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const link = doc.querySelector("a");
      if (link) {
        setFormData({ ...formData, contractNo: dedupeRepeatedString(link.textContent || plainText), contractUrl: link.href });
        return;
      }
    }
    setFormData({ ...formData, contractNo: dedupeRepeatedString(plainText) });
  };

  // Shared validate+save core. Returns true on success so the two submit
  // buttons (Save & Close vs Save & Add Another) can each decide what to do
  // afterwards without duplicating the validation/save logic. Branches into
  // four save paths depending on mode - see the comment above each one.
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

    // --- EDIT: always a single record, unchanged from before. ---
    if (isEditing) {
      const matchedStockItem = stocks.find((x: any) => x._id === itemRows[0]?.itemId);
      if (!matchedStockItem) {
        alert("❌ Error: Invalid Product! Please select a valid item from the search suggestion dropdown list.");
        return false;
      }
      if (matchedStockItem.hidden === true) {
        alert(`❌ Error: "${matchedStockItem.itemName}" (SKU ${matchedStockItem.sku}) is hidden/retired — it can't be used. Please select its active replacement from the search list.`);
        return false;
      }
      const qty = Number(itemRows[0]?.qty) || 0;
      if (qty <= 0) {
        alert("Please enter a quantity more than 0");
        return false;
      }

      setLoading(true);
      try {
        const payload: any = {
          ...formData,
          itemId: matchedStockItem._id,
          itemName: matchedStockItem.itemName,
          category: matchedStockItem.category,
          unit: matchedStockItem.unit,
          sku: matchedStockItem.sku,
          reQty: qty,
          orderQty: qty,
          rate: Number(itemRows[0]?.rate) || 0,
          totalAmount: qty * (Number(itemRows[0]?.rate) || 0),
          remark: itemRows[0]?.remark || "",
        };
        if (!payload.sellerId) delete payload.sellerId;

        const res = await fetch(`/api/seller-orders/${initialData._id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          const result = await res.json();
          if (result?.mergeWarning) alert(`⚠ ${result.mergeWarning}`);
          if (result?._id) savedOrdersRef.current.push(result);
          return true;
        } else {
          const err = await res.json();
          alert(`Error updating order: ${err.error || "Failed to save"}`);
          return false;
        }
      } catch (error) {
        alert("Check your server connection.");
        return false;
      } finally {
        setLoading(false);
      }
    }

    // --- CREATE, single row, variant split: unchanged from before - each
    // filled-in variant saves as its own line via the existing single-order
    // endpoint, sequentially (orderNo is generated by reading the current
    // highest one, so concurrent POSTs could race and collide). ---
    if (isSplitMode) {
      const lines = variantSiblings
        .map((v: any) => ({ item: v, qty: Number(variantQtyMap[v._id]) || 0 }))
        .filter((l) => l.qty > 0);
      if (lines.length === 0) {
        alert("Please enter a quantity for at least one variant.");
        return false;
      }

      setLoading(true);
      try {
        for (const { item, qty } of lines) {
          const payload: any = {
            ...formData,
            itemId: item._id,
            itemName: item.itemName,
            category: item.category,
            unit: item.unit,
            sku: item.sku,
            reQty: qty,
            orderQty: qty,
            rate: Number(itemRows[0]?.rate) || 0,
            totalAmount: qty * (Number(itemRows[0]?.rate) || 0),
            remark: itemRows[0]?.remark || "",
            createdBy: currentUsername,
          };
          if (!payload.sellerId) delete payload.sellerId;

          const res = await fetch("/api/seller-orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });

          if (res.ok) {
            const result = await res.json();
            if (result?.mergeWarning) alert(`⚠ ${result.mergeWarning}`);
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
    }

    // --- CREATE, generic rows (one or many): a completely empty row (no
    // item, no qty) is silently dropped rather than blocking save; any
    // remaining row missing either is blocked and highlighted. ---
    const nonEmptyRows = itemRows.filter((r) => r.itemId || Number(r.qty) > 0);
    if (nonEmptyRows.length === 0) {
      alert("Please add at least one item.");
      return false;
    }
    const badRowKeys = new Set<string>();
    for (const r of nonEmptyRows) {
      if (!r.itemId || !Number(r.qty) || Number(r.qty) <= 0) badRowKeys.add(r.key);
    }
    if (badRowKeys.size > 0) {
      setRowErrors(badRowKeys);
      alert("Har item row me ek valid item aur quantity (> 0) zaroori hai.");
      return false;
    }
    setRowErrors(new Set());

    for (const r of nonEmptyRows) {
      const matchedStockItem = stocks.find((x: any) => x._id === r.itemId);
      if (!matchedStockItem) {
        alert("❌ Error: Invalid Product! Please select a valid item from the search suggestion dropdown list.");
        return false;
      }
      if (matchedStockItem.hidden === true) {
        alert(`❌ Error: "${matchedStockItem.itemName}" (SKU ${matchedStockItem.sku}) is hidden/retired — it can't be used. Please select its active replacement from the search list.`);
        return false;
      }
    }

    // Exactly one real row: unchanged existing single-order endpoint, so the
    // common "just add one order" case behaves exactly as it always has.
    if (nonEmptyRows.length === 1) {
      const matchedStockItem = stocks.find((x: any) => x._id === nonEmptyRows[0].itemId);
      setLoading(true);
      try {
        const payload: any = {
          ...formData,
          itemId: matchedStockItem._id,
          itemName: matchedStockItem.itemName,
          category: matchedStockItem.category,
          unit: matchedStockItem.unit,
          sku: matchedStockItem.sku,
          reQty: Number(nonEmptyRows[0].qty),
          orderQty: Number(nonEmptyRows[0].qty),
          rate: Number(nonEmptyRows[0].rate) || 0,
          totalAmount: Number(nonEmptyRows[0].qty) * (Number(nonEmptyRows[0].rate) || 0),
          remark: nonEmptyRows[0].remark || "",
          createdBy: currentUsername,
        };
        if (!payload.sellerId) delete payload.sellerId;

        const res = await fetch("/api/seller-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          const result = await res.json();
          if (result?.mergeWarning) alert(`⚠ ${result.mergeWarning}`);
          if (result?._id) savedOrdersRef.current.push(result);
          return true;
        } else {
          const err = await res.json();
          alert(`Error saving order: ${err.error || "Failed to save"}`);
          return false;
        }
      } catch (error) {
        alert("Check your server connection.");
        return false;
      } finally {
        setLoading(false);
      }
    }

    // Two or more real rows: one request to the transactional bulk endpoint
    // - all-or-nothing, so a failure on any item saves none of them.
    setLoading(true);
    try {
      const payload: any = {
        ...formData,
        createdBy: currentUsername,
        items: nonEmptyRows.map((r) => {
          const matchedStockItem = stocks.find((x: any) => x._id === r.itemId);
          return {
            itemId: r.itemId,
            itemName: matchedStockItem?.itemName || r.itemName,
            category: matchedStockItem?.category || r.category,
            unit: matchedStockItem?.unit || r.unit,
            sku: matchedStockItem?.sku || r.sku,
            qty: Number(r.qty),
            rate: Number(r.rate) || 0,
            remark: r.remark || "",
          };
        }),
      };
      if (!payload.sellerId) delete payload.sellerId;

      const res = await fetch("/api/seller-orders/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const result = await res.json();
        if (Array.isArray(result?.orders)) savedOrdersRef.current.push(...result.orders);
        return true;
      } else {
        const err = await res.json();
        alert(`Error saving items: ${err.error || "Failed to save"}`);
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
    const before = savedOrdersRef.current.length;
    const ok = await saveOrder();
    if (!ok) return;
    const added = savedOrdersRef.current.length - before;

    alert(initialData?._id ? "Order Updated Successfully!" : added > 1 ? `✓ ${added} items saved` : "Order Saved Successfully!");
    if (isModal && onClose) {
      onClose(savedOrdersRef.current); // parent merges these locally - no refetch/reload
    } else {
      window.location.reload();
    }
  };

  // Saves the current order(s) but keeps the modal open with a blank form
  // for the next one - firms/institutes/stock are already loaded, so there's
  // no refetch, and there's no reopen-"Add Order" round trip between
  // entries. Firm/Party/Institute/Contract Date/Contract No stay filled in
  // (useful for entering several contracts for the same institute back to
  // back); only the item rows and Remark reset.
  const handleSaveAndAddAnother = async () => {
    const before = savedOrdersRef.current.length;
    const ok = await saveOrder();
    if (!ok) return;
    const added = savedOrdersRef.current.length - before;

    // Item rows (each carrying its own remark) reset to one blank row -
    // Firm/Party/Institute/Contract Date/Contract No stay as-is on formData.
    setItemRows([makeEmptyItemRow()]);
    setVariantSiblings([]);
    setVariantQtyMap({});
    setRowErrors(new Set());
    setSavedFlash(added > 1 ? `✓ ${added} items saved — add the next one` : "✓ Order saved — add the next one");
    setTimeout(() => setSavedFlash(""), 2500);
    advanceCheckboxRef.current?.focus();
  };

  const isMultiRowMode = !isEditing && itemRows.length > 1;

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

            <label className="md:col-span-3 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 cursor-pointer w-fit">
              <input
                ref={advanceCheckboxRef}
                type="checkbox"
                className="w-3.5 h-3.5 accent-amber-600"
                checked={formData.isAdvance}
                onChange={(e) => {
                  const checked = e.target.checked;
                  // "AD" is the real registered firm code (firmName "ADVANCE")
                  // this firm's team already uses as the placeholder for
                  // advance shipments - not an invented value. Also shown
                  // while editing an existing order (not just on create) so
                  // a regular order placed under the wrong firm can be
                  // converted to Advance without deleting and re-entering it.
                  setFormData(prev => ({ ...prev, isAdvance: checked, firmCode: checked ? "AD" : "" }));
                }}
              />
              <span className="text-[10px] font-black text-amber-700 uppercase tracking-widest">
                Advance Order — material shipped before official GeM order exists
              </span>
            </label>

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

            <div className={isMultiRowMode ? "md:col-span-2 space-y-2" : "space-y-2"}>
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

            {/* Single-item mode: the original one-field item search, exactly
                as before. Disappears once a second row is added - Institute
                above takes its place (md:col-span-2) and every item lives in
                the multi-row block below instead. */}
            {!isMultiRowMode && (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Search Item Name *</label>
                <input
                  list="stock-items"
                  required
                  placeholder="Type to search..."
                  className="w-full p-4 bg-slate-50 border rounded-xl text-sm outline-none"
                  value={itemRows[0]?.itemName || ""}
                  onChange={(e) => handleItemSelectForRow(0, e.target.value)}
                />
                <datalist id="stock-items">
                  {stocks.filter((i: any) => i.hidden !== true).map((i: any) => (
                    <option key={i._id} value={i.itemName}>
                      {i.sku} — {i.category} ({i.unit})
                    </option>
                  ))}
                </datalist>
              </div>
            )}
            {isMultiRowMode && (
              <datalist id="stock-items">
                {stocks.filter((i: any) => i.hidden !== true).map((i: any) => (
                  <option key={i._id} value={i.itemName}>
                    {i.sku} — {i.category} ({i.unit})
                  </option>
                ))}
              </datalist>
            )}

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
                    value={itemRows[0]?.itemId || ""}
                    onChange={(e) => {
                      const chosen = variantSiblings.find((v: any) => v._id === e.target.value);
                      if (!chosen) return;
                      updateItemRow(0, {
                        itemId: chosen._id,
                        itemName: chosen.itemName,
                        category: chosen.category,
                        unit: chosen.unit,
                        sku: chosen.sku
                      });
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
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Material Sent Date</label>
                <input type="date" className="w-full p-4 bg-slate-50 border rounded-xl text-sm" value={formData.deliveryDate} onChange={(e) => setFormData({ ...formData, deliveryDate: e.target.value })} />
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

            {!isMultiRowMode ? (
              <>
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
                      value={itemRows[0]?.qty ?? ""}
                      onChange={(e) => updateItemRow(0, { qty: e.target.value === "" ? "" : Number(e.target.value) })}
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Rate</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full p-4 bg-slate-50 border rounded-xl text-sm"
                    placeholder="Enter Rate"
                    value={itemRows[0]?.rate ?? ""}
                    onChange={(e) => updateItemRow(0, { rate: e.target.value === "" ? "" : Number(e.target.value) })}
                  />
                </div>

                {!isEditing && !isSplitMode && (
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={addItemRow}
                      className="w-full flex items-center justify-center gap-1.5 py-4 border-2 border-dashed border-slate-300 text-slate-500 hover:text-blue-600 hover:border-blue-400 rounded-xl font-bold uppercase text-[10px] tracking-wider transition-colors"
                    >
                      <FiPlus size={13} /> Add Another Item
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="md:col-span-3 space-y-3">
                <div className="flex items-center gap-2 px-0.5">
                  <span className="w-6 shrink-0" />
                  <div className="flex-1 text-slate-500 font-bold uppercase tracking-wider text-[10px]">Item Name</div>
                  <div className="w-20 shrink-0 text-slate-500 font-bold uppercase tracking-wider text-[10px] text-center">Qty</div>
                  <div className="w-24 shrink-0 text-slate-500 font-bold uppercase tracking-wider text-[10px] text-center">Rate ₹</div>
                  <div className="w-28 shrink-0 text-slate-500 font-bold uppercase tracking-wider text-[10px] text-center">Line Total</div>
                  <span className="w-5 shrink-0" />
                </div>

                <div className="max-h-[36vh] overflow-y-auto space-y-2 pr-1">
                  {itemRows.map((row, index) => {
                    const dupMessage = getDuplicateRowMessage(row, index);
                    const hasError = rowErrors.has(row.key);
                    return (
                      <div
                        key={row.key}
                        className={`space-y-2 p-2.5 rounded-xl border ${hasError ? "border-red-400 bg-red-50/50" : "border-slate-200 bg-slate-50/50"}`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start gap-2">
                          <span className="hidden sm:flex w-6 h-11 shrink-0 items-center justify-center text-xs font-black text-slate-400">
                            {index + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <input
                              ref={(el) => { itemRowInputRefs.current[row.key] = el; }}
                              list="stock-items"
                              placeholder={`Item #${index + 1} — search...`}
                              className="w-full p-3 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400"
                              value={row.itemName}
                              onChange={(e) => handleItemSelectForRow(index, e.target.value)}
                            />
                            {dupMessage && (
                              <p className="text-[10px] text-amber-600 font-bold mt-1">⚠ {dupMessage}</p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <div className="w-20 shrink-0">
                              <input
                                type="number"
                                min={1}
                                placeholder="Qty"
                                className="w-full p-3 bg-white border border-slate-200 rounded-lg text-sm text-center outline-none focus:ring-2 focus:ring-blue-400"
                                value={row.qty}
                                onChange={(e) => updateItemRow(index, { qty: e.target.value === "" ? "" : Number(e.target.value) })}
                              />
                            </div>
                            <div className="w-24 shrink-0">
                              <input
                                type="number"
                                step="0.01"
                                placeholder="Rate"
                                className="w-full p-3 bg-white border border-slate-200 rounded-lg text-sm text-center outline-none focus:ring-2 focus:ring-blue-400"
                                value={row.rate}
                                onChange={(e) => updateItemRow(index, { rate: e.target.value === "" ? "" : Number(e.target.value) })}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && index === itemRows.length - 1) {
                                    e.preventDefault();
                                    addItemRow();
                                  }
                                }}
                              />
                            </div>
                            <div className="w-28 shrink-0 p-3 bg-emerald-50 text-emerald-800 font-black rounded-lg text-sm text-center">
                              ₹{((Number(row.qty) || 0) * (Number(row.rate) || 0)).toLocaleString("en-IN")}
                            </div>
                            <button
                              type="button"
                              onClick={() => removeItemRow(index)}
                              disabled={itemRows.length === 1}
                              title="Remove this item"
                              className="shrink-0 w-5 flex items-center justify-center text-red-400 hover:text-red-600 disabled:opacity-20 disabled:pointer-events-none transition-colors mt-3"
                            >
                              <FiTrash2 size={14} />
                            </button>
                          </div>
                        </div>
                        <div className="sm:pl-8">
                          <input
                            type="text"
                            placeholder="Remark for this item..."
                            className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-400"
                            value={row.remark}
                            onChange={(e) => updateItemRow(index, { remark: e.target.value })}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={addItemRow}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 border-2 border-dashed border-slate-300 text-slate-500 hover:text-blue-600 hover:border-blue-400 rounded-lg font-bold uppercase text-[10px] tracking-wider transition-colors"
                >
                  <FiPlus size={13} /> Add Another Item
                </button>
              </div>
            )}

            <div className={`px-6 pt-1 bg-slate-900 mt-5 rounded-xl flex justify-between items-center text-white ${isMultiRowMode ? "md:col-span-3" : ""}`}>
              <span className="font-black uppercase tracking-widest text-xs">
                {isMultiRowMode ? `Grand Total — ${filledRowCount} Item${filledRowCount === 1 ? "" : "s"}` : "Total"}
              </span>
              <span className="text-2xl font-black">₹ {grandTotal.toLocaleString("en-IN")}</span>
            </div>

            {!isMultiRowMode && (
              <div className="md:col-span-2 space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Remark</label>
                <textarea
                  className="w-full p-4 bg-slate-50 border rounded-xl  text-sm"
                  placeholder="Optional notes..."
                  value={itemRows[0]?.remark || ""}
                  onChange={(e) => updateItemRow(0, { remark: e.target.value })}
                />
              </div>
            )}

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
