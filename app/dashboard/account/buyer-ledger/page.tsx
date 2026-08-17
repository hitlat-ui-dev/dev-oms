"use client";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { FiArrowLeft, FiBookOpen, FiSearch, FiDownload } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import { matchInstituteFromDescription, SellerLite } from "@/lib/institutMatcher";
import * as XLSX from "xlsx";

interface Order {
  _id: string;
  orderNo: string;
  firmCode: string;
  instituteName: string;
  contractDate: string;
  totalAmount: number;
  isPaid: boolean;
}

interface StatementTransaction {
  date: string;
  description: string;
  debit: number;
  credit: number;
}

interface StatementRecord {
  _id: string;
  firmCode: string;
  bankName: string;
  transactions: StatementTransaction[];
}

interface LedgerEntry {
  key: string;
  date: string;
  type: "Sale" | "Receipt";
  voucherNo: string;
  accountName: string;
  debit: number;
  credit: number;
  isPaid?: boolean;
}

interface PartySummary {
  instituteName: string;
  totalBilled: number;
  pendingAmount: number;
  totalReceived: number;
  totalTDS: number;
  totalGST: number;
  totalKasar: number;
}

const formatMoney = (n: number) =>
  Math.abs(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BuyerLedgerPage() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [sellers, setSellers] = useState<SellerLite[]>([]);
  const [institutes, setInstitutes] = useState<string[]>([]);
  const [selectedInstitute, setSelectedInstitute] = useState("");
  const [instituteSearch, setInstituteSearch] = useState("");
  const [firmFilter, setFirmFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [statements, setStatements] = useState<StatementRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [partySummary, setPartySummary] = useState<PartySummary | null>(null);

  useEffect(() => {
    fetch("/api/companies")
      .then((res) => res.json())
      .then((data) => setCompanies(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load firms", err));

    fetch("/api/sellers")
      .then((res) => res.json())
      .then((data) => setSellers(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load sellers", err));

    fetch("/api/account-ledger")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setInstitutes(data.map((r: any) => r.instituteName).sort());
      })
      .catch((err) => console.error("Failed to load institutes", err));

    fetch("/api/account-statements")
      .then((res) => res.json())
      .then((data) => setStatements(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load statements", err));
  }, []);

  useEffect(() => {
    if (!selectedInstitute) {
      setOrders([]);
      return;
    }
    setLoading(true);
    // Full order history is always fetched (no date bounds here) so the running
    // balance can be computed correctly before slicing to the selected date range.
    const params = new URLSearchParams({ instituteName: selectedInstitute });
    if (firmFilter) params.set("firmCode", firmFilter);

    fetch(`/api/account-ledger/transactions?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => setOrders(Array.isArray(data.orders) ? data.orders : []))
      .catch((err) => console.error("Failed to load ledger transactions", err))
      .finally(() => setLoading(false));
  }, [selectedInstitute, firmFilter]);

  useEffect(() => {
    if (!selectedInstitute) {
      setPartySummary(null);
      return;
    }
    const params = new URLSearchParams({ instituteName: selectedInstitute });
    if (firmFilter) params.set("firmCode", firmFilter);
    fetch(`/api/reconciliation/party-summary?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => setPartySummary(Array.isArray(data) ? data[0] || null : null))
      .catch((err) => console.error("Failed to load party summary", err));
  }, [selectedInstitute, firmFilter]);

  const firmNameByCode = useMemo(() => {
    const map: Record<string, string> = {};
    companies.forEach((c) => {
      if (c.firmCode) map[c.firmCode] = c.firmName || c.firmCode;
    });
    return map;
  }, [companies]);

  const filteredInstitutes = useMemo(() => {
    const q = instituteSearch.trim().toLowerCase();
    if (!q) return institutes;
    return institutes.filter((name) => name.toLowerCase().includes(q));
  }, [institutes, instituteSearch]);

  const selectedSeller = useMemo(
    () => sellers.find((s) => s.instituteName === selectedInstitute) || null,
    [sellers, selectedInstitute]
  );

  // Bank statement credits that mention this institute's registered "Statement
  // Description Name" tags — these are the REAL receipts, with real dates/amounts,
  // matched via the naming set up on the Update Seller page.
  const matchedReceipts = useMemo(() => {
    if (!selectedInstitute || !selectedSeller) return [];
    const relevantStatements = firmFilter ? statements.filter((s) => s.firmCode === firmFilter) : statements;
    const entries: LedgerEntry[] = [];
    relevantStatements.forEach((stmt) => {
      (stmt.transactions || []).forEach((t, idx) => {
        if (!t.credit) return;
        const matched = matchInstituteFromDescription(t.description, [selectedSeller]);
        if (matched === selectedInstitute) {
          entries.push({
            key: `receipt-${stmt._id}-${idx}`,
            date: t.date,
            type: "Receipt",
            voucherNo: t.description.slice(0, 24),
            accountName: firmNameByCode[stmt.firmCode] || stmt.bankName || stmt.firmCode,
            debit: 0,
            credit: t.credit,
          });
        }
      });
    });
    return entries;
  }, [selectedInstitute, selectedSeller, statements, firmFilter, firmNameByCode]);

  const saleEntries = useMemo<LedgerEntry[]>(
    () =>
      orders.map((o) => ({
        key: `sale-${o._id}`,
        date: o.contractDate || "",
        type: "Sale",
        voucherNo: o.orderNo || "",
        accountName: firmNameByCode[o.firmCode] || o.firmCode || "—",
        debit: Number(o.totalAmount) || 0,
        credit: 0,
        isPaid: o.isPaid,
      })),
    [orders, firmNameByCode]
  );

  // Full chronological history (unbounded) so the running balance carries forward correctly
  const fullHistory = useMemo(
    () => [...saleEntries, ...matchedReceipts].sort((a, b) => a.date.localeCompare(b.date)),
    [saleEntries, matchedReceipts]
  );

  const { openingBalance, visibleRows, closingBalance, totals } = useMemo(() => {
    let running = 0;
    let opening = 0;
    const rows: (LedgerEntry & { balance: number })[] = [];
    for (const entry of fullHistory) {
      const beforeThisRow = (fromDate && entry.date < fromDate) || false;
      running = running + entry.debit - entry.credit;
      if (beforeThisRow) {
        opening = running;
        continue;
      }
      if (toDate && entry.date > toDate) continue;
      rows.push({ ...entry, balance: running });
    }
    const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
    const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
    return {
      openingBalance: opening,
      visibleRows: rows,
      closingBalance: rows.length > 0 ? rows[rows.length - 1].balance : opening,
      totals: { debit: totalDebit, credit: totalCredit },
    };
  }, [fullHistory, fromDate, toDate]);

  const handleExportLedger = () => {
    if (!selectedInstitute || visibleRows.length === 0) {
      alert("No ledger data available to export with the current filters.");
      return;
    }

    const reportData = [
      {
        Date: "",
        Type: "Opening Balance",
        "Vou/Doc No.": "",
        "Account Name (Firm)": "",
        Debit: "",
        Credit: "",
        "Closing Balance": openingBalance === 0 ? "NIL" : `${formatMoney(openingBalance)} ${openingBalance >= 0 ? "DB" : "CR"}`,
      },
      ...visibleRows.map((row) => ({
        Date: row.date || "",
        Type: row.type,
        "Vou/Doc No.": row.voucherNo || "",
        "Account Name (Firm)": row.accountName,
        Debit: row.debit || "",
        Credit: row.credit || "",
        "Closing Balance": `${formatMoney(row.balance)} ${row.balance >= 0 ? "DB" : "CR"}`,
      })),
      {
        Date: "",
        Type: "TOTAL",
        "Vou/Doc No.": "",
        "Account Name (Firm)": "",
        Debit: totals.debit,
        Credit: totals.credit,
        "Closing Balance": `${formatMoney(closingBalance)} ${closingBalance >= 0 ? "DB" : "CR"}`,
      },
    ];

    const ws = XLSX.utils.json_to_sheet(reportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Buyer Ledger");

    const dateSuffix = fromDate || toDate ? `_${fromDate || "start"}_to_${toDate || "today"}` : "";
    const safeName = selectedInstitute.replace(/[^a-z0-9]/gi, "_");
    XLSX.writeFile(wb, `Buyer_Ledger_${safeName}${dateSuffix}.xlsx`);
  };

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
        <div className="max-w-6xl mx-auto flex flex-col gap-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <Link href="/dashboard/account" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
                <FiArrowLeft /> Back to Account
              </Link>
              <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
                <FiBookOpen className="text-blue-600" /> Buyer Ledger
              </h1>
              <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
                Institute-wise Running Account Ledger
              </p>
            </div>
            <button
              onClick={handleExportLedger}
              disabled={!selectedInstitute || visibleRows.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-black text-[11px] uppercase tracking-widest transition-all active:scale-95 shadow-sm"
            >
              <FiDownload size={14} /> Export to Excel
            </button>
          </div>

          {/* Filters */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="flex flex-col gap-1 lg:col-span-2">
              <label className="text-[9px] font-black uppercase tracking-wider text-slate-500">Institute (Buyer)</label>
              <div className="relative">
                <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                <input
                  type="text"
                  list="institute-options"
                  placeholder="Search & select institute..."
                  value={selectedInstitute || instituteSearch}
                  onChange={(e) => {
                    setInstituteSearch(e.target.value);
                    if (institutes.includes(e.target.value)) setSelectedInstitute(e.target.value);
                    else setSelectedInstitute("");
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-9 pr-3 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 font-bold"
                />
                <datalist id="institute-options">
                  {filteredInstitutes.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-black uppercase tracking-wider text-slate-500">Firm</label>
              <select
                value={firmFilter}
                onChange={(e) => setFirmFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs text-slate-900 focus:outline-none focus:border-blue-500 font-bold"
              >
                <option value="">All Firms</option>
                {companies.map((c) => (
                  <option key={c._id} value={c.firmCode}>
                    {c.firmName} {c.firmCode ? `(${c.firmCode})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-black uppercase tracking-wider text-slate-500">From — To</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-2 text-[11px] text-slate-900 focus:outline-none focus:border-blue-500"
                />
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-2 text-[11px] text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {selectedInstitute && !selectedSeller?.statementDescriptionName?.length && (
            <div className="bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-bold rounded-xl p-3">
              This institute has no "Statement Description Name" set on its Seller record yet, so bank
              statement receipts can't be matched to it — only order-based Sale entries are shown below.
              Add its statement wording under Orders → Add Seller to enable receipt matching.
            </div>
          )}

          {selectedInstitute && partySummary && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-white border border-slate-200 rounded-xl p-3">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block">Total Billed</span>
                <span className="text-sm font-black text-slate-800 block mt-0.5">₹{formatMoney(partySummary.totalBilled)}</span>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                <span className="text-[9px] font-black uppercase text-emerald-600 tracking-wider block">Total Received</span>
                <span className="text-sm font-black text-emerald-800 block mt-0.5">₹{formatMoney(partySummary.totalReceived)}</span>
              </div>
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                <span className="text-[9px] font-black uppercase text-orange-600 tracking-wider block">Total TDS</span>
                <span className="text-sm font-black text-orange-800 block mt-0.5">₹{formatMoney(partySummary.totalTDS)}</span>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-3">
                <span className="text-[9px] font-black uppercase text-purple-600 tracking-wider block">Total GST</span>
                <span className="text-sm font-black text-purple-800 block mt-0.5">₹{formatMoney(partySummary.totalGST)}</span>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <span className="text-[9px] font-black uppercase text-amber-600 tracking-wider block">Total Kasar</span>
                <span className="text-sm font-black text-amber-800 block mt-0.5">₹{formatMoney(partySummary.totalKasar)}</span>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                <span className="text-[9px] font-black uppercase text-red-600 tracking-wider block">Pending</span>
                <span className="text-sm font-black text-red-800 block mt-0.5">₹{formatMoney(partySummary.pendingAmount)}</span>
              </div>
            </div>
          )}

          {!selectedInstitute ? (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm py-16 text-center text-slate-400 space-y-2">
              <FiBookOpen className="mx-auto text-2xl text-slate-300" />
              <p className="text-xs uppercase font-black tracking-widest">Select an institute to view its ledger</p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              {/* Tally-style ledger header */}
              <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Ledger</span>
                  <h3 className="text-sm font-black text-slate-900">{selectedInstitute}</h3>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block">Group</span>
                  <span className="text-xs font-bold text-slate-700">Sundry Debtors</span>
                </div>
              </div>

              {loading ? (
                <div className="flex justify-center items-center py-12">
                  <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-blue-500"></div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                        <th className="py-2.5 px-4">Date</th>
                        <th className="py-2.5 px-4">Type</th>
                        <th className="py-2.5 px-4">Vou/Doc No.</th>
                        <th className="py-2.5 px-4">Account Name (Firm)</th>
                        <th className="py-2.5 px-4 text-right">Debit</th>
                        <th className="py-2.5 px-4 text-right">Credit</th>
                        <th className="py-2.5 px-4 text-right">Closing Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <tr className="bg-slate-50/60">
                        <td colSpan={4} className="py-2 px-4 font-bold text-slate-500 uppercase text-[10px] tracking-wide">
                          Opening Balance
                        </td>
                        <td className="py-2 px-4"></td>
                        <td className="py-2 px-4"></td>
                        <td className="py-2 px-4 text-right font-mono font-bold text-slate-700">
                          {openingBalance === 0
                            ? "NIL"
                            : `₹${formatMoney(openingBalance)} ${openingBalance >= 0 ? "DB" : "CR"}`}
                        </td>
                      </tr>

                      {visibleRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="text-center py-8 text-slate-400 text-xs font-bold uppercase tracking-widest">
                            No transactions in this period
                          </td>
                        </tr>
                      ) : (
                        visibleRows.map((row) => (
                          <tr key={row.key} className="hover:bg-blue-50/40 transition-colors">
                            <td className="py-2.5 px-4 font-mono text-slate-600">{row.date || "—"}</td>
                            <td className="py-2.5 px-4">
                              <span
                                className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                                  row.type === "Receipt"
                                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                    : "bg-blue-50 text-blue-700 border border-blue-200"
                                }`}
                              >
                                {row.type}
                              </span>
                              {row.type === "Sale" && row.isPaid && (
                                <span className="ml-1.5 text-[9px] font-black text-emerald-600 uppercase">✓ paid</span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 font-mono text-slate-600 max-w-[220px] truncate" title={row.voucherNo}>
                              {row.voucherNo || "—"}
                            </td>
                            <td className="py-2.5 px-4 text-slate-700">{row.accountName}</td>
                            <td className="py-2.5 px-4 text-right font-mono text-red-600">{row.debit ? formatMoney(row.debit) : ""}</td>
                            <td className="py-2.5 px-4 text-right font-mono text-emerald-600">{row.credit ? formatMoney(row.credit) : ""}</td>
                            <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-800">
                              ₹{formatMoney(row.balance)} {row.balance >= 0 ? "DB" : "CR"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-100 border-t-2 border-slate-300">
                        <td colSpan={4} className="py-3 px-4 font-black text-slate-700 uppercase text-[10px] tracking-wide">
                          Total
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-black text-red-700">₹{formatMoney(totals.debit)}</td>
                        <td className="py-3 px-4 text-right font-mono font-black text-emerald-700">₹{formatMoney(totals.credit)}</td>
                        <td className="py-3 px-4 text-right font-mono font-black text-slate-900">
                          ₹{formatMoney(closingBalance)} {closingBalance >= 0 ? "DB" : "CR"}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          <p className="text-[10px] text-slate-400 leading-relaxed px-1">
            "Receipt" rows come from actual bank statement credits matched to this institute via its "Statement
            Description Name" tags (set on the Update Seller page) — real dates and amounts, not estimated. Orders
            still marked "Paid" but with no matching bank receipt yet are flagged "✓ paid" for reference but don't
            reduce the balance until a matching receipt is found, so Closing Balance always reflects real cash received.
          </p>
        </div>
      </div>
    </BlockGuard>
  );
}
