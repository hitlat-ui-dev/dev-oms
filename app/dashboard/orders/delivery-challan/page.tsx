"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  FiArrowLeft, FiPlus, FiTrash2, FiSearch, FiX, FiFileText, FiSave,
  FiDownload, FiEdit2, FiCheck, FiRefreshCw, FiChevronDown, FiCopy,
} from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

interface Company {
  _id: string;
  firmName: string;
  firmCode: string;
}

interface MasterItem {
  _id: string;
  itemName: string;
  unit?: string;
  usageCount?: number;
}

interface SellerOption {
  _id: string;
  instituteName?: string;
  buyerName?: string;
  address?: string;
  place?: string;
  state?: string;
  mobile?: string;
}

// A row in the challan table. `key` is a client-only stable identity: Sr. No.
// is positional and the same master item can legitimately appear twice, so
// neither can be used as a React key.
interface Line {
  key: string;
  itemMasterId: string | null;
  itemName: string;
  qty: string; // kept as a string so the input can be emptied mid-typing
  unit: string;
}

interface ChallanSummary {
  _id: string;
  firmCode: string;
  dcNumberFormatted: string;
  date: string;
  status: "draft" | "finalized";
  consignee?: { instituteName?: string; buyerName?: string };
  items: { itemName: string }[];
  totalQty: number;
}

const BLANK_CONSIGNEE = {
  sellerId: "",
  instituteName: "",
  buyerName: "",
  address: "",
  place: "",
  state: "",
  mobile: "",
};

/** yyyy-mm-dd for a date input, built from LOCAL parts. toISOString() would
 * shift the day across the UTC boundary and reopen a challan on the wrong
 * date. */
function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayISO(): string {
  return toDateInputValue(new Date());
}

