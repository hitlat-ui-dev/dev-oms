"use client";
import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import * as XLSX from "xlsx";
import Link from "next/link";
import {
  FiArrowLeft,
  FiUploadCloud,
  FiFileText,
  FiTrash2,
  FiEye,
  FiX,
  FiSearch,
  FiCheckCircle,
  FiAlertTriangle,
  FiClock,
} from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import { matchInstituteFromDescription, SellerLite } from "@/lib/institutMatcher";

interface Transaction {
  sno: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
  chequeNo: string;
  balance: number;
}

interface ParsedStatement {
  bankName: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  statementPeriodFrom: string;
  statementPeriodTo: string;
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  transactions: Transaction[];
}

interface Gap {
  afterDate: string;
  afterDescription: string;
  afterBalance: number;
  beforeDate: string;
  beforeDescription: string;
  beforeBalance: number;
  expectedBalance: number;
  difference: number;
}

interface UploadEvent {
  fileName: string;
  uploadedBy: string;
  uploadedAt: string;
  periodFrom: string;
  periodTo: string;
  addedCount: number;
  duplicateCount: number;
}

interface StatementRecord {
  _id: string;
  firmId: string;
  firmCode: string;
  firmName: string;
  bankName: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  transactions: Transaction[];
  gaps: Gap[];
  uploadHistory: UploadEvent[];
  updatedAt: string;
  createdAt: string;
}

interface SaveResult {
  addedCount: number;
  duplicateCount: number;
  gaps: Gap[];
}

const normalizeCell = (v: any): string => (v === null || v === undefined ? "" : String(v).trim());

