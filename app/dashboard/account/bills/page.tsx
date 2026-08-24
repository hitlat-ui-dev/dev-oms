"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FiArrowLeft, FiPrinter, FiCheckCircle, FiDownload, FiFileText,
  FiChevronRight, FiX, FiCalendar, FiRefreshCw, FiUpload, FiSearch,
} from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import { submitBillToGem, retryGemDocumentFetch } from "@/lib/triggerGemSubmit";

interface Company {
  _id: string;
  firmName: string;
  firmCode: string;
  state?: string;
  gstin?: string | null;
  pan?: string | null;
  isCompositionDealer?: boolean;
  invoiceNumbering?: { prefix?: string };
}

interface EligibleOrderLine {
  _id: string;
  itemId?: string;
  itemName: string;
  sku?: string;
  unit?: string;
  reQty: number;
  rate: number;
  totalAmount: number;
  hsnSac?: string;
  gstPercent?: number;
  billExemptReason?: string;
  billExemptNote?: string;
  billExemptAt?: string;
  billExemptBy?: string;
}

interface EligibleGroup {
  contractNo: string;
  contractDate?: string;
  sellerId?: string;
  instituteName: string;
  buyerState?: string;
  orders: EligibleOrderLine[];
}

interface Bill {
  _id: string;
  invoiceNumber: string;
  invoiceDate: string;
  billType: "TAX_INVOICE" | "BILL_OF_SUPPLY";
  gstSplit: string;
  contractNo: string;
  contractDate?: string; // DD/MM/YYYY - looked up server-side from the seller order, not stored on the Bill doc
  buyerSnapshot: { instituteName: string; state?: string };
  items: { qty: number; hsnSac?: string; gstPercent?: number }[];
  grandTotal: number;
  gemDocumentR2Key?: string;
  cancelled?: boolean;
}

// qty * rate frequently lands on a repeating binary fraction (e.g. 15.29 *
// 65 -> 993.8499999999999) - every money value gets rounded through this
// before display, not just the ones that happened to look wrong.
function fmt2(n: number | undefined | null): string {
  return (Number(n) || 0).toFixed(2);
}