function formatDateDDMMYYYY(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Opens a generated PDF in a new tab. The API hands back base64 rather than a
 * URL, so it's rebuilt into a blob here instead of being re-fetched. */
function openPdfFromBase64(base64: string, fileName: string) {
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const win = window.open(url, "_blank");
  if (!win) {
    // Pop-up blocked - fall back to a direct download so the work isn't lost.
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default function DeliveryChallanPage() {
  const [username, setUsername] = useState("");

  const [companies, setCompanies] = useState<Company[]>([]);
  const [firmCode, setFirmCode] = useState("");
  const [date, setDate] = useState(todayISO);
  const [numberMode, setNumberMode] = useState<"auto" | "manual">("auto");
  const [manualNumber, setManualNumber] = useState("");
  const [preview, setPreview] = useState<{ dcNumberFormatted: string; financialYear: string; nextSequence: number } | null>(null);

  const [masterItems, setMasterItems] = useState<MasterItem[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [sellers, setSellers] = useState<SellerOption[]>([]);

  const [consignee, setConsignee] = useState({ ...BLANK_CONSIGNEE });
  const [consigneeOpen, setConsigneeOpen] = useState(false);

  const [lines, setLines] = useState<Line[]>([]);
  const [remarks, setRemarks] = useState("");

  // The challan being worked on: null until it's first saved, then reused by
  // every later save so editing never creates a second record.
  const [challanId, setChallanId] = useState<string | null>(null);
  const [status, setStatus] = useState<"draft" | "finalized">("draft");
  const [issuedNumber, setIssuedNumber] = useState("");

  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [manageMode, setManageMode] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [showNewItemForm, setShowNewItemForm] = useState(false);
  const [newItem, setNewItem] = useState({ itemName: "", qty: "1", unit: "" });

  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [history, setHistory] = useState<ChallanSummary[]>([]);
  const [historyFirm, setHistoryFirm] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  const pickerRef = useRef<HTMLDivElement | null>(null);
  const lineKeySeq = useRef(0);
  const nextLineKey = () => `line-${lineKeySeq.current++}`;

  // ---- Initial data ----
  useEffect(() => {
    const session = localStorage.getItem("oms_user");
    if (session) {
      try {
        setUsername(JSON.parse(session).username || "");
      } catch {
        /* a malformed session just means no createdBy stamp */
      }
    }

    fetch("/api/companies")
      .then((r) => r.json())
      .then((data: Company[]) => {
        const list = Array.isArray(data) ? data : [];
        setCompanies(list);
        // Firms rarely change between challans, so the last one used is
        // remembered rather than forcing a re-pick on every visit. A firm is
        // optional though, so the fallback is NO firm - not whichever company
        // happens to sort first, which would silently stamp a header onto a
        // challan that was never meant to carry one.
        const remembered = localStorage.getItem("dc_last_firm");
        setFirmCode(list.some((c) => c.firmCode === remembered) ? (remembered as string) : "");
      })
      .catch(() => setError("Couldn't load firms."));

    fetch("/api/units")
      .then((r) => r.json())
      .then((data) => setUnits(Array.isArray(data) ? data.map((u: any) => u.name).filter(Boolean) : []))
      .catch(() => {});

    fetch("/api/sellers")
      .then((r) => r.json())
      .then((data) => setSellers(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const loadMasterItems = useCallback(() => {
    return fetch("/api/dc-item-master")
      .then((r) => r.json())
      .then((data) => setMasterItems(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadMasterItems();
  }, [loadMasterItems]);

  // The search box refetches, so the typed value is debounced - without this
  // every keystroke fires its own query against the challan collection.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(historySearch.trim()), 300);
    return () => clearTimeout(t);
  }, [historySearch]);

  const loadHistory = useCallback(() => {
    setLoadingHistory(true);
    const params = new URLSearchParams();
    if (historyFirm) params.set("firmCode", historyFirm);
    if (debouncedSearch) params.set("q", debouncedSearch);
    return fetch(`/api/delivery-challans?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => setHistory(Array.isArray(data?.challans) ? data.challans : []))
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, [historyFirm, debouncedSearch]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // ---- DC number preview. Re-read whenever the firm or date changes, since
  // the date decides which financial year's series the number comes from. ----
  useEffect(() => {
    localStorage.setItem("dc_last_firm", firmCode);
    let cancelled = false;
    // No firmCode is a valid request - the number then comes from the shared
    // no-firm series rather than a firm's own.
    const params = new URLSearchParams({ date });
    if (firmCode) params.set("firmCode", firmCode);
    fetch(`/api/delivery-challans/next-number?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setPreview(data?.success ? data : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [firmCode, date, issuedNumber]);

  // ---- Close the item picker on an outside click ----
  useEffect(() => {
    if (!pickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
        setManageMode(false);
        setRenamingId(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [pickerOpen]);

  const filteredMaster = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return masterItems;
    return masterItems.filter((it) => it.itemName.toLowerCase().includes(q));
  }, [masterItems, search]);

  const totalQty = useMemo(
    () => Number(lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0).toFixed(3)),
    [lines]
  );

  const selectedFirm = companies.find((c) => c.firmCode === firmCode);
  const isIssued = status === "finalized";
  const headerDcNo = isIssued ? issuedNumber : preview?.dcNumberFormatted || "--";

  // ---- Line editing ----
  const addLines = (items: { itemMasterId: string | null; itemName: string; qty: string; unit: string }[]) => {
    setLines((prev) => [...prev, ...items.map((it) => ({ key: nextLineKey(), ...it }))]);
  };

  const updateLine = (key: string, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  const addSelectedFromMaster = () => {
    const picked = masterItems.filter((it) => checked.has(it._id));
    if (picked.length === 0) return;
    addLines(
      picked.map((it) => ({
        itemMasterId: it._id,
        itemName: it.itemName,
        qty: "1", // sensible default, editable inline right after insert
        unit: it.unit || "",
      }))
    );
    setChecked(new Set());
    setSearch("");
    setPickerOpen(false);
  };

  // Saves the typed item into the master list AND drops it into the table -
  // the master entry is what makes the dropdown available from the second
  // challan onwards.
  const saveNewItem = async () => {
    const itemName = newItem.itemName.trim();
    const qty = Number(newItem.qty);
    if (!itemName) {
      setError("Item name is required.");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Qty must be a number greater than 0.");
      return;
    }
    setError("");

    try {
      const res = await fetch("/api/dc-item-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemName, unit: newItem.unit.trim(), createdBy: username }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't save the item.");

      addLines([
        {
          itemMasterId: data?.item?._id || null,
          itemName: data?.item?.itemName || itemName,
          qty: String(qty),
          unit: newItem.unit.trim(),
        },
      ]);
      setNewItem({ itemName: "", qty: "1", unit: "" });
      setShowNewItemForm(false);
      setPickerOpen(false);
      await loadMasterItems();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const renameMasterItem = async (id: string) => {
    const itemName = renameValue.trim();
    if (!itemName) return;
    try {
      const res = await fetch(`/api/dc-item-master/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Rename failed.");
      setRenamingId(null);
      setRenameValue("");
      await loadMasterItems();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const deleteMasterItem = async (item: MasterItem) => {
    if (!confirm(`Remove "${item.itemName}" from the item list? Challans that already used it are unaffected.`)) return;
    try {
      const res = await fetch(`/api/dc-item-master/${item._id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed.");
      setChecked((prev) => {
        const next = new Set(prev);
        next.delete(item._id);
        return next;
      });
      await loadMasterItems();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ---- Consignee ----
  const pickSeller = (sellerId: string) => {
    const seller = sellers.find((s) => s._id === sellerId);
    if (!seller) {
      setConsignee({ ...BLANK_CONSIGNEE });
      return;
    }
    setConsignee({
      sellerId,
      instituteName: seller.instituteName || "",
      buyerName: seller.buyerName || "",
      address: seller.address || "",
      place: seller.place || "",
      state: seller.state || "",
      mobile: seller.mobile || "",
    });
  };

  // ---- Save / finalize ----
  const buildPayload = () => ({
    firmCode,
    date,
    numberMode,
    remarks: remarks.trim(),
    consignee,
    items: lines.map((l) => ({
      itemMasterId: l.itemMasterId,
      itemName: l.itemName,
      qty: Number(l.qty),
      unit: l.unit,
    })),
    createdBy: username,
  });

  /** Persists the current form. Returns the challan id, so the callers that
   * need one (Generate PDF) can save first and act on the result. */
  const persist = async (): Promise<string | null> => {
    if (lines.length === 0) {
      setError("Add at least one item.");
      return null;
    }
    const badLine = lines.find((l) => !(Number(l.qty) > 0));
    if (badLine) {
      setError(`Qty for "${badLine.itemName}" must be greater than 0.`);
      return null;
    }
    setError("");

    const res = challanId
      ? await fetch(`/api/delivery-challans/${challanId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload()),
        })
      : await fetch("/api/delivery-challans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload()),
        });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Save failed.");
      return null;
    }

    const id = data.challanId || data.challan?._id || challanId;
    setChallanId(id);
    return id;
  };

  const saveDraft = async () => {
    setSaving(true);
    setNotice("");
    try {
      const id = await persist();
      if (id) {
        setNotice(isIssued ? "Changes saved." : "Draft saved.");
        await Promise.all([loadHistory(), loadMasterItems()]);
      }
    } catch (err: any) {
      setError(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const generatePdf = async () => {
    setGenerating(true);
    setNotice("");
    try {
      const id = await persist();
      if (!id) return;

      const res = await fetch(`/api/delivery-challans/${id}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numberMode,
          manualNumber: numberMode === "manual" ? Number(manualNumber) : undefined,
          finalizedBy: username,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Couldn't generate the challan.");
        return;
      }

      setStatus("finalized");
      setIssuedNumber(data.dcNumberFormatted);
      setNotice(`Delivery Challan ${data.dcNumberFormatted} generated.`);
      openPdfFromBase64(data.pdfBase64, `Delivery-Challan-${String(data.dcNumberFormatted).replace(/\//g, "-")}.pdf`);
      await Promise.all([loadHistory(), loadMasterItems()]);
    } catch (err: any) {
      setError(err.message || "Couldn't generate the challan.");
    } finally {
      setGenerating(false);
    }
  };

  const resetForm = () => {
    setChallanId(null);
    setStatus("draft");
    setIssuedNumber("");
    setLines([]);
    setRemarks("");
    setConsignee({ ...BLANK_CONSIGNEE });
    setConsigneeOpen(false);
    setNumberMode("auto");
    setManualNumber("");
    setDate(todayISO());
    setError("");
    setNotice("");
  };

  const openChallan = async (id: string) => {
    setBusyRowId(id);
    try {
      const res = await fetch(`/api/delivery-challans/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't open that challan.");
      const dc = data.challan;

      setChallanId(dc._id);
      setStatus(dc.status);
      setIssuedNumber(dc.dcNumberFormatted || "");
      setFirmCode(dc.firmCode);
      setDate(toDateInputValue(new Date(dc.date)));
      setNumberMode(dc.numberMode === "manual" ? "manual" : "auto");
      setManualNumber(dc.dcNumber ? String(dc.dcNumber) : "");
      setRemarks(dc.remarks || "");
      setConsignee({
        sellerId: dc.consignee?.sellerId ? String(dc.consignee.sellerId) : "",
        instituteName: dc.consignee?.instituteName || "",
        buyerName: dc.consignee?.buyerName || "",
        address: dc.consignee?.address || "",
        place: dc.consignee?.place || "",
        state: dc.consignee?.state || "",
        mobile: dc.consignee?.mobile || "",
      });
      setConsigneeOpen(Boolean(dc.consignee?.instituteName || dc.consignee?.buyerName || dc.consignee?.address));
      setLines(
        (dc.items || []).map((it: any) => ({
          key: nextLineKey(),
          itemMasterId: it.itemMasterId ? String(it.itemMasterId) : null,
          itemName: it.itemName,
          qty: String(it.qty),
          unit: it.unit || "",
        }))
      );
      setError("");
      setNotice(dc.status === "finalized" ? `Opened issued challan ${dc.dcNumberFormatted}.` : "Opened draft.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyRowId(null);
    }
  };

  // "Make a replica": pull an existing challan's item list into a BRAND NEW
  // draft, so a repeat dispatch doesn't have to be typed out line by line.
  //
  // Ship To is deliberately NOT carried over. A challan travels with the
  // goods, and silently inheriting the previous party is exactly how a
  // delivery gets booked to the wrong one - the copy exists to save retyping
  // the items, and the party is the field that is meant to change. The date
  // resets to today for the same reason.
  const copyChallan = async (id: string) => {
    setBusyRowId(id);
    try {
      const res = await fetch(`/api/delivery-challans/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't copy that challan.");
      const dc = data.challan;

      setChallanId(null); // a fresh record - never an edit of the one copied from
      setStatus("draft");
      setIssuedNumber("");
      setNumberMode("auto");
      setManualNumber("");
      setFirmCode(dc.firmCode || "");
      setDate(todayISO());
      setRemarks(dc.remarks || "");
      setConsignee({ ...BLANK_CONSIGNEE });
      setConsigneeOpen(true); // opened, since it's the one thing that must be filled in
      setLines(
        (dc.items || []).map((it: any) => ({
          key: nextLineKey(),
          itemMasterId: it.itemMasterId ? String(it.itemMasterId) : null,
          itemName: it.itemName,
          qty: String(it.qty),
          unit: it.unit || "",
        }))
      );
      setError("");
      const count = dc.items?.length || 0;
      setNotice(
        `Copied ${count} item${count === 1 ? "" : "s"} from ${dc.dcNumberFormatted || "a draft"} into a new challan. ` +
          `Set Ship To, change the qty, add any extra items — then Save Draft or Generate PDF.`
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyRowId(null);
    }
  };

  const deleteChallan = async (dc: ChallanSummary) => {
    if (!confirm(`Delete this ${dc.status === "draft" ? "draft" : "challan"}? This can't be undone.`)) return;
    setBusyRowId(dc._id);
    try {
      const res = await fetch(`/api/delivery-challans/${dc._id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed.");
      if (challanId === dc._id) resetForm();
      await loadHistory();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyRowId(null);
    }
  };

  const inputClass =
    "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400";

  return (
    <BlockGuard
      permission="deliveryChallan"
      fallback={
        <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center">
          <p className="text-red-500 font-bold uppercase">You have no Access for this Page.</p>
          <Link href="/dashboard" className="text-sm bg-slate-900 text-white px-4 py-2 mt-4 rounded-lg hover:bg-slate-800 transition-all">
            Go to Dashboard
          </Link>
        </div>
      }
    >
      <div className="p-4 md:p-10 max-w-6xl mx-auto">
        <Link href="/dashboard/orders" className="flex items-center gap-2 text-slate-500 hover:text-indigo-600 text-xs mb-3 transition-colors w-fit">
          <FiArrowLeft /> Back to Orders
        </Link>

        {/* ---- Header bar: title left, Date + DC No right ---- */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 md:p-6 flex flex-col md:flex-row md:items-start md:justify-between gap-5">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">Delivery Challan</h1>
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
              Dispatch document · no rate or amount
            </p>
            <div className="mt-4">
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                Firm <span className="text-slate-300 normal-case tracking-normal font-bold">(optional)</span>
              </label>
              <select
                value={firmCode}
                onChange={(e) => setFirmCode(e.target.value)}
                disabled={isIssued}
                className={`${inputClass} md:w-72 disabled:bg-slate-100 disabled:text-slate-500`}
              >
                <option value="">— No firm —</option>
                {companies.map((c) => (
                  <option key={c._id} value={c.firmCode}>
                    {c.firmName} ({c.firmCode})
                  </option>
                ))}
              </select>
              {isIssued ? (
                <p className="text-[10px] text-slate-400 mt-1">Locked — this challan is already issued.</p>
              ) : !firmCode ? (
                <p className="text-[10px] text-slate-400 mt-1">
                  No firm header will be printed on the challan.
                </p>
              ) : null}
            </div>
          </div>

          <div className="md:text-right md:min-w-[240px]">
            <div className="mb-3">
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={isIssued}
                className={`${inputClass} md:text-right disabled:bg-slate-100 disabled:text-slate-500`}
              />
            </div>

            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">DC No.</label>
            <div className="text-2xl font-black text-slate-900 tabular-nums">{headerDcNo}</div>
            {isIssued ? (
              <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide mt-1">Issued</p>
            ) : (
              <>
                <p className="text-[10px] text-slate-400 mt-1">
                  Provisional — the number is claimed when you generate the PDF.
                </p>
                <div className="flex md:justify-end items-center gap-3 mt-2">
                  <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 cursor-pointer">
                    <input type="radio" checked={numberMode === "auto"} onChange={() => setNumberMode("auto")} /> Auto
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 cursor-pointer">
                    <input type="radio" checked={numberMode === "manual"} onChange={() => setNumberMode("manual")} /> Manual
                  </label>
                </div>
                {numberMode === "manual" && (
                  <div className="mt-2 flex md:justify-end items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={manualNumber}
                      onChange={(e) => setManualNumber(e.target.value)}
                      placeholder={preview ? String(preview.nextSequence) : "1"}
                      className={`${inputClass} w-24 text-right`}
                    />
                    <span className="text-sm font-bold text-slate-500">/ {preview?.financialYear || "--"}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ---- Consignee (optional) ---- */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm mt-5">
          <button
            onClick={() => setConsigneeOpen((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 text-left"
          >
            <span className="text-xs font-black uppercase tracking-widest text-slate-500">
              Ship To / Consignee <span className="text-slate-300 font-bold normal-case tracking-normal">(optional)</span>
            </span>
            <span className="flex items-center gap-2 text-xs text-slate-400">
              {!consigneeOpen && (consignee.buyerName || consignee.instituteName) && (
                <span className="font-bold text-slate-600">{consignee.buyerName || consignee.instituteName}</span>
              )}
              <FiChevronDown className={`transition-transform ${consigneeOpen ? "rotate-180" : ""}`} />
            </span>
          </button>

          {consigneeOpen && (
            <div className="px-5 pb-5 border-t border-slate-100 pt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                  Pick from Sellers
                </label>
                <select value={consignee.sellerId} onChange={(e) => pickSeller(e.target.value)} className={inputClass}>
                  <option value="">— None / type manually below —</option>
                  {sellers.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.instituteName || s.buyerName || "(unnamed)"}
                      {s.place ? ` · ${s.place}` : ""}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  Picking one fills the fields below — you can still edit any of them for a one-off delivery address.
                </p>
              </div>
              <input
                value={consignee.instituteName}
                onChange={(e) => setConsignee({ ...consignee, instituteName: e.target.value })}
                placeholder="Institute / Company name"
                className={inputClass}
              />
              <input
                value={consignee.buyerName}
                onChange={(e) => setConsignee({ ...consignee, buyerName: e.target.value })}
                placeholder="Contact person"
                className={inputClass}
              />
              <input
                value={consignee.address}
                onChange={(e) => setConsignee({ ...consignee, address: e.target.value })}
                placeholder="Address"
                className={`${inputClass} md:col-span-2`}
              />
              <input
                value={consignee.place}
                onChange={(e) => setConsignee({ ...consignee, place: e.target.value })}
                placeholder="Place"
                className={inputClass}
              />
              <input
                value={consignee.mobile}
                onChange={(e) => setConsignee({ ...consignee, mobile: e.target.value })}
                placeholder="Mobile"
                className={inputClass}
              />
            </div>
          )}
        </div>

        {/* ---- Item entry ---- */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm mt-5 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-500">Items</h2>
            {masterItems.length > 0 && (
              <span className="text-[10px] text-slate-400 font-bold">{masterItems.length} in item list</span>
            )}
          </div>

          {masterItems.length === 0 && !showNewItemForm ? (
            // State A: nothing in the item list yet, so there's nothing to
            // search - the manual form IS the entry point, no dropdown shown.
            <NewItemForm
              value={newItem}
              onChange={setNewItem}
              onSave={saveNewItem}
              onCancel={null}
              inputClass={inputClass}
              hint="First item — it'll be saved to the item list, so next time you can just pick it from a dropdown."
            />
          ) : (
            <div className="flex flex-col md:flex-row gap-2 md:items-start">
              {/* State B: searchable multi-select over the item list */}
              <div className="relative flex-1" ref={pickerRef}>
                <button
                  onClick={() => setPickerOpen((v) => !v)}
                  className="w-full flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-2 text-sm text-left text-slate-500 hover:border-indigo-400 transition-colors"
                >
                  <FiSearch className="text-slate-400 shrink-0" />
                  {checked.size > 0 ? `${checked.size} item${checked.size === 1 ? "" : "s"} selected` : "Search & select items…"}
                </button>

                {pickerOpen && (
                  <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
                    <div className="p-2 border-b border-slate-100">
                      <input
                        autoFocus
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Type to filter…"
                        className={inputClass}
                      />
                    </div>

                    <div className="max-h-64 overflow-y-auto">
                      {filteredMaster.length === 0 ? (
                        <p className="px-4 py-6 text-center text-xs text-slate-400">
                          No item matches “{search}”. Use <b>+ Add New Item</b> below.
                        </p>
                      ) : (
                        filteredMaster.map((it) => (
                          <div key={it._id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 group">
                            {renamingId === it._id ? (
                              <>
                                <input
                                  autoFocus
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onKeyDown={(e) => e.key === "Enter" && renameMasterItem(it._id)}
                                  className="flex-1 border border-indigo-300 rounded px-2 py-1 text-sm"
                                />
                                <button onClick={() => renameMasterItem(it._id)} className="text-emerald-600 p-1" title="Save">
                                  <FiCheck size={14} />
                                </button>
                                <button onClick={() => setRenamingId(null)} className="text-slate-400 p-1" title="Cancel">
                                  <FiX size={14} />
                                </button>
                              </>
                            ) : (
                              <>
                                <label className="flex items-center gap-2 flex-1 cursor-pointer min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={checked.has(it._id)}
                                    onChange={(e) => {
                                      setChecked((prev) => {
                                        const next = new Set(prev);
                                        if (e.target.checked) next.add(it._id);
                                        else next.delete(it._id);
                                        return next;
                                      });
                                    }}
                                    className="shrink-0"
                                  />
                                  <span className="text-sm text-slate-700 truncate">{it.itemName}</span>
                                  {it.unit && <span className="text-[10px] text-slate-400 shrink-0">{it.unit}</span>}
                                </label>
                                {manageMode && (
                                  <>
                                    <button
                                      onClick={() => {
                                        setRenamingId(it._id);
                                        setRenameValue(it.itemName);
                                      }}
                                      className="text-slate-400 hover:text-indigo-600 p-1"
                                      title="Rename"
                                    >
                                      <FiEdit2 size={13} />
                                    </button>
                                    <button
                                      onClick={() => deleteMasterItem(it)}
                                      className="text-slate-400 hover:text-red-600 p-1"
                                      title="Remove from list"
                                    >
                                      <FiTrash2 size={13} />
                                    </button>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        ))
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 p-2 border-t border-slate-100 bg-slate-50">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setShowNewItemForm(true);
                            setPickerOpen(false);
                          }}
                          className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                        >
                          <FiPlus size={13} /> Add New Item
                        </button>
                        <button
                          onClick={() => {
                            setManageMode((v) => !v);
                            setRenamingId(null);
                          }}
                          className={`text-xs font-bold ${manageMode ? "text-slate-800" : "text-slate-400"} hover:text-slate-700`}
                        >
                          {manageMode ? "Done" : "Edit list"}
                        </button>
                      </div>
                      <button
                        onClick={addSelectedFromMaster}
                        disabled={checked.size === 0}
                        className="bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg disabled:bg-slate-300 hover:bg-indigo-700 transition-colors"
                      >
                        Add Selected {checked.size > 0 ? `(${checked.size})` : ""}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={() => setShowNewItemForm((v) => !v)}
                className="flex items-center justify-center gap-1.5 border border-dashed border-slate-300 text-slate-600 hover:border-indigo-400 hover:text-indigo-600 rounded-lg px-4 py-2 text-sm font-bold transition-colors shrink-0"
              >
                <FiPlus size={14} /> Add New Item
              </button>
            </div>
          )}

          {showNewItemForm && masterItems.length > 0 && (
            <div className="mt-3">
              <NewItemForm
                value={newItem}
                onChange={setNewItem}
                onSave={saveNewItem}
                onCancel={() => setShowNewItemForm(false)}
                inputClass={inputClass}
                hint="Saved to the item list too, so it's in the dropdown next time."
              />
            </div>
          )}

          {/* ---- Items table ---- */}
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-600">
                  <th className="text-left font-black uppercase text-[10px] tracking-widest px-3 py-2 w-16">Sr. No.</th>
                  <th className="text-left font-black uppercase text-[10px] tracking-widest px-3 py-2">Item Name</th>
                  <th className="text-left font-black uppercase text-[10px] tracking-widest px-3 py-2 w-32">Qty</th>
                  <th className="text-left font-black uppercase text-[10px] tracking-widest px-3 py-2 w-36">Unit</th>
                  <th className="px-3 py-2 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-slate-400 text-xs py-8">
                      No items yet — add them above.
                    </td>
                  </tr>
                ) : (
                  lines.map((l, i) => (
                    <tr key={l.key} className="border-b border-slate-100">
                      {/* Sr. No. is positional, so it renumbers itself on every add, remove or reorder */}
                      <td className="px-3 py-1.5 text-slate-500 tabular-nums">{i + 1}</td>
                      <td className="px-3 py-1.5">
                        <input
                          value={l.itemName}
                          onChange={(e) => updateLine(l.key, { itemName: e.target.value })}
                          className="w-full bg-transparent border border-transparent hover:border-slate-200 focus:border-indigo-400 rounded px-2 py-1 focus:outline-none"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={l.qty}
                          onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                          className="w-full border border-slate-200 focus:border-indigo-400 rounded px-2 py-1 text-right focus:outline-none"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          list="dc-units"
                          value={l.unit}
                          onChange={(e) => updateLine(l.key, { unit: e.target.value })}
                          placeholder="—"
                          className="w-full border border-slate-200 focus:border-indigo-400 rounded px-2 py-1 focus:outline-none"
                        />
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <button
                          onClick={() => removeLine(l.key)}
                          className="text-slate-300 hover:text-red-600 transition-colors"
                          title="Remove row"
                        >
                          <FiTrash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {lines.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-50 font-black text-slate-700">
                    <td className="px-3 py-2" colSpan={2}>
                      Total — {lines.length} item{lines.length === 1 ? "" : "s"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{totalQty}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              )}
            </table>
            <datalist id="dc-units">
              {units.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>

          <div className="mt-4">
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Remarks</label>
            <input
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional note printed under the item table"
              className={inputClass}
            />
          </div>
        </div>

        {/* ---- Messages + actions ---- */}
        {error && (
          <div className="mt-4 border border-red-200 bg-red-50 text-red-700 text-sm rounded-xl px-4 py-3 flex items-start justify-between gap-3">
            <span>{error}</span>
            <button onClick={() => setError("")} className="text-red-400 hover:text-red-700 shrink-0">
              <FiX size={16} />
            </button>
          </div>
        )}
        {notice && !error && (
          <div className="mt-4 border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm rounded-xl px-4 py-3 flex items-start justify-between gap-3">
            <span>{notice}</span>
            <button onClick={() => setNotice("")} className="text-emerald-400 hover:text-emerald-700 shrink-0">
              <FiX size={16} />
            </button>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            onClick={saveDraft}
            disabled={saving || generating || lines.length === 0}
            className="flex items-center gap-2 bg-slate-800 text-white text-sm font-bold px-5 py-2.5 rounded-xl hover:bg-slate-900 disabled:bg-slate-300 transition-colors"
          >
            <FiSave size={15} /> {saving ? "Saving…" : isIssued ? "Save Changes" : "Save Draft"}
          </button>
          <button
            onClick={generatePdf}
            disabled={saving || generating || lines.length === 0}
            className="flex items-center gap-2 bg-indigo-600 text-white text-sm font-bold px-5 py-2.5 rounded-xl hover:bg-indigo-700 disabled:bg-slate-300 transition-colors"
          >
            <FiFileText size={15} /> {generating ? "Generating…" : isIssued ? "Regenerate PDF" : "Generate PDF"}
          </button>
          {(challanId || lines.length > 0) && (
            <button
              onClick={resetForm}
              className="flex items-center gap-2 text-slate-500 hover:text-slate-800 text-sm font-bold px-3 py-2.5"
            >
              <FiRefreshCw size={14} /> New Challan
            </button>
          )}
          <span className="text-[11px] text-slate-400 ml-auto">
            {selectedFirm ? selectedFirm.firmName : "No firm"} · FY {preview?.financialYear || "--"}
          </span>
        </div>

        {/* ---- History ---- */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm mt-8 p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-500">Saved Challans</h2>
            <div className="flex flex-wrap items-center gap-2">
              <select value={historyFirm} onChange={(e) => setHistoryFirm(e.target.value)} className={`${inputClass} w-auto`}>
                <option value="">All firms</option>
                {companies.map((c) => (
                  <option key={c._id} value={c.firmCode}>
                    {c.firmCode}
                  </option>
                ))}
              </select>
              <input
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search DC no, party, item…"
                className={`${inputClass} w-auto`}
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-600">
                  <th className="text-left font-black uppercase text-[10px] tracking-widest px-3 py-2">DC No.</th>
                  <th className="text-left font-black uppercase text-[10px] tracking-widest px-3 py-2">Date</th>
                  <th className="text-left font-black uppercase text-[10px] tracking-widest px-3 py-2">Firm</th>
                  <th className="text-left font-black uppercase text-[10px] tracking-widest px-3 py-2">Ship To</th>
                  <th className="text-right font-black uppercase text-[10px] tracking-widest px-3 py-2">Items</th>
                  <th className="text-right font-black uppercase text-[10px] tracking-widest px-3 py-2">Total Qty</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {loadingHistory ? (
                  <tr>
                    <td colSpan={7} className="text-center text-slate-400 text-xs py-8">
                      Loading…
                    </td>
                  </tr>
                ) : history.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center text-slate-400 text-xs py-8">
                      Nothing saved yet.
                    </td>
                  </tr>
                ) : (
                  history.map((dc) => (
                    <tr key={dc._id} className={`border-b border-slate-100 ${challanId === dc._id ? "bg-indigo-50/60" : ""}`}>
                      <td className="px-3 py-2 font-bold text-slate-800 tabular-nums whitespace-nowrap">
                        {dc.dcNumberFormatted || <span className="text-amber-600 font-bold text-xs">DRAFT</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{formatDateDDMMYYYY(dc.date)}</td>
                      <td className="px-3 py-2 text-slate-600">{dc.firmCode || <span className="text-slate-300">—</span>}</td>
                      <td className="px-3 py-2 text-slate-600 max-w-[220px] truncate">
                        {dc.consignee?.buyerName || dc.consignee?.instituteName || "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600 tabular-nums">{dc.items?.length || 0}</td>
                      <td className="px-3 py-2 text-right text-slate-600 tabular-nums">{dc.totalQty}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openChallan(dc._id)}
                            disabled={busyRowId === dc._id}
                            className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 px-2 py-1 disabled:text-slate-300"
                          >
                            Open
                          </button>
                          <button
                            onClick={() => copyChallan(dc._id)}
                            disabled={busyRowId === dc._id}
                            className="text-[11px] font-bold text-teal-600 hover:text-teal-800 px-2 py-1 disabled:text-slate-300 flex items-center gap-1"
                            title="Start a new challan with these same items"
                          >
                            <FiCopy size={12} /> Copy
                          </button>
                          {dc.status === "finalized" && (
                            <a
                              href={`/api/delivery-challans/${dc._id}/pdf`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-slate-400 hover:text-slate-700 p-1"
                              title="Download PDF"
                            >
                              <FiDownload size={14} />
                            </a>
                          )}
                          {dc.status === "draft" && (
                            <button
                              onClick={() => deleteChallan(dc)}
                              disabled={busyRowId === dc._id}
                              className="text-slate-300 hover:text-red-600 p-1 disabled:text-slate-200"
                              title="Delete draft"
                            >
                              <FiTrash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </BlockGuard>
  );
}

/** The manual "Add Item" form. It's the only entry point while the item list
 * is empty, and stays available afterwards via "+ Add New Item" for anything
 * not in the list yet. */
function NewItemForm({
  value,
  onChange,
  onSave,
  onCancel,
  inputClass,
  hint,
}: {
  value: { itemName: string; qty: string; unit: string };
  onChange: (v: { itemName: string; qty: string; unit: string }) => void;
  onSave: () => void;
  onCancel: (() => void) | null;
  inputClass: string;
  hint: string;
}) {
  return (
    <div className="border border-dashed border-indigo-200 bg-indigo-50/40 rounded-xl p-4">
      <div className="flex flex-col md:flex-row gap-2">
        <input
          value={value.itemName}
          onChange={(e) => onChange({ ...value, itemName: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && onSave()}
          placeholder="Item name"
          className={`${inputClass} flex-1`}
        />
        <input
          type="number"
          min={0}
          step="any"
          value={value.qty}
          onChange={(e) => onChange({ ...value, qty: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && onSave()}
          placeholder="Qty"
          className={`${inputClass} md:w-28 text-right`}
        />
        <input
          list="dc-units"
          value={value.unit}
          onChange={(e) => onChange({ ...value, unit: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && onSave()}
          placeholder="Unit"
          className={`${inputClass} md:w-32`}
        />
        <button
          onClick={onSave}
          className="flex items-center justify-center gap-1.5 bg-indigo-600 text-white text-sm font-bold px-5 py-2 rounded-lg hover:bg-indigo-700 transition-colors shrink-0"
        >
          <FiPlus size={14} /> Add
        </button>
        {onCancel && (
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-700 px-2 shrink-0" title="Cancel">
            <FiX size={18} />
          </button>
        )}
      </div>
      <p className="text-[10px] text-slate-500 mt-2">{hint}</p>
    </div>
  );
}