const parseAmount = (v: any): number => {
  const s = normalizeCell(v).replace(/,/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
};

const formatMoney = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
// Same fingerprint formula the backend uses (app/api/account-statements/route.ts's
// txnKey) - duplicated locally rather than imported, since that file is a
// server route module, not a shared client-safe util.
const txnKey = (t: Transaction) =>
  `${t.date}|${t.description.trim().toLowerCase()}|${round2(t.debit)}|${round2(t.credit)}|${round2(t.balance)}`;

// Column headers to look for in the transaction table row. Debit/Credit and
// Balance also match the wording some banks use instead (HDFC exports
// "Withdrawal Amt." / "Deposit Amt." / "Closing Balance" rather than plain
// "Debit" / "Credit" / "Balance").
const COLUMN_HEADERS: Record<string, RegExp> = {
  sno: /^s\.?\s*no\.?$/i,
  date: /^date$/i,
  description: /description|narration|particulars/i,
  debit: /^debit|withdrawal/i,
  credit: /^credit|deposit/i,
  chequeNo: /cheque|chq/i,
  balance: /balance/i,
};

// Finds a labelled row (e.g. "Account Number") and returns the N non-empty cells that follow it.
// Handles two layouts: label and value(s) in separate cells (e.g. "Account
// Number" | "1234"), or both packed into one cell (HDFC: "Account No
// :99997600016442   OTHER") - tried first since it's the more specific match.
const findLabelValues = (rows: any[][], labelRegex: RegExp, count = 1): string[] => {
  for (const row of rows) {
    for (let c = 0; c < row.length; c++) {
      const cellText = normalizeCell(row[c]);
      const inlineMatch = cellText.match(labelRegex);
      if (!inlineMatch) continue;

      if (count === 1) {
        const rest = cellText.slice(inlineMatch.index! + inlineMatch[0].length).replace(/^[\s:]+/, "").trim();
        const inlineValue = rest.split(/\s+/)[0];
        if (inlineValue) return [inlineValue];
      }

      const values: string[] = [];
      for (let k = c + 1; k < row.length && values.length < count; k++) {
        const val = normalizeCell(row[k]);
        if (val) values.push(val);
      }
      if (values.length > 0) return values;
    }
  }
  return [];
};

// Some banks (HDFC) print the statement period as "Statement From :
// 01/05/2026   To : 31/07/2026" in one cell instead of a "Statement Period"
// label followed by two date cells - findLabelValues' generic label:value
// shape doesn't cover a two-value inline pair, so this is a dedicated fallback.
const findStatementFromTo = (rows: any[][]): [string, string] => {
  for (const row of rows) {
    for (const cell of row) {
      const text = normalizeCell(cell);
      const m = text.match(/from\s*:?\s*([\d/.-]+)\s*to\s*:?\s*([\d/.-]+)/i);
      if (m) return [m[1], m[2]];
    }
  }
  return ["", ""];
};

// Parses a generic Indian bank-statement Excel export: a label:value header block
// followed by a transaction table (Date / Description / Debit / Credit / Balance).
function parseStatementRows(rows: any[][]): ParsedStatement {
  const firstRow = rows[0] || [];
  // Some banks (HDFC) cram "<Bank Name>    Page No .: 1    Statement of accounts"
  // into a single cell - the bank name itself is just the text before the
  // first big run of whitespace.
  const bankName = (normalizeCell(firstRow.find((c: any) => normalizeCell(c))) || "").split(/\s{2,}/)[0];

  const accountHolderName = findLabelValues(rows, /^name$/i, 1)[0] || "";
  const accountNumber = findLabelValues(rows, /account\s*(no\.?|number)\b/i, 1)[0] || "";
  const ifscCode = findLabelValues(rows, /ifsc/i, 1)[0] || "";
  const periodLabelled = findLabelValues(rows, /statement\s*period/i, 2);
  const period = periodLabelled.length === 2 ? periodLabelled : findStatementFromTo(rows);

  // Locate the transaction table header row by matching column names
  let headerRowIdx = -1;
  let colMap: Record<string, number> = {};
  for (let r = 0; r < rows.length; r++) {
    const localMap: Record<string, number> = {};
    (rows[r] || []).forEach((cell: any, c: number) => {
      const text = normalizeCell(cell);
      if (!text) return;
      for (const [key, regex] of Object.entries(COLUMN_HEADERS)) {
        if (regex.test(text) && !(key in localMap)) localMap[key] = c;
      }
    });
    if ("date" in localMap && "debit" in localMap && "credit" in localMap) {
      headerRowIdx = r;
      colMap = localMap;
      break;
    }
  }

  const transactions: Transaction[] = [];
  if (headerRowIdx !== -1) {
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const firstCell = normalizeCell(row[0]);
      const dateCell = normalizeCell(row[colMap.date]);

      if (/^total$/i.test(firstCell) || /^total$/i.test(dateCell)) break;
      // A "***..." border/separator row, or trailing footer content (summary
      // table, "Generated On", GSTIN notice, "End of Statement" etc.) never
      // has a real date in the date column - only rows that actually look
      // like a date get treated as transactions, everything else is skipped
      // rather than blindly accepted (HDFC's footer rows aren't blank, they
      // just don't have anything in the date column that's a real date).
      if (!/^\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}$/.test(dateCell)) {
        if (/opening balance|closing balance|total debit|total credit|end of statement/i.test(firstCell)) break;
        continue; // blank spacer / separator / footer row inside the table
      }

      transactions.push({
        sno: normalizeCell(row[colMap.sno]),
        date: dateCell,
        description: normalizeCell(row[colMap.description]),
        debit: parseAmount(row[colMap.debit]),
        credit: parseAmount(row[colMap.credit]),
        chequeNo: normalizeCell(row[colMap.chequeNo]),
        balance: parseAmount(row[colMap.balance]),
      });
    }
  }

  // Totals are computed directly from the parsed rows so they're correct
  // regardless of whether/how the source file prints its own summary line.
  const totalDebit = transactions.reduce((s, t) => s + t.debit, 0);
  const totalCredit = transactions.reduce((s, t) => s + t.credit, 0);

  const openingLabelValue = parseAmount(findLabelValues(rows, /opening\s*balance/i, 1)[0]);
  const closingLabelValue = parseAmount(findLabelValues(rows, /closing\s*balance/i, 1)[0]);

  const openingBalance =
    openingLabelValue ||
    (transactions[0] ? transactions[0].balance - transactions[0].credit + transactions[0].debit : 0);
  const closingBalance =
    closingLabelValue || (transactions.length > 0 ? transactions[transactions.length - 1].balance : 0);

  return {
    bankName,
    accountHolderName,
    accountNumber,
    ifscCode,
    statementPeriodFrom: period[0] || "",
    statementPeriodTo: period[1] || "",
    openingBalance,
    closingBalance,
    totalDebit,
    totalCredit,
    transactions,
  };
}