function formatDateDDMMYYYY(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

interface LineOverride {
  hsnSac: string;
  gstPercent: number;
  discount: number;
}

function billTypeFor(company: Company | undefined): "TAX_INVOICE" | "BILL_OF_SUPPLY" {
  if (!company) return "BILL_OF_SUPPLY";
  if (!company.gstin) return "BILL_OF_SUPPLY";
  if (company.isCompositionDealer) return "BILL_OF_SUPPLY";
  return "TAX_INVOICE";
}

function gstSplitFor(company: Company | undefined, buyerState?: string): "CGST_SGST" | "IGST" | "UNKNOWN" {
  if (!company?.state || !buyerState) return "UNKNOWN";
  return company.state.trim().toLowerCase() === buyerState.trim().toLowerCase() ? "CGST_SGST" : "IGST";
}

export default function GenerateBillPage() {
  const router = useRouter();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [firmCode, setFirmCode] = useState("");
  const [groups, setGroups] = useState<EligibleGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [selectedContract, setSelectedContract] = useState<EligibleGroup | null>(null);
  const [overrides, setOverrides] = useState<Record<string, LineOverride>>({});
  const [numberMode, setNumberMode] = useState<"auto" | "manual">("auto");
  const [manualNumber, setManualNumber] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    invoiceNumber: string; pdfBase64: string; billId: string; contractNo: string;
    contractDate?: string; buyerState?: string;
    items: { qty: number; hsnSac?: string; gstPercent?: number }[];
  } | null>(null);
  const [submittingToGem, setSubmittingToGem] = useState(false);
  const [gemSubmitStatus, setGemSubmitStatus] = useState("");
  const [historySubmittingId, setHistorySubmittingId] = useState<string | null>(null);
  const [historyStatus, setHistoryStatus] = useState<Record<string, string>>({});
  const [retryingDocId, setRetryingDocId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [cancellingBillId, setCancellingBillId] = useState<string | null>(null);

  const [showZipExportModal, setShowZipExportModal] = useState(false);
  const [zipFirmCode, setZipFirmCode] = useState("");
  const [zipInstituteName, setZipInstituteName] = useState("");
  const [zipDateFrom, setZipDateFrom] = useState("");
  const [zipDateTo, setZipDateTo] = useState("");
  const [zipExporting, setZipExporting] = useState(false);
  const [zipExportError, setZipExportError] = useState("");

  const [bills, setBills] = useState<Bill[]>([]);
  const [exportDate, setExportDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [exporting, setExporting] = useState(false);
  const [billHistoryDateFrom, setBillHistoryDateFrom] = useState("");
  const [billHistoryDateTo, setBillHistoryDateTo] = useState("");
  const [invoiceRangeFrom, setInvoiceRangeFrom] = useState("");
  const [invoiceRangeTo, setInvoiceRangeTo] = useState("");
  const [billHistorySearchQuery, setBillHistorySearchQuery] = useState("");

  // Contracts that will never get a real Bill: already invoiced outside OMS
  // (e.g. directly in Miracle, before this feature existed) or genuinely not
  // needed. Selected via checkboxes on the Un-billed Contracts list below.
  //
  // Keyed by "group key" (contractNo, or the first order's _id when
  // contractNo is blank - several un-linked orders can share a blank
  // contractNo, so that alone can't identify one group) - never by contractNo
  // alone, and the API call itself is always by order _id, not contractNo,
  // for the same reason.
  const groupKey = (g: EligibleGroup) => g.contractNo || g.orders[0]?._id || "";

  const [selectedGroupKeys, setSelectedGroupKeys] = useState<Set<string>>(new Set());
  const [exemptPanelOpen, setExemptPanelOpen] = useState(false);
  const [exemptReason, setExemptReason] = useState<"ALREADY_BILLED_EXTERNAL" | "NOT_REQUIRED">("ALREADY_BILLED_EXTERNAL");
  const [exemptNote, setExemptNote] = useState("");
  const [exempting, setExempting] = useState(false);
  const [showExempted, setShowExempted] = useState(false);
  const [exemptedGroups, setExemptedGroups] = useState<EligibleGroup[]>([]);
  const [loadingExempted, setLoadingExempted] = useState(false);
  const [unExempting, setUnExempting] = useState<string | null>(null);
  const [contractDateFrom, setContractDateFrom] = useState("");
  const [contractDateTo, setContractDateTo] = useState("");
  const [contractSearchQuery, setContractSearchQuery] = useState("");

  // Advances OMS's own auto-increment counter to match a number already
  // issued outside OMS (offline sale billed directly in Miracle, sharing the
  // same numbering series) - no order or Bill gets created, this only moves
  // the counter so OMS's next auto-generated number doesn't collide.
  const [registerNumbersInput, setRegisterNumbersInput] = useState("");
  const [registering, setRegistering] = useState(false);
  const [registerResult, setRegisterResult] = useState<{ ok: boolean; message: string } | null>(null);

  const company = useMemo(() => companies.find((c) => c.firmCode === firmCode), [companies, firmCode]);

  const submitRegisterNumbers = async () => {
    if (!firmCode || !registerNumbersInput.trim()) return;
    setRegistering(true);
    setRegisterResult(null);
    try {
      const res = await fetch("/api/bills/register-number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firmCode, numbers: registerNumbersInput.trim(), registeredBy: currentUsername() }),
      });
      const data = await res.json();
      if (res.ok) {
        setRegisterResult({ ok: true, message: data.message });
        setRegisterNumbersInput("");
      } else {
        setRegisterResult({ ok: false, message: data.error || "Failed to register." });
      }
    } catch {
      setRegisterResult({ ok: false, message: "Network error while registering." });
    } finally {
      setRegistering(false);
    }
  };

  // contractDate is stored "DD/MM/YYYY" (as scraped off GeM) - parse for
  // range comparison against the <input type="date"> (YYYY-MM-DD) filters.
  const parseContractDate = (ddmmyyyy?: string): Date | null => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((ddmmyyyy || "").trim());
    if (!m) return null;
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  };

  const filteredGroups = useMemo(() => {
    let result = groups;

    if (contractDateFrom || contractDateTo) {
      const from = contractDateFrom ? new Date(contractDateFrom) : null;
      const to = contractDateTo ? new Date(contractDateTo) : null;
      result = result.filter((g) => {
        const d = parseContractDate(g.contractDate);
        if (!d) return false; // no parseable date - excluded once a range filter is active
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }

    const q = contractSearchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((g) => {
        if (g.contractNo?.toLowerCase().includes(q)) return true;
        if (g.instituteName?.toLowerCase().includes(q)) return true;
        return g.orders.some((o) =>
          o.itemName?.toLowerCase().includes(q) || String(o.totalAmount ?? "").includes(q)
        );
      });
    }

    return result;
  }, [groups, contractDateFrom, contractDateTo, contractSearchQuery]);

  // Same date-range/search filter as the un-billed list above, applied to the
  // exempted list too - the search box only ever filtered "still needs a
  // bill" contracts, so searching a contract that had already been marked
  // exempt correctly found nothing there, but the Exempted Contracts panel
  // below it wasn't filtered at all, so it looked like the search just
  // didn't work for that contract.
  const filteredExemptedGroups = useMemo(() => {
    let result = exemptedGroups;

    if (contractDateFrom || contractDateTo) {
      const from = contractDateFrom ? new Date(contractDateFrom) : null;
      const to = contractDateTo ? new Date(contractDateTo) : null;
      result = result.filter((g) => {
        const d = parseContractDate(g.contractDate);
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }

    const q = contractSearchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((g) => {
        if (g.contractNo?.toLowerCase().includes(q)) return true;
        if (g.instituteName?.toLowerCase().includes(q)) return true;
        return g.orders.some((o) =>
          o.itemName?.toLowerCase().includes(q) || String(o.totalAmount ?? "").includes(q)
        );
      });
    }

    return result;
  }, [exemptedGroups, contractDateFrom, contractDateTo, contractSearchQuery]);

  // The list can run into the hundreds for an old firm - show 20 at a time
  // instead of dumping everything on screen at once.
  const PAGE_SIZE = 20;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => setVisibleCount(PAGE_SIZE), [firmCode, contractDateFrom, contractDateTo, contractSearchQuery]);
  const visibleGroups = useMemo(() => filteredGroups.slice(0, visibleCount), [filteredGroups, visibleCount]);

  // Invoice numbers are "<prefix><number>" (e.g. "SM14") - pull the trailing
  // digits out so a from/to range can be compared numerically regardless of
  // whether the user typed the prefix or just the number.
  const extractNumericSuffix = (s: string): number | null => {
    const m = /(\d+)\s*$/.exec(String(s || ""));
    return m ? parseInt(m[1], 10) : null;
  };

  const filteredBills = useMemo(() => {
    let result = bills;

    if (billHistoryDateFrom || billHistoryDateTo) {
      const from = billHistoryDateFrom ? new Date(`${billHistoryDateFrom}T00:00:00`) : null;
      const to = billHistoryDateTo ? new Date(`${billHistoryDateTo}T23:59:59`) : null;
      result = result.filter((b) => {
        const d = new Date(b.invoiceDate);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }

    if (invoiceRangeFrom || invoiceRangeTo) {
      const fromNum = invoiceRangeFrom ? extractNumericSuffix(invoiceRangeFrom) : null;
      const toNum = invoiceRangeTo ? extractNumericSuffix(invoiceRangeTo) : null;
      result = result.filter((b) => {
        const n = extractNumericSuffix(b.invoiceNumber);
        if (n === null) return false;
        if (fromNum !== null && n < fromNum) return false;
        if (toNum !== null && n > toNum) return false;
        return true;
      });
    }

    const q = billHistorySearchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((b) =>
        b.invoiceNumber?.toLowerCase().includes(q) ||
        b.contractNo?.toLowerCase().includes(q) ||
        b.buyerSnapshot?.instituteName?.toLowerCase().includes(q) ||
        String(b.grandTotal ?? "").includes(q)
      );
    }

    return result;
  }, [bills, billHistoryDateFrom, billHistoryDateTo, invoiceRangeFrom, invoiceRangeTo, billHistorySearchQuery]);

  const billHistoryFiltersActive =
    billHistoryDateFrom || billHistoryDateTo || invoiceRangeFrom || invoiceRangeTo || billHistorySearchQuery;

  // Bill History can run into the hundreds for an old firm - show 15 at a
  // time instead of dumping everything on screen at once.
  const BILL_PAGE_SIZE = 15;
  const [visibleBillCount, setVisibleBillCount] = useState(BILL_PAGE_SIZE);
  useEffect(() => setVisibleBillCount(BILL_PAGE_SIZE), [
    firmCode, billHistoryDateFrom, billHistoryDateTo, invoiceRangeFrom, invoiceRangeTo, billHistorySearchQuery,
  ]);
  const visibleBills = useMemo(() => filteredBills.slice(0, visibleBillCount), [filteredBills, visibleBillCount]);

  const currentUsername = (): string => {
    try {
      const stored = localStorage.getItem("oms_user");
      if (stored) return JSON.parse(stored)?.username || "";
    } catch { /* ignore */ }
    return "";
  };

  const fetchExempted = async (fc: string) => {
    setLoadingExempted(true);
    try {
      const res = await fetch(`/api/bills/eligible-orders?firmCode=${encodeURIComponent(fc)}&exempted=true`);
      const data = await res.json();
      if (Array.isArray(data)) setExemptedGroups(data);
    } catch {
      /* review panel is a convenience, fail silently */
    } finally {
      setLoadingExempted(false);
    }
  };

  const toggleContractSelected = (key: string) => {
    setSelectedGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // "Select all" only covers what's currently loaded on screen - selecting
  // hundreds of unseen contracts from a single click would be surprising.
  const toggleSelectAllContracts = () => {
    setSelectedGroupKeys((prev) =>
      prev.size === visibleGroups.length ? new Set() : new Set(visibleGroups.map(groupKey))
    );
  };

  const submitExemption = async () => {
    if (!firmCode || selectedGroupKeys.size === 0) return;
    const orderIds = filteredGroups
      .filter((g) => selectedGroupKeys.has(groupKey(g)))
      .flatMap((g) => g.orders.map((o) => o._id));
    if (orderIds.length === 0) return;

    setExempting(true);
    try {
      const res = await fetch("/api/bills/exempt-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firmCode,
          orderIds,
          reason: exemptReason,
          note: exemptNote.trim(),
          exemptBy: currentUsername(),
        }),
      });
      if (res.ok) {
        setSelectedGroupKeys(new Set());
        setExemptPanelOpen(false);
        setExemptNote("");
        fetchGroups(firmCode);
        if (showExempted) fetchExempted(firmCode);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to mark as exempt.");
      }
    } catch {
      setError("Network error while marking as exempt.");
    } finally {
      setExempting(false);
    }
  };

  const undoExemption = async (g: EligibleGroup) => {
    if (!firmCode) return;
    const key = groupKey(g);
    setUnExempting(key);
    try {
      const res = await fetch("/api/bills/exempt-orders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firmCode, orderIds: g.orders.map((o) => o._id) }),
      });
      if (res.ok) {
        fetchExempted(firmCode);
        fetchGroups(firmCode);
      }
    } finally {
      setUnExempting(null);
    }
  };

  useEffect(() => {
    fetch("/api/companies").then((r) => r.json()).then((d) => Array.isArray(d) && setCompanies(d));
  }, []);

  const fetchGroups = async (fc: string) => {
    setLoadingGroups(true);
    setSelectedContract(null);
    setResult(null);
    try {
      const res = await fetch(`/api/bills/eligible-orders?firmCode=${encodeURIComponent(fc)}`);
      const data = await res.json();
      if (Array.isArray(data)) setGroups(data);
    } catch {
      setError("Failed to load un-billed orders.");
    } finally {
      setLoadingGroups(false);
    }
  };

  const fetchBills = async (fc: string) => {
    try {
      const res = await fetch(`/api/bills?firmCode=${encodeURIComponent(fc)}`);
      const data = await res.json();
      if (Array.isArray(data)) setBills(data);
    } catch {
      /* history is a convenience, fail silently */
    }
  };

  // Re-fetches everything currently on screen (un-billed contracts, bill
  // history, exempted list if open, and the firm dropdown) without a full
  // page reload - lets the user pull in orders/bills someone else just
  // created elsewhere instead of hitting F5 and losing their place.
  const [refreshingAll, setRefreshingAll] = useState(false);
  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    try {
      const tasks: Promise<any>[] = [
        fetch("/api/companies").then((r) => r.json()).then((d) => Array.isArray(d) && setCompanies(d)),
      ];
      if (firmCode) {
        tasks.push(fetchGroups(firmCode));
        tasks.push(fetchBills(firmCode));
        if (showExempted) tasks.push(fetchExempted(firmCode));
      }
      await Promise.all(tasks);
    } finally {
      setRefreshingAll(false);
    }
  };

  useEffect(() => {
    setSelectedGroupKeys(new Set());
    setExemptPanelOpen(false);
    setShowExempted(false);
    setExemptedGroups([]);
    setContractDateFrom("");
    setContractDateTo("");
    if (firmCode) {
      fetchGroups(firmCode);
      fetchBills(firmCode);
    } else {
      setGroups([]);
      setBills([]);
    }
  }, [firmCode]);

  const selectContract = (g: EligibleGroup) => {
    setSelectedContract(g);
    setResult(null);
    setError("");
    const initial: Record<string, LineOverride> = {};
    g.orders.forEach((o) => {
      initial[o._id] = { hsnSac: o.hsnSac || "", gstPercent: o.gstPercent || 0, discount: 0 };
    });
    setOverrides(initial);
  };

  const updateOverride = (orderId: string, field: keyof LineOverride, value: string) => {
    setOverrides((prev) => ({
      ...prev,
      [orderId]: {
        ...prev[orderId],
        [field]: field === "hsnSac" ? value : Number(value) || 0,
      },
    }));
  };

  const isTaxInvoice = billTypeFor(company) === "TAX_INVOICE";
  const gstSplit = gstSplitFor(company, selectedContract?.buyerState);

  const preview = useMemo(() => {
    if (!selectedContract) return null;
    let subTotal = 0;
    let totalDiscount = 0;
    let totalGst = 0;
    for (const o of selectedContract.orders) {
      const ov = overrides[o._id] || { hsnSac: "", gstPercent: 0, discount: 0 };
      const gross = o.reQty * o.rate;
      const taxable = gross - (ov.discount || 0);
      const gst = isTaxInvoice ? (taxable * (ov.gstPercent || 0)) / 100 : 0;
      subTotal += taxable;
      totalDiscount += ov.discount || 0;
      totalGst += gst;
    }
    return { subTotal, totalDiscount, totalGst, grandTotal: subTotal + totalGst };
  }, [selectedContract, overrides, isTaxInvoice]);

  const handleGenerate = async () => {
    if (!selectedContract || !company) return;
    if (numberMode === "manual" && !manualNumber.trim()) {
      setError("Enter the manual invoice number.");
      return;
    }
    setGenerating(true);
    setError("");
    try {
      let currentUsername = "";
      try {
        const stored = localStorage.getItem("oms_user");
        if (stored) currentUsername = JSON.parse(stored)?.username || "";
      } catch { /* ignore */ }

      const res = await fetch("/api/bills/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firmCode: company.firmCode,
          contractNo: selectedContract.contractNo,
          numberMode,
          manualNumber: numberMode === "manual" ? manualNumber.trim() : undefined,
          createdBy: currentUsername,
          lineOverrides: selectedContract.orders.map((o) => ({
            sellerOrderId: o._id,
            hsnSac: overrides[o._id]?.hsnSac || "",
            gstPercent: overrides[o._id]?.gstPercent || 0,
            discount: overrides[o._id]?.discount || 0,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to generate bill.");
        return;
      }
      setResult({
        invoiceNumber: data.invoiceNumber,
        pdfBase64: data.pdfBase64,
        billId: data.billId,
        contractNo: selectedContract.contractNo,
        contractDate: selectedContract.contractDate,
        buyerState: selectedContract.buyerState,
        items: selectedContract.orders.map((o) => ({
          qty: o.reQty,
          hsnSac: overrides[o._id]?.hsnSac,
          gstPercent: overrides[o._id]?.gstPercent,
        })),
      });
      setGemSubmitStatus("");
      setSelectedContract(null);
      setManualNumber("");
      fetchGroups(firmCode);
      fetchBills(firmCode);
    } catch (err) {
      setError("Network error while generating bill.");
    } finally {
      setGenerating(false);
    }
  };

  const openPdfFromBase64 = (base64: string) => {
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    const blob = new Blob([new Uint8Array(byteNumbers)], { type: "application/pdf" });
    window.open(URL.createObjectURL(blob), "_blank");
  };

  // GeM OTP Gmail account now comes from the logged-in user's own GeM Login
  // Setup entry for this firm (gemMailId) - not Company Setup's
  // gmailAccountEmail, which used to be one shared value for the whole
  // team. Same account works for both this (bill e-verify) and the GeM
  // Login Setup page's own "Login" button, since the extension links/stores
  // Gmail tokens by email now, not by firm.
  const fetchGemMailId = async (firmCode: string): Promise<string | undefined> => {
    try {
      const res = await fetch(`/api/gem-credentials?username=${encodeURIComponent(currentUsername())}`);
      const data = await res.json();
      if (!Array.isArray(data)) return undefined;
      return data.find((c: any) => c.firmCode === firmCode)?.gemMailId || undefined;
    } catch {
      return undefined;
    }
  };

  const handleSubmitToGem = async () => {
    if (!result || !company) return;
    setSubmittingToGem(true);
    setGemSubmitStatus("");
    try {
      const gemMailId = await fetchGemMailId(company.firmCode);
      await submitBillToGem({
        firmCode: company.firmCode,
        billType: billTypeFor(company),
        contractNo: result.contractNo,
        contractDate: result.contractDate,
        buyerState: result.buyerState,
        billId: result.billId,
        billNo: result.invoiceNumber,
        billPdfUrl: `${window.location.origin}/api/bills/${result.billId}/pdf`,
        firmName: company.firmName,
        gmailAccountEmail: gemMailId,
        items: result.items,
      });
      setGemSubmitStatus("GeM tab khul gaya — extension automation shuru ho gayi.");
    } catch (err: any) {
      setGemSubmitStatus(`Extension trigger nahi hua: ${err.message}`);
    } finally {
      setSubmittingToGem(false);
    }
  };

  // Same as handleSubmitToGem, but usable from any Bill History row - not
  // just the just-generated one, since that success banner disappears on
  // navigation/refresh. contractDate falls back to the bill's own
  // invoiceDate (the actual contract date isn't stored on the Bill record).
  const handleSubmitToGemFromHistory = async (bill: Bill) => {
    if (!company) return;
    setHistorySubmittingId(bill._id);
    setHistoryStatus((prev) => ({ ...prev, [bill._id]: "" }));
    try {
      const gemMailId = await fetchGemMailId(company.firmCode);
      await submitBillToGem({
        firmCode: company.firmCode,
        billType: bill.billType,
        contractNo: bill.contractNo,
        contractDate: bill.contractDate || formatDateDDMMYYYY(bill.invoiceDate),
        buyerState: bill.buyerSnapshot.state,
        billId: bill._id,
        billNo: bill.invoiceNumber,
        billPdfUrl: `${window.location.origin}/api/bills/${bill._id}/pdf`,
        firmName: company.firmName,
        gmailAccountEmail: gemMailId,
        items: bill.items,
      });
      setHistoryStatus((prev) => ({ ...prev, [bill._id]: "GeM tab khul gaya." }));
    } catch (err: any) {
      setHistoryStatus((prev) => ({ ...prev, [bill._id]: `Fail: ${err.message}` }));
    } finally {
      setHistorySubmittingId(null);
    }
  };

  // For a bill already submitted+verified on GeM whose OMS copy of GeM's own
  // invoice PDF never arrived ("GeM Invoice" column shows "-") - re-fetches
  // just that document instead of resubmitting the whole bill.
  const handleRetryGemDocument = async (bill: Bill) => {
    if (!company) return;
    setRetryingDocId(bill._id);
    setHistoryStatus((prev) => ({ ...prev, [bill._id]: "" }));
    try {
      await retryGemDocumentFetch({
        firmCode: company.firmCode,
        contractNo: bill.contractNo,
        billId: bill._id,
        billNo: bill.invoiceNumber,
        billPdfUrl: `${window.location.origin}/api/bills/${bill._id}/pdf`,
      });
      setHistoryStatus((prev) => ({ ...prev, [bill._id]: "GeM tab khul gaya, document fetch ho raha hai." }));
    } catch (err: any) {
      setHistoryStatus((prev) => ({ ...prev, [bill._id]: `Fail: ${err.message}` }));
    } finally {
      setRetryingDocId(null);
    }
  };

  // Undoes a mistakenly-generated bill (only offered before GeM's own
  // invoice has been fetched - see the API route's comment for why).
  const handleRegenerateBill = async (bill: Bill) => {
    if (
      !window.confirm(
        `"${bill.invoiceNumber}" delete karke uske orders wapas Un-billed Contracts me le jayega. Fresh se Generate Bill karna hoga. Continue karein?`
      )
    ) {
      return;
    }
    setRegeneratingId(bill._id);
    try {
      const res = await fetch(`/api/bills/${bill._id}/regenerate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Regenerate failed.");
        return;
      }
      alert(
        data.numberReclaimed
          ? `Bill delete ho gaya - "${data.invoiceNumber}" agla Auto Number generate karte hi wapas mil jayega.`
          : `Bill delete ho gaya - lekin "${data.invoiceNumber}" ke baad naye bills ban chuke hain, isliye wahi number wapas nahi milega, agla naya number milega.`
      );
      if (firmCode === data.firmCode) {
        fetchGroups(firmCode);
        fetchBills(firmCode);
      }
    } catch {
      alert("Network error while regenerating.");
    } finally {
      setRegeneratingId(null);
    }
  };

  // Cancels every order this bill was generated from (restoring stock) and
  // tags the bill itself as cancelled - the bill record stays for the
  // accounting trail, it isn't deleted.
  const handleCancelBill = async (bill: Bill) => {
    if (
      !window.confirm(
        `"${bill.invoiceNumber}" ke saare orders cancel ho jayenge (stock wapas aa jayega) aur bill "Cancelled" tag ho jayega. Continue karein?`
      )
    ) {
      return;
    }
    setCancellingBillId(bill._id);
    try {
      const res = await fetch(`/api/bills/${bill._id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userName: currentUsername() }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Cancel failed.");
        return;
      }
      fetchBills(firmCode);
    } catch {
      alert("Network error while cancelling.");
    } finally {
      setCancellingBillId(null);
    }
  };

  const handleExportMiracle = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/bills/export-miracle?date=${exportDate}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Export failed.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Bills_${exportDate}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Export failed.");
    } finally {
      setExporting(false);
    }
  };

  // Bulk-downloads both the OMS invoice PDF and GeM's own e-signed invoice
  // (when uploaded) for every bill matching the modal's Firm/Institute/Date
  // filters, as one ZIP - independent of whichever firm is selected in the
  // "Generate Bill" panel above, since this can span multiple firms.
  const handleZipExport = async () => {
    setZipExporting(true);
    setZipExportError("");
    try {
      const params = new URLSearchParams();
      if (zipFirmCode) params.set("firmCode", zipFirmCode);
      if (zipInstituteName.trim()) params.set("instituteName", zipInstituteName.trim());
      if (zipDateFrom) params.set("from", zipDateFrom);
      if (zipDateTo) params.set("to", zipDateTo);

      const res = await fetch(`/api/bills/export-zip?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setZipExportError(data.error || "Export failed.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Bills_Export_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setShowZipExportModal(false);
    } catch {
      setZipExportError("Network error while exporting.");
    } finally {
      setZipExporting(false);
    }
  };

  return (
    <BlockGuard
      permission="generateBill"
      fallback={
        <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center">
          <p className="text-red-500 font-bold uppercase">You have no Access for this Page.</p>
          <Link href="/dashboard/account" className="text-sm bg-slate-900 text-white px-4 py-2 mt-4 rounded-lg hover:bg-slate-800 transition-all">
            Back to Account
          </Link>
        </div>
      }
    >
      <div className="p-4 md:p-12 max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <button onClick={() => router.push("/dashboard/account")} className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition-colors font-bold text-xs uppercase tracking-widest">
            <FiArrowLeft /> Back to Account
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefreshAll}
              disabled={refreshingAll}
              title="Refresh un-billed contracts, bill history, and firms without reloading the page"
              className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all disabled:opacity-50"
            >
              <FiRefreshCw size={14} className={refreshingAll ? "animate-spin" : ""} /> Refresh
            </button>
            <button
              onClick={() => setShowZipExportModal(true)}
              className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all"
            >
              <FiDownload /> Export Bills (ZIP)
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
          <div className="p-8 text-white flex items-center gap-4 bg-[#0f172a]">
            <div className="p-4 bg-orange-500/20 rounded-2xl text-orange-400">
              <FiPrinter size={32} />
            </div>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tight">Generate Bill</h1>
              <p className="text-orange-400 text-[10px] font-black tracking-[0.2em] uppercase mt-1">Tax Invoice / Bill of Supply</p>
            </div>
          </div>

          <div className="p-8 space-y-6">
            {error && (
              <div className="bg-rose-50 text-rose-600 p-4 rounded-xl flex items-center gap-3 font-bold text-sm border border-rose-100">
                <FiX /> {error}
              </div>
            )}

            {result && (
              <div className="bg-emerald-50 text-emerald-700 p-4 rounded-xl border border-emerald-100 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="flex items-center gap-2 font-bold text-sm">
                    <FiCheckCircle /> Bill {result.invoiceNumber} generated successfully.
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openPdfFromBase64(result.pdfBase64)}
                      className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 transition-all"
                    >
                      <FiDownload /> View PDF
                    </button>
                    <button
                      onClick={handleSubmitToGem}
                      disabled={submittingToGem}
                      title="Requires the GeM Bill Auto-Submit Chrome extension installed"
                      className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all disabled:opacity-60"
                    >
                      <FiUpload /> {submittingToGem ? "Submitting..." : "Submit to GeM"}
                    </button>
                  </div>
                </div>
                {gemSubmitStatus && <p className="text-xs font-bold text-emerald-800">{gemSubmitStatus}</p>}
              </div>
            )}

            {/* Firm select */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Firm</label>
              <select
                value={firmCode}
                onChange={(e) => setFirmCode(e.target.value)}
                className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-orange-500/10 transition-all"
              >
                <option value="">Select Firm...</option>
                {companies.map((c) => (
                  <option key={c._id} value={c.firmCode}>{c.firmName} ({c.firmCode})</option>
                ))}
              </select>
              {company && (
                <p className="text-[11px] font-bold text-slate-400 ml-1">
                  {company.gstin ? `GSTIN: ${company.gstin}` : `Unregistered (PAN: ${company.pan || "---"})`}
                  {" · "}
                  {billTypeFor(company) === "TAX_INVOICE" ? "Issues Tax Invoice" : "Issues Bill of Supply"}
                  {company.isCompositionDealer ? " (Composition Dealer)" : ""}
                </p>
              )}
            </div>

            {/* Register a number already used outside OMS (offline sale billed
                directly in Miracle, sharing this firm's numbering series) - keeps
                OMS's own auto-counter from later colliding with it. */}
            {firmCode && company && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Register Miracle Bill Number(s)
                </p>
                <p className="text-[11px] font-bold text-slate-400">
                  Already billed offline in Miracle under {company.invoiceNumbering?.prefix || "this firm's"} numbering?
                  Register it here so OMS's next auto number doesn't collide - no order or bill gets created.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={registerNumbersInput}
                    onChange={(e) => setRegisterNumbersInput(e.target.value)}
                    placeholder="e.g. 46 or 46, 47, 48 or 46-50"
                    className="flex-1 text-xs font-bold border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-orange-400"
                  />
                  <button
                    onClick={submitRegisterNumbers}
                    disabled={registering || !registerNumbersInput.trim()}
                    className="text-[11px] font-black uppercase tracking-widest text-white bg-slate-700 hover:bg-slate-800 disabled:opacity-50 rounded-lg px-4 py-2 whitespace-nowrap"
                  >
                    {registering ? "Registering..." : "Register"}
                  </button>
                </div>
                {registerResult && (
                  <p className={`text-[11px] font-bold ${registerResult.ok ? "text-emerald-600" : "text-rose-600"}`}>
                    {registerResult.message}
                  </p>
                )}
              </div>
            )}

            {/* Contract list */}
            {firmCode && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Un-billed Contracts</label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => { setShowExempted((v) => { const next = !v; if (next) fetchExempted(firmCode); return next; }); }}
                      className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-orange-600 transition-colors"
                    >
                      {showExempted ? "Hide" : "Show"} Exempted
                    </button>
                    <button onClick={() => fetchGroups(firmCode)} className="text-slate-400 hover:text-orange-600 transition-colors" title="Refresh">
                      <FiRefreshCw size={14} />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 px-1">
                  <FiCalendar className="text-slate-400" size={13} />
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Contract Date</span>
                  <input
                    type="date"
                    value={contractDateFrom}
                    onChange={(e) => setContractDateFrom(e.target.value)}
                    className="text-xs font-bold border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-orange-400"
                  />
                  <span className="text-[10px] font-bold text-slate-400">to</span>
                  <input
                    type="date"
                    value={contractDateTo}
                    onChange={(e) => setContractDateTo(e.target.value)}
                    className="text-xs font-bold border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-orange-400"
                  />
                  {(contractDateFrom || contractDateTo) && (
                    <button
                      onClick={() => { setContractDateFrom(""); setContractDateTo(""); }}
                      className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-orange-600"
                    >
                      Clear
                    </button>
                  )}
                </div>

                <div className="relative px-1">
                  <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
                  <input
                    type="text"
                    value={contractSearchQuery}
                    onChange={(e) => setContractSearchQuery(e.target.value)}
                    placeholder="Search Contract No / Item Name / Institute Name / Total Amount..."
                    className="w-full pl-9 pr-8 py-2 text-xs font-bold border border-slate-200 rounded-lg outline-none focus:border-orange-400"
                  />
                  {contractSearchQuery && (
                    <button
                      onClick={() => setContractSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-orange-600"
                    >
                      <FiX size={13} />
                    </button>
                  )}
                </div>

                {loadingGroups ? (
                  <p className="text-xs font-bold text-slate-400 p-4">Loading...</p>
                ) : groups.length === 0 ? (
                  <p className="text-xs font-bold text-slate-400 p-4 bg-slate-50 rounded-xl border border-slate-200">
                    No un-billed orders for this firm.
                  </p>
                ) : filteredGroups.length === 0 ? (
                  <p className="text-xs font-bold text-slate-400 p-4 bg-slate-50 rounded-xl border border-slate-200">
                    No un-billed contracts match that date range / search.
                  </p>
                ) : (
                  <>
                    <div className="flex items-center gap-2 px-1">
                      <input
                        type="checkbox"
                        checked={selectedGroupKeys.size > 0 && selectedGroupKeys.size === visibleGroups.length}
                        onChange={toggleSelectAllContracts}
                        className="w-3.5 h-3.5"
                      />
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                        {selectedGroupKeys.size > 0 ? `${selectedGroupKeys.size} selected` : `Select all (showing ${visibleGroups.length} of ${filteredGroups.length})`}
                      </span>
                      {selectedGroupKeys.size > 0 && (
                        <button
                          onClick={() => setExemptPanelOpen((v) => !v)}
                          className="ml-auto text-[10px] font-black uppercase tracking-widest text-orange-600 hover:text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5"
                        >
                          Mark as Exempt (No Bill Needed)
                        </button>
                      )}
                    </div>

                    {exemptPanelOpen && selectedGroupKeys.size > 0 && (
                      <div className="bg-orange-50/70 border border-orange-200 rounded-xl p-4 space-y-3">
                        <p className="text-xs font-bold text-slate-600">
                          Why doesn't {selectedGroupKeys.size} contract{selectedGroupKeys.size > 1 ? "s" : ""} need a bill from OMS?
                        </p>
                        <div className="flex flex-col gap-2">
                          <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                            <input type="radio" checked={exemptReason === "ALREADY_BILLED_EXTERNAL"} onChange={() => setExemptReason("ALREADY_BILLED_EXTERNAL")} />
                            Already billed outside OMS (e.g. in Miracle)
                          </label>
                          <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                            <input type="radio" checked={exemptReason === "NOT_REQUIRED"} onChange={() => setExemptReason("NOT_REQUIRED")} />
                            No bill needed for this at all
                          </label>
                        </div>
                        <input
                          type="text"
                          value={exemptNote}
                          onChange={(e) => setExemptNote(e.target.value)}
                          placeholder={exemptReason === "ALREADY_BILLED_EXTERNAL" ? "Optional: Miracle invoice number, e.g. SM2" : "Optional note"}
                          className="w-full text-xs font-bold border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-orange-400"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={submitExemption}
                            disabled={exempting}
                            className="text-[11px] font-black uppercase tracking-widest text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-50 rounded-lg px-4 py-2"
                          >
                            {exempting ? "Saving..." : "Confirm"}
                          </button>
                          <button
                            onClick={() => setExemptPanelOpen(false)}
                            className="text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 px-4 py-2"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* One shared column grid for every item row across every card, so
                        Qty/Rate/Total line up vertically down the whole list instead of
                        each card auto-sizing its own (differently-positioned) columns.
                        The leading spacer matches the checkbox + gap each card indents by. */}
                    <div className="flex items-center gap-3 px-4">
                      <span className="w-3.5 flex-shrink-0" />
                      <div className="flex-1 grid grid-cols-[1fr_70px_70px_85px] gap-x-3 text-[10px] font-black text-slate-400 uppercase tracking-wide">
                        <span>Item</span>
                        <span className="text-right">Qty</span>
                        <span className="text-right">Rate</span>
                        <span className="text-right">Total</span>
                      </div>
                    </div>

                    <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                      {visibleGroups.map((g) => {
                        const key = groupKey(g);
                        return (
                          <div
                            key={key}
                            className={`w-full p-4 hover:bg-orange-50/50 transition-all ${selectedContract?.contractNo === g.contractNo ? "bg-orange-50" : ""}`}
                          >
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={selectedGroupKeys.has(key)}
                                onChange={() => toggleContractSelected(key)}
                                className="w-3.5 h-3.5 flex-shrink-0 mt-1"
                              />
                              <button onClick={() => selectContract(g)} className="flex-1 text-left">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="font-black text-slate-700 text-sm">{g.contractNo || "No Contract No."}</p>
                                    <p className="text-xs font-bold text-slate-400">
                                      {g.instituteName}{g.buyerState ? ` · ${g.buyerState}` : ""}{g.contractDate ? ` · ${g.contractDate}` : ""}
                                    </p>
                                  </div>
                                  <FiChevronRight className="text-slate-300 flex-shrink-0" />
                                </div>
                                <div className="mt-2 space-y-1">
                                  {g.orders.map((o) => (
                                    <div key={o._id} className="grid grid-cols-[1fr_70px_70px_85px] gap-x-3 text-[11px] text-slate-600">
                                      <span className="font-bold truncate" title={o.itemName}>{o.itemName}</span>
                                      <span className="text-right tabular-nums">{o.reQty} {o.unit || ""}</span>
                                      <span className="text-right tabular-nums">₹{fmt2(o.rate)}</span>
                                      <span className="text-right font-bold tabular-nums">₹{fmt2(o.totalAmount)}</span>
                                    </div>
                                  ))}
                                </div>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {filteredGroups.length > visibleGroups.length && (
                      <button
                        onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                        className="w-full text-[11px] font-black uppercase tracking-widest text-orange-600 hover:text-orange-700 bg-orange-50 border border-orange-200 rounded-xl py-2.5"
                      >
                        Load 20 More ({filteredGroups.length - visibleGroups.length} remaining)
                      </button>
                    )}
                  </>
                )}

                {showExempted && (
                  <div className="space-y-2 pt-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Exempted Contracts</label>
                    {loadingExempted ? (
                      <p className="text-xs font-bold text-slate-400 p-4">Loading...</p>
                    ) : exemptedGroups.length === 0 ? (
                      <p className="text-xs font-bold text-slate-400 p-4 bg-slate-50 rounded-xl border border-slate-200">
                        No exempted contracts for this firm.
                      </p>
                    ) : filteredExemptedGroups.length === 0 ? (
                      <p className="text-xs font-bold text-slate-400 p-4 bg-slate-50 rounded-xl border border-slate-200">
                        No exempted contracts match that date range / search.
                      </p>
                    ) : (
                      <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                        {filteredExemptedGroups.map((g) => {
                          const first = g.orders[0];
                          const key = groupKey(g);
                          return (
                            <div key={key} className="flex items-center justify-between p-4">
                              <div>
                                <p className="font-black text-slate-700 text-sm">{g.contractNo || "No Contract No."}</p>
                                <p className="text-xs font-bold text-slate-400">{g.instituteName} · {g.orders.length} item(s){g.contractDate ? ` · ${g.contractDate}` : ""}</p>
                                <p className="text-[10px] font-bold text-orange-500 mt-1">
                                  {first?.billExemptReason === "ALREADY_BILLED_EXTERNAL" ? "Already billed outside OMS" : "No bill needed"}
                                  {first?.billExemptNote ? ` · ${first.billExemptNote}` : ""}
                                </p>
                              </div>
                              <button
                                onClick={() => undoExemption(g)}
                                disabled={unExempting === key}
                                className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-orange-600 disabled:opacity-50 border border-slate-200 rounded-lg px-3 py-1.5"
                              >
                                {unExempting === key ? "Undoing..." : "Undo"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Line items + generate */}
            {selectedContract && company && (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 p-4 flex items-center justify-between border-b border-slate-200">
                  <div>
                    <p className="font-black text-slate-700 text-sm">{selectedContract.contractNo}</p>
                    <p className="text-xs font-bold text-slate-400">
                      {selectedContract.instituteName}
                      {gstSplit !== "UNKNOWN" && isTaxInvoice ? ` · ${gstSplit === "IGST" ? "IGST" : "CGST + SGST"}` : ""}
                      {isTaxInvoice && gstSplit === "UNKNOWN" ? " · Buyer state missing — add it on the Seller record to auto-decide CGST/SGST vs IGST" : ""}
                    </p>
                  </div>
                  <button onClick={() => setSelectedContract(null)} className="text-slate-400 hover:text-rose-600"><FiX /></button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/50">
                        <th className="p-3 font-black text-slate-400 uppercase tracking-widest">Item</th>
                        <th className="p-3 font-black text-slate-400 uppercase tracking-widest">Qty</th>
                        <th className="p-3 font-black text-slate-400 uppercase tracking-widest">Rate</th>
                        <th className="p-3 font-black text-slate-400 uppercase tracking-widest">Discount</th>
                        {isTaxInvoice && <th className="p-3 font-black text-slate-400 uppercase tracking-widest">HSN/SAC</th>}
                        {isTaxInvoice && <th className="p-3 font-black text-slate-400 uppercase tracking-widest">GST %</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedContract.orders.map((o) => (
                        <tr key={o._id}>
                          <td className="p-3 font-bold text-slate-700">{o.itemName}</td>
                          <td className="p-3 font-bold text-slate-600">{o.reQty} {o.unit}</td>
                          <td className="p-3 font-bold text-slate-600">₹{fmt2(o.rate)}</td>
                          <td className="p-3">
                            <input
                              type="number" min="0"
                              value={overrides[o._id]?.discount ?? 0}
                              onChange={(e) => updateOverride(o._id, "discount", e.target.value)}
                              className="w-24 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none font-bold text-slate-700 focus:ring-2 focus:ring-orange-500/20"
                            />
                          </td>
                          {isTaxInvoice && (
                            <td className="p-3">
                              <input
                                type="text"
                                value={overrides[o._id]?.hsnSac ?? ""}
                                onChange={(e) => updateOverride(o._id, "hsnSac", e.target.value)}
                                className="w-24 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none font-bold text-slate-700 focus:ring-2 focus:ring-orange-500/20"
                              />
                            </td>
                          )}
                          {isTaxInvoice && (
                            <td className="p-3">
                              <input
                                type="number" min="0" max="28" step="0.1"
                                value={overrides[o._id]?.gstPercent ?? 0}
                                onChange={(e) => updateOverride(o._id, "gstPercent", e.target.value)}
                                className="w-20 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none font-bold text-slate-700 focus:ring-2 focus:ring-orange-500/20"
                              />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {preview && (
                  <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col items-end gap-1 text-xs font-bold text-slate-600">
                    <span>Sub Total: ₹{preview.subTotal.toFixed(2)}</span>
                    {preview.totalDiscount > 0 && <span>Discount: - ₹{preview.totalDiscount.toFixed(2)}</span>}
                    {isTaxInvoice && <span>GST: ₹{preview.totalGst.toFixed(2)}</span>}
                    <span className="text-sm font-black text-slate-900">Grand Total: ₹{preview.grandTotal.toFixed(2)}</span>
                  </div>
                )}

                <div className="p-4 border-t border-slate-200 space-y-4">
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                      <input type="radio" checked={numberMode === "auto"} onChange={() => setNumberMode("auto")} /> Auto Number
                    </label>
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                      <input type="radio" checked={numberMode === "manual"} onChange={() => setNumberMode("manual")} /> Manual Number
                    </label>
                  </div>
                  {numberMode === "manual" && (
                    <input
                      type="text"
                      value={manualNumber}
                      onChange={(e) => setManualNumber(e.target.value)}
                      placeholder={`E.G. ${company.invoiceNumbering?.prefix || ""}52`}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-orange-500/10"
                    />
                  )}
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="w-full bg-[#ff5100] hover:bg-orange-700 text-white font-black py-4 rounded-2xl shadow-lg flex items-center justify-center gap-3 transition-all uppercase tracking-widest text-sm active:scale-95 disabled:opacity-60"
                  >
                    <FiFileText /> {generating ? "Generating..." : "Generate Bill"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* History + Miracle export */}
        {firmCode && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4 bg-slate-50/50">
              <h2 className="font-black text-slate-800 uppercase tracking-tight">Bill History</h2>
              <div className="flex items-center gap-2">
                <FiCalendar className="text-slate-400" />
                <input
                  type="date"
                  value={exportDate}
                  onChange={(e) => setExportDate(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold outline-none"
                />
                <button
                  onClick={handleExportMiracle}
                  disabled={exporting}
                  className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all disabled:opacity-60"
                >
                  <FiDownload /> {exporting ? "Exporting..." : "Export for Miracle"}
                </button>
              </div>
            </div>

            <div className="p-4 border-b border-slate-100 bg-white flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <FiCalendar className="text-slate-400" size={13} />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Date</span>
                <input
                  type="date"
                  value={billHistoryDateFrom}
                  onChange={(e) => setBillHistoryDateFrom(e.target.value)}
                  className="text-xs font-bold border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-orange-400"
                />
                <span className="text-[10px] font-bold text-slate-400">to</span>
                <input
                  type="date"
                  value={billHistoryDateTo}
                  onChange={(e) => setBillHistoryDateTo(e.target.value)}
                  className="text-xs font-bold border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-orange-400"
                />
              </div>

              <div className="flex items-center gap-2">
                <FiFileText className="text-slate-400" size={13} />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Invoice No.</span>
                <input
                  type="text"
                  value={invoiceRangeFrom}
                  onChange={(e) => setInvoiceRangeFrom(e.target.value)}
                  placeholder={`E.G. ${company?.invoiceNumbering?.prefix || ""}14`}
                  className="w-28 text-xs font-bold border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-orange-400"
                />
                <span className="text-[10px] font-bold text-slate-400">to</span>
                <input
                  type="text"
                  value={invoiceRangeTo}
                  onChange={(e) => setInvoiceRangeTo(e.target.value)}
                  placeholder={`E.G. ${company?.invoiceNumbering?.prefix || ""}20`}
                  className="w-28 text-xs font-bold border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-orange-400"
                />
              </div>

              <div className="relative flex-1 min-w-[220px]">
                <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
                <input
                  type="text"
                  value={billHistorySearchQuery}
                  onChange={(e) => setBillHistorySearchQuery(e.target.value)}
                  placeholder="Search Invoice No / Contract No / Buyer / Amount..."
                  className="w-full pl-8 pr-8 py-1.5 text-xs font-bold border border-slate-200 rounded-lg outline-none focus:border-orange-400"
                />
                {billHistorySearchQuery && (
                  <button
                    onClick={() => setBillHistorySearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-orange-600"
                  >
                    <FiX size={13} />
                  </button>
                )}
              </div>

              {billHistoryFiltersActive && (
                <button
                  onClick={() => {
                    setBillHistoryDateFrom("");
                    setBillHistoryDateTo("");
                    setInvoiceRangeFrom("");
                    setInvoiceRangeTo("");
                    setBillHistorySearchQuery("");
                  }}
                  className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-orange-600"
                >
                  Clear Filters
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="p-4 font-black text-slate-400 uppercase tracking-widest">Invoice No.</th>
                    <th className="p-4 font-black text-slate-400 uppercase tracking-widest">Date</th>
                    <th className="p-4 font-black text-slate-400 uppercase tracking-widest">Contract No</th>
                    <th className="p-4 font-black text-slate-400 uppercase tracking-widest">Buyer</th>
                    <th className="p-4 font-black text-slate-400 uppercase tracking-widest text-right">Amount</th>
                    <th className="p-4 font-black text-slate-400 uppercase tracking-widest text-right">PDF</th>
                    <th className="p-4 font-black text-slate-400 uppercase tracking-widest text-right">Submit to GeM</th>
                    <th className="p-4 font-black text-slate-400 uppercase tracking-widest text-right">GeM Invoice</th>
                    <th className="p-4 font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bills.length === 0 && (
                    <tr><td colSpan={9} className="p-6 text-center text-slate-400 font-bold">No bills generated yet.</td></tr>
                  )}
                  {bills.length > 0 && filteredBills.length === 0 && (
                    <tr><td colSpan={9} className="p-6 text-center text-slate-400 font-bold">No bills match those filters.</td></tr>
                  )}
                  {visibleBills.map((b) => (
                    <tr key={b._id} className={`hover:bg-slate-50/50 ${b.cancelled ? "opacity-50" : ""}`}>
                      <td className="p-4">
                        <div className="font-black text-slate-700">{b.invoiceNumber}</div>
                        {b.cancelled && (
                          <span className="inline-block mt-1 text-[9px] font-black uppercase tracking-widest text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                            Cancelled
                          </span>
                        )}
                      </td>
                      <td className="p-4 font-bold text-slate-600">{new Date(b.invoiceDate).toLocaleDateString("en-GB")}</td>
                      <td className="p-4">
                        <div className="font-bold text-slate-700">{b.contractNo || "—"}</div>
                        {b.contractDate && <div className="text-[10px] font-bold text-slate-400">{b.contractDate}</div>}
                      </td>
                      <td className="p-4 font-bold text-slate-600">{b.buyerSnapshot?.instituteName}</td>
                      <td className="p-4 font-bold text-slate-600 text-right">₹{b.grandTotal?.toFixed(2)}</td>
                      <td className="p-4 text-right">
                        <a
                          href={`/api/bills/${b._id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-2 inline-flex bg-slate-100 text-slate-400 rounded-lg hover:bg-orange-600 hover:text-white transition-all"
                        >
                          <FiDownload size={14} />
                        </a>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <button
                            onClick={() => handleSubmitToGemFromHistory(b)}
                            disabled={historySubmittingId === b._id}
                            title="Requires the GeM Bill Auto-Submit Chrome extension installed"
                            className="p-2 inline-flex bg-slate-100 text-slate-400 rounded-lg hover:bg-slate-900 hover:text-white transition-all disabled:opacity-60"
                          >
                            <FiUpload size={14} />
                          </button>
                          {historyStatus[b._id] && (
                            <span className="text-[10px] font-bold text-slate-400 max-w-[160px] text-right">{historyStatus[b._id]}</span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 text-right">
                        {b.gemDocumentR2Key ? (
                          <a
                            href={`/api/bills/${b._id}/gem-document`}
                            target="_blank"
                            rel="noreferrer"
                            title="GeM's own e-signed invoice document"
                            className="p-2 inline-flex bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-600 hover:text-white transition-all"
                          >
                            <FiDownload size={14} />
                          </a>
                        ) : (
                          <button
                            onClick={() => handleRetryGemDocument(b)}
                            disabled={retryingDocId === b._id}
                            title="Bill GeM par already submit/verify ho chuka ho to iska document dobara fetch karo"
                            className="p-2 inline-flex bg-slate-100 text-slate-400 rounded-lg hover:bg-slate-900 hover:text-white transition-all disabled:opacity-60"
                          >
                            <FiRefreshCw size={14} />
                          </button>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {!b.gemDocumentR2Key && !b.cancelled && (
                            <button
                              onClick={() => handleRegenerateBill(b)}
                              disabled={regeneratingId === b._id}
                              title="Delete this bill and re-generate it (only available before GeM's invoice exists)"
                              className="p-2 inline-flex bg-slate-100 text-slate-400 rounded-lg hover:bg-orange-600 hover:text-white transition-all disabled:opacity-60"
                            >
                              <FiRefreshCw size={14} />
                            </button>
                          )}
                          {!b.cancelled && (
                            <button
                              onClick={() => handleCancelBill(b)}
                              disabled={cancellingBillId === b._id}
                              title="Cancel every order this bill was generated from, and tag the bill as cancelled"
                              className="p-2 inline-flex bg-slate-100 text-slate-400 rounded-lg hover:bg-red-600 hover:text-white transition-all disabled:opacity-60"
                            >
                              <FiX size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {visibleBillCount < filteredBills.length && (
              <div className="p-4 border-t border-slate-100">
                <button
                  onClick={() => setVisibleBillCount((c) => c + BILL_PAGE_SIZE)}
                  className="w-full py-3 bg-orange-50 hover:bg-orange-100 text-orange-600 font-black text-[11px] uppercase tracking-widest rounded-xl transition-all"
                >
                  Load {Math.min(BILL_PAGE_SIZE, filteredBills.length - visibleBillCount)} More ({filteredBills.length - visibleBillCount} Remaining)
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {showZipExportModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="p-6 bg-slate-900 text-white flex items-center justify-between">
              <h2 className="font-black uppercase tracking-tight">Export Bills (ZIP)</h2>
              <button onClick={() => setShowZipExportModal(false)} className="text-white/50 hover:text-white transition-colors">
                <FiX size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs font-bold text-slate-500">
                In filters se jo bhi bills match karenge, unka OMS invoice PDF
                aur GeM ka e-signed document (agar upload hua ho) — dono
                ek ZIP me, har bill ke liye alag folder ("Firm-Contract No")
                ke saath download honge.
              </p>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Firm (optional)</label>
                <select
                  value={zipFirmCode}
                  onChange={(e) => setZipFirmCode(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-orange-500/10 transition-all"
                >
                  <option value="">All Firms</option>
                  {companies.map((c) => (
                    <option key={c._id} value={c.firmCode}>{c.firmName} ({c.firmCode})</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Institute Name (optional)</label>
                <input
                  type="text"
                  value={zipInstituteName}
                  onChange={(e) => setZipInstituteName(e.target.value)}
                  placeholder="e.g. Mansa ITI"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-orange-500/10 transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Date From</label>
                  <input
                    type="date"
                    value={zipDateFrom}
                    onChange={(e) => setZipDateFrom(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-orange-500/10 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Date To</label>
                  <input
                    type="date"
                    value={zipDateTo}
                    onChange={(e) => setZipDateTo(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-slate-700 focus:ring-4 focus:ring-orange-500/10 transition-all"
                  />
                </div>
              </div>

              {zipExportError && (
                <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{zipExportError}</p>
              )}

              <button
                onClick={handleZipExport}
                disabled={zipExporting}
                className="w-full bg-[#ff5100] hover:bg-orange-700 text-white font-black py-4 rounded-2xl shadow-lg flex items-center justify-center gap-3 transition-all uppercase tracking-widest text-sm active:scale-95 disabled:opacity-60"
              >
                <FiDownload /> {zipExporting ? "Preparing ZIP..." : "Download ZIP"}
              </button>
            </div>
          </div>
        </div>
      )}
    </BlockGuard>
  );
}