export default function StatementPage() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [sellers, setSellers] = useState<SellerLite[]>([]);
  const [selectedFirmId, setSelectedFirmId] = useState("");
  const [statements, setStatements] = useState<StatementRecord[]>([]);
  const [loadingStatements, setLoadingStatements] = useState(true);
  const [fileName, setFileName] = useState("");
  const [parsedPreview, setParsedPreview] = useState<ParsedStatement | null>(null);
  const [parseError, setParseError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [showUploadHistoryFor, setShowUploadHistoryFor] = useState<string | null>(null);
  const [libraryFirmFilter, setLibraryFirmFilter] = useState("");
  const [viewingStatement, setViewingStatement] = useState<StatementRecord | null>(null);
  const [txnSearch, setTxnSearch] = useState("");
  const [currentUsername, setCurrentUsername] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    fetch("/api/companies")
      .then((res) => res.json())
      .then((data) => setCompanies(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load firms", err));

    fetch("/api/sellers")
      .then((res) => res.json())
      .then((data) => setSellers(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load sellers", err));

    fetchStatements();
  }, []);

  const fetchStatements = () => {
    setLoadingStatements(true);
    fetch("/api/account-statements")
      .then((res) => res.json())
      .then((data) => setStatements(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load statements", err))
      .finally(() => setLoadingStatements(false));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError("");
    setParsedPreview(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

        const parsed = parseStatementRows(rows);
        if (parsed.transactions.length === 0) {
          setParseError("Could not find any transaction rows in this file. Please check the sheet format.");
        }
        setParsedPreview(parsed);
      } catch (err) {
        console.error("Error parsing statement file:", err);
        setParseError("Failed to parse this Excel file. Please check the console for details.");
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleClearUpload = () => {
    setFileName("");
    setParsedPreview(null);
    setParseError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSaveStatement = async () => {
    if (!parsedPreview || !selectedFirmId) return;
    const firm = companies.find((c) => c._id === selectedFirmId);
    setIsSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch("/api/account-statements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firmId: selectedFirmId,
          firmCode: firm?.firmCode || "",
          firmName: firm?.firmName || "",
          fileName,
          uploadedBy: currentUsername,
          ...parsedPreview,
        }),
      });
      if (!res.ok) throw new Error("Failed to save statement");
      const data = await res.json();
      setSaveResult({ addedCount: data.addedCount, duplicateCount: data.duplicateCount, gaps: data.gaps || [] });
      handleClearUpload();
      fetchStatements();
    } catch (err) {
      console.error(err);
      alert("Failed to save statement. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteStatement = async (id: string) => {
    if (!confirm("Delete this statement? This cannot be undone.")) return;
    try {
      await fetch(`/api/account-statements?id=${id}`, { method: "DELETE" });
      setStatements((prev) => prev.filter((s) => s._id !== id));
      if (viewingStatement?._id === id) setViewingStatement(null);
    } catch (err) {
      console.error(err);
    }
  };

  // Removes one wrongly-included/duplicate entry from an already-saved
  // statement - the backend recomputes closing balance/totals/gaps afterward
  // since removing a row shifts the running-balance chain.
  const handleDeleteTransaction = async (txn: Transaction) => {
    if (!viewingStatement) return;
    if (
      !confirm(
        `Delete this entry?\n${txn.date} — ${txn.description || "(no description)"}\nDebit: ₹${formatMoney(txn.debit)}  Credit: ₹${formatMoney(txn.credit)}`
      )
    )
      return;
    try {
      const res = await fetch(
        `/api/account-statements?id=${viewingStatement._id}&txnKey=${encodeURIComponent(txnKey(txn))}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete entry");
      setViewingStatement(data.statement);
      setStatements((prev) => prev.map((s) => (s._id === data.statement._id ? data.statement : s)));
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Failed to delete entry");
    }
  };

  const filteredStatements = useMemo(() => {
    const list = libraryFirmFilter ? statements.filter((s) => s.firmId === libraryFirmFilter) : statements;
    // Group each firm's multiple bank accounts together instead of scattering them by update time
    return [...list].sort((a, b) => {
      const firmCompare = (a.firmName || "").localeCompare(b.firmName || "");
      if (firmCompare !== 0) return firmCompare;
      return (a.bankName || "").localeCompare(b.bankName || "");
    });
  }, [statements, libraryFirmFilter]);

  const filteredTransactions = useMemo(() => {
    if (!viewingStatement) return [];
    const q = txnSearch.trim().toLowerCase();
    if (!q) return viewingStatement.transactions;
    return viewingStatement.transactions.filter(
      (t) => t.description.toLowerCase().includes(q) || t.date.toLowerCase().includes(q) || t.chequeNo.toLowerCase().includes(q)
    );
  }, [viewingStatement, txnSearch]);

  return (
    <BlockGuard
      permission="accountStatements"
      fallback={
        <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center">
          <p className="text-red-500 font-bold uppercase">You have no Access for this Page.</p>
          <Link
            href="/dashboard"
            className="text-sm bg-slate-900 text-white px-4 py-2 mt-4 rounded-lg hover:bg-slate-800 transition-all"
          >
            Go to Dashboard
          </Link>
        </div>
      }
    >
      <div className="p-4 md:p-8 bg-slate-50 min-h-screen">
        <div className="max-w-7xl mx-auto flex flex-col gap-6">
          {/* Header */}
          <div>
            <Link href="/dashboard/account" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
              <FiArrowLeft /> Back to Account
            </Link>
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
              <FiFileText className="text-blue-600" /> Bank Statements
            </h1>
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
              Upload & Review Firm-wise Account Statements
            </p>
          </div>

          {/* Upload Card */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5 mb-4">
              <FiUploadCloud className="text-blue-600" size={14} /> Upload Statement
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div className="flex flex-col gap-1">
                <label className="text-[9px] font-black uppercase tracking-wider text-slate-500">Firm</label>
                <select
                  value={selectedFirmId}
                  onChange={(e) => setSelectedFirmId(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs text-slate-900 focus:outline-none focus:border-blue-500 font-bold"
                >
                  <option value="">Select Firm...</option>
                  {companies.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.firmName} {c.firmCode ? `(${c.firmCode})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[9px] font-black uppercase tracking-wider text-slate-500">Statement File (.xls / .xlsx)</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl py-2.5 px-3 text-xs font-bold text-slate-700 transition-colors flex-1"
                  >
                    <FiUploadCloud size={14} /> {fileName || "Choose File..."}
                  </button>
                  {fileName && (
                    <button
                      type="button"
                      onClick={handleClearUpload}
                      className="p-2.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition-colors"
                      title="Clear"
                    >
                      <FiX size={14} />
                    </button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xls,.xlsx"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </div>
            </div>

            {parseError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-xl p-3 mb-4">
                {parseError}
              </div>
            )}

            {parsedPreview && (
              <div className="border-t border-slate-100 pt-4 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block">Bank</span>
                    <span className="text-xs font-bold text-slate-800 block mt-0.5 truncate">{parsedPreview.bankName || "—"}</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block">Account No.</span>
                    <span className="text-xs font-bold text-slate-800 block mt-0.5 font-mono">{parsedPreview.accountNumber || "—"}</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block">Period</span>
                    <span className="text-xs font-bold text-slate-800 block mt-0.5">
                      {parsedPreview.statementPeriodFrom || "—"} to {parsedPreview.statementPeriodTo || "—"}
                    </span>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block">Transactions</span>
                    <span className="text-xs font-bold text-slate-800 block mt-0.5">{parsedPreview.transactions.length}</span>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                    <span className="text-[9px] font-black uppercase text-emerald-600 tracking-wider block">Opening Balance</span>
                    <span className="text-xs font-bold text-emerald-800 block mt-0.5">₹{formatMoney(parsedPreview.openingBalance)}</span>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                    <span className="text-[9px] font-black uppercase text-blue-600 tracking-wider block">Closing Balance</span>
                    <span className="text-xs font-bold text-blue-800 block mt-0.5">₹{formatMoney(parsedPreview.closingBalance)}</span>
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                    <span className="text-[9px] font-black uppercase text-red-600 tracking-wider block">Total Debit</span>
                    <span className="text-xs font-bold text-red-800 block mt-0.5">₹{formatMoney(parsedPreview.totalDebit)}</span>
                  </div>
                  <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                    <span className="text-[9px] font-black uppercase text-orange-600 tracking-wider block">Total Credit</span>
                    <span className="text-xs font-bold text-orange-800 block mt-0.5">₹{formatMoney(parsedPreview.totalCredit)}</span>
                  </div>
                </div>

                {!parsedPreview.accountNumber && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-bold rounded-xl p-3">
                    Couldn't detect an account number in this file — if this firm already has a statement without one, this upload will merge into it. Double-check the account number above before saving.
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleSaveStatement}
                  disabled={!selectedFirmId || isSaving || parsedPreview.transactions.length === 0}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black uppercase text-xs tracking-wider py-3 px-6 rounded-xl transition-all flex items-center gap-2 shadow-md shadow-blue-600/20"
                >
                  <FiCheckCircle size={14} /> {isSaving ? "Saving..." : !selectedFirmId ? "Select a Firm to Save" : "Save Statement"}
                </button>
              </div>
            )}
          </div>

          {/* Save Result Banner */}
          {saveResult && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-xs font-black">
                  <FiCheckCircle size={14} />
                  {saveResult.addedCount} new {saveResult.addedCount === 1 ? "entry" : "entries"} added
                  {saveResult.duplicateCount > 0 && (
                    <span className="text-slate-500 font-bold normal-case">
                      &nbsp;• {saveResult.duplicateCount} duplicate {saveResult.duplicateCount === 1 ? "entry" : "entries"} skipped
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setSaveResult(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  <FiX size={14} />
                </button>
              </div>

              {saveResult.gaps.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
                  <p className="text-xs font-black text-red-700 flex items-center gap-1.5 uppercase tracking-wide">
                    <FiAlertTriangle size={14} /> {saveResult.gaps.length} missing {saveResult.gaps.length === 1 ? "entry" : "entries"} detected
                  </p>
                  <p className="text-[11px] text-red-600">
                    The balance doesn't carry forward correctly between these transactions — some entries in between are not on file yet.
                  </p>
                  <div className="space-y-1.5 pt-1">
                    {saveResult.gaps.map((g, idx) => (
                      <div key={idx} className="bg-white border border-red-200 rounded-lg p-2.5 text-[11px]">
                        <span className="font-bold text-slate-700">{g.afterDate}</span>
                        <span className="text-slate-400"> (₹{formatMoney(g.afterBalance)}) </span>
                        <span className="text-red-600 font-bold">→ gap →</span>
                        <span className="text-slate-400"> </span>
                        <span className="font-bold text-slate-700">{g.beforeDate}</span>
                        <span className="text-slate-400"> (₹{formatMoney(g.beforeBalance)})</span>
                        <span className="text-red-600 font-bold"> — expected ₹{formatMoney(g.expectedBalance)}, off by ₹{formatMoney(Math.abs(g.difference))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Statements Library */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                <FiFileText className="text-blue-600" size={14} /> Uploaded Statements
                <span className="bg-slate-100 text-slate-600 text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">
                  {filteredStatements.length}
                </span>
              </h3>
              <select
                value={libraryFirmFilter}
                onChange={(e) => setLibraryFirmFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs text-slate-700 focus:outline-none focus:border-blue-500 font-bold"
              >
                <option value="">All Firms</option>
                {companies.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.firmName}
                  </option>
                ))}
              </select>
            </div>

            {loadingStatements ? (
              <div className="flex justify-center items-center py-12">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-blue-500"></div>
              </div>
            ) : filteredStatements.length === 0 ? (
              <div className="text-center py-12 text-slate-400 space-y-2">
                <FiFileText className="mx-auto text-2xl text-slate-300" />
                <p className="text-xs uppercase font-black tracking-widest">No statements uploaded yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                      <th className="py-3 px-5">Firm</th>
                      <th className="py-3 px-5">Bank</th>
                      <th className="py-3 px-5">Account No.</th>
                      <th className="py-3 px-5 text-center">Entries</th>
                      <th className="py-3 px-5 text-right">Closing Balance</th>
                      <th className="py-3 px-5 text-center">Status</th>
                      <th className="py-3 px-5 text-center">Last Updated</th>
                      <th className="py-3 px-5 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredStatements.map((s) => (
                      <tr key={s._id} className="hover:bg-blue-50/40 transition-colors">
                        <td className="py-3.5 px-5 font-bold text-slate-800">{s.firmName || "—"}</td>
                        <td className="py-3.5 px-5 text-slate-600">{s.bankName || "—"}</td>
                        <td className="py-3.5 px-5 font-mono text-slate-600">{s.accountNumber || "—"}</td>
                        <td className="py-3.5 px-5 text-center font-mono text-slate-600">{s.transactions?.length || 0}</td>
                        <td className="py-3.5 px-5 text-right font-mono font-bold text-slate-800">₹{formatMoney(s.closingBalance)}</td>
                        <td className="py-3.5 px-5 text-center">
                          {s.gaps && s.gaps.length > 0 ? (
                            <span className="inline-flex items-center gap-1 bg-red-50 border border-red-200 text-red-700 text-[9px] font-black uppercase px-2 py-1 rounded-full">
                              <FiAlertTriangle size={10} /> {s.gaps.length} gap{s.gaps.length > 1 ? "s" : ""}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[9px] font-black uppercase px-2 py-1 rounded-full">
                              <FiCheckCircle size={10} /> Continuous
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-5 text-center font-mono text-slate-500">
                          {s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : "—"}
                        </td>
                        <td className="py-3.5 px-5">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => {
                                setViewingStatement(s);
                                setTxnSearch("");
                              }}
                              className="p-2 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 transition-colors"
                              title="View Transactions"
                            >
                              <FiEye size={13} />
                            </button>
                            <button
                              onClick={() => handleDeleteStatement(s._id)}
                              className="p-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition-colors"
                              title="Delete Statement"
                            >
                              <FiTrash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* View Statement Modal */}
      {viewingStatement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">
                  {viewingStatement.firmName} — {viewingStatement.bankName}
                </h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">
                  A/C {viewingStatement.accountNumber} • {viewingStatement.transactions.length} entries
                </p>
              </div>
              <button
                onClick={() => setViewingStatement(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <FiX size={18} />
              </button>
            </div>

            <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-slate-100">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                <span className="text-[9px] font-black uppercase text-emerald-600 tracking-wider block">Opening</span>
                <span className="text-xs font-bold text-emerald-800 block mt-0.5">₹{formatMoney(viewingStatement.openingBalance)}</span>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                <span className="text-[9px] font-black uppercase text-blue-600 tracking-wider block">Closing</span>
                <span className="text-xs font-bold text-blue-800 block mt-0.5">₹{formatMoney(viewingStatement.closingBalance)}</span>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                <span className="text-[9px] font-black uppercase text-red-600 tracking-wider block">Total Debit</span>
                <span className="text-xs font-bold text-red-800 block mt-0.5">₹{formatMoney(viewingStatement.totalDebit)}</span>
              </div>
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                <span className="text-[9px] font-black uppercase text-orange-600 tracking-wider block">Total Credit</span>
                <span className="text-xs font-bold text-orange-800 block mt-0.5">₹{formatMoney(viewingStatement.totalCredit)}</span>
              </div>
            </div>

            {viewingStatement.gaps && viewingStatement.gaps.length > 0 && (
              <div className="mx-5 mt-4 bg-red-50 border border-red-200 rounded-xl p-3.5">
                <p className="text-[11px] font-black text-red-700 flex items-center gap-1.5 uppercase tracking-wide mb-1.5">
                  <FiAlertTriangle size={13} /> {viewingStatement.gaps.length} missing {viewingStatement.gaps.length === 1 ? "entry" : "entries"} detected
                </p>
                <div className="space-y-1">
                  {viewingStatement.gaps.map((g, idx) => (
                    <p key={idx} className="text-[11px] text-red-700">
                      Between <span className="font-bold">{g.afterDate}</span> and <span className="font-bold">{g.beforeDate}</span> — balance jumps unexpectedly by ₹{formatMoney(Math.abs(g.difference))}
                    </p>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 px-5 pt-4">
              <div className="relative flex-1">
                <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                <input
                  type="text"
                  placeholder="Search description, date or cheque no..."
                  value={txnSearch}
                  onChange={(e) => setTxnSearch(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-3 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 font-semibold"
                />
              </div>
              {viewingStatement.uploadHistory && viewingStatement.uploadHistory.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowUploadHistoryFor((prev) => (prev === viewingStatement._id ? null : viewingStatement._id))}
                  className="flex items-center gap-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl py-2 px-3 text-[11px] font-bold text-slate-600 transition-colors shrink-0"
                >
                  <FiClock size={12} /> Upload History ({viewingStatement.uploadHistory.length})
                </button>
              )}
            </div>

            {showUploadHistoryFor === viewingStatement._id && (
              <div className="mx-5 mt-2 bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-32 overflow-y-auto space-y-1.5">
                {viewingStatement.uploadHistory
                  .slice()
                  .reverse()
                  .map((u, idx) => (
                    <div key={idx} className="flex items-center justify-between text-[11px] text-slate-600">
                      <span className="font-bold text-slate-800 truncate max-w-[200px]">{u.fileName || "Unnamed file"}</span>
                      <span>{u.addedCount} added{u.duplicateCount > 0 ? `, ${u.duplicateCount} duplicate` : ""}</span>
                      <span className="text-slate-400">{u.uploadedAt ? new Date(u.uploadedAt).toLocaleString() : ""}</span>
                    </div>
                  ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-5 pt-3 custom-scrollbar">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200 sticky top-0">
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Description</th>
                    <th className="py-2.5 px-3">Matched Institute</th>
                    <th className="py-2.5 px-3 text-right">Debit</th>
                    <th className="py-2.5 px-3 text-right">Credit</th>
                    <th className="py-2.5 px-3">Cheque No</th>
                    <th className="py-2.5 px-3 text-right">Balance</th>
                    <th className="py-2.5 px-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-8 text-slate-400 text-xs font-bold uppercase tracking-widest">
                        No matching transactions
                      </td>
                    </tr>
                  ) : (
                    filteredTransactions.map((t, idx) => {
                      const gapBefore = viewingStatement.gaps?.find(
                        (g) => g.beforeDate === t.date && g.beforeDescription === t.description
                      );
                      const matchedInstitute = t.credit > 0 ? matchInstituteFromDescription(t.description, sellers) : null;
                      return (
                        <Fragment key={idx}>
                          {gapBefore && (
                            <tr>
                              <td colSpan={9} className="py-2 px-3 bg-red-50 border-y border-red-200 text-red-700 text-[10px] font-black uppercase tracking-wide">
                                <FiAlertTriangle className="inline mr-1.5" size={11} />
                                Gap — expected ₹{formatMoney(gapBefore.expectedBalance)} here, entries missing
                              </td>
                            </tr>
                          )}
                          <tr className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 text-slate-400 font-mono">{t.sno || idx + 1}</td>
                            <td className="py-2.5 px-3 font-mono text-slate-700">{t.date}</td>
                            <td className="py-2.5 px-3 text-slate-700">{t.description || "—"}</td>
                            <td className="py-2.5 px-3">
                              {matchedInstitute ? (
                                <span className="bg-purple-50 border border-purple-200 text-purple-700 text-[10px] font-black px-2 py-0.5 rounded-full">
                                  {matchedInstitute}
                                </span>
                              ) : t.credit > 0 ? (
                                <span className="text-slate-300 text-[10px] italic">unmatched</span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-red-600">{t.debit ? formatMoney(t.debit) : "—"}</td>
                            <td className="py-2.5 px-3 text-right font-mono text-orange-600">{t.credit ? formatMoney(t.credit) : "—"}</td>
                            <td className="py-2.5 px-3 font-mono text-slate-500">{t.chequeNo || "—"}</td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-800">{formatMoney(t.balance)}</td>
                            <td className="py-2.5 px-3 text-center">
                              <button
                                onClick={() => handleDeleteTransaction(t)}
                                className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition-colors"
                                title="Delete this entry"
                              >
                                <FiTrash2 size={12} />
                              </button>
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </BlockGuard>
  );
}
