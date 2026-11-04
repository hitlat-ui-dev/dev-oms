"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FiArrowLeft, FiClipboard } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import { guessInstituteForAddress, SellerLite } from "@/lib/gemBids/instituteMatch";
import { RESULT_OPTIONS } from "@/lib/gemBids/bidSummaryOptions";
import { parseGemDate } from "@/lib/gemBids/expirySweep";

interface Company {
  _id: string;
  firmName: string;
  firmCode?: string;
}

interface BidSummaryBid {
  _id: string;
  bidNo: string;
  bidLink: string;
  bidEndDateTime: string;
  items: string;
  address: string;
  evaluationMethod: string;
  bidToRaEnabled: string;
  raQualificationRule: string;
  partyIds: string[];
  hasRates: boolean;
  baseTotal: number;
  finalRateByParty: Record<string, number>;
  summaryByParty: Record<string, { result?: string; remark?: string }>;
}

interface SummaryRow {
  bid: BidSummaryBid;
  partyId: string | null;
  firmName: string;
  finalRate: number | null;
  result: string;
  remark: string;
}

// One row per firm a bid was actually submitted/assigned under (selectedPartyIds
// in GeM Bids), rather than one row per bid - by request, since the same bid
// often goes in under 2-3 of our own firms at once and each one's own
// Result/Remark (summaryByParty, per firm - see ../../api/gem-bids/bid-summary/route.ts)
// can differ. A bid with no firm assigned yet still gets a single row, just
// with Result/Remark locked (nothing to key the save under until a firm is
// picked from GeM Bids or Bid Rate). Final Rate is the bid's saved BOQ total,
// bumped by that firm's own BOQ Rate Variant % if Bid Rate's Variant tab
// assigned one (boqVariantPartyPercents) - see document-maker/page.tsx's
// persistVariantPercents for where that's saved.
export default function BidSummaryPage() {
  const [bids, setBids] = useState<BidSummaryBid[]>([]);
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [sellers, setSellers] = useState<SellerLite[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  const [bidNoQuery, setBidNoQuery] = useState("");
  const [instituteQuery, setInstituteQuery] = useState("");
  const [firmQuery, setFirmQuery] = useState("");
  const [resultFilter, setResultFilter] = useState("");

  const loadBids = () => {
    setLoading(true);
    fetch("/api/gem-bids/bid-summary")
      .then((res) => res.json())
      .then((data: BidSummaryBid[]) =>
        setBids(
          Array.isArray(data)
            ? [...data].sort((a, b) => (parseGemDate(a.bidEndDateTime)?.getTime() || 0) - (parseGemDate(b.bidEndDateTime)?.getTime() || 0))
            : []
        )
      )
      .catch((err) => console.error("Failed to load bid summary", err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadBids();
    fetch("/api/companies")
      .then((res) => res.json())
      .then((data) => setCompanies(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load firms", err));
    fetch("/api/sellers")
      .then((res) => res.json())
      .then((data) => setSellers(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load sellers", err));
  }, []);

  const companyById = useMemo(() => new Map(companies.map((c) => [c._id, c])), [companies]);

  const rows = useMemo(() => {
    const out: SummaryRow[] = [];
    for (const b of bids) {
      const matchedInstitute = guessInstituteForAddress(b.address || "", sellers);
      const bid = { ...b, address: matchedInstitute || b.address };
      if (b.partyIds.length === 0) {
        out.push({ bid, partyId: null, firmName: "—", finalRate: b.hasRates ? b.baseTotal : null, result: "", remark: "" });
        continue;
      }
      for (const pid of b.partyIds) {
        const summary = b.summaryByParty[pid] || {};
        out.push({
          bid,
          partyId: pid,
          firmName: companyById.get(pid)?.firmName || "Unknown firm",
          finalRate: b.hasRates ? b.finalRateByParty[pid] ?? b.baseTotal : null,
          result: summary.result || "",
          remark: summary.remark || "",
        });
      }
    }
    return out;
  }, [bids, sellers, companyById]);

  const filteredRows = useMemo(() => {
    const bidNoQ = bidNoQuery.trim().toLowerCase();
    const instituteQ = instituteQuery.trim().toLowerCase();
    const firmQ = firmQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (bidNoQ && !r.bid.bidNo.toLowerCase().includes(bidNoQ)) return false;
      if (instituteQ && !r.bid.address.toLowerCase().includes(instituteQ)) return false;
      if (firmQ && !r.firmName.toLowerCase().includes(firmQ)) return false;
      if (resultFilter && r.result !== resultFilter) return false;
      return true;
    });
  }, [rows, bidNoQuery, instituteQuery, firmQuery, resultFilter]);

  const updateSummary = async (bidId: string, partyId: string, field: "result" | "remark", value: string) => {
    const rowKey = `${bidId}:${partyId}:${field}`;
    setSaving(rowKey);
    try {
      await fetch("/api/gem-bids/bid-summary", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidId, partyId, [field]: value }),
      });
      setBids((prev) =>
        prev.map((b) =>
          b._id === bidId
            ? { ...b, summaryByParty: { ...b.summaryByParty, [partyId]: { ...b.summaryByParty[partyId], [field]: value } } }
            : b
        )
      );
    } catch (err) {
      console.error("Failed to save", err);
    } finally {
      setSaving(null);
    }
  };

  return (
    <BlockGuard
      permission="gemBids"
      fallback={
        <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center">
          <p className="text-red-500 font-bold uppercase">You have no Access for this Page.</p>
          <Link href="/dashboard" className="text-sm bg-slate-900 text-white px-4 py-2 mt-4 rounded-lg hover:bg-slate-800 transition-all">
            Go to Dashboard
          </Link>
        </div>
      }
    >
      <div className="p-4 md:p-8 bg-slate-50 min-h-screen">
        <div className="max-w-[1500px] mx-auto flex flex-col gap-4">
          <div>
            <Link href="/dashboard/gem-bids" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
              <FiArrowLeft /> Back to GeM Bids
            </Link>
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
              <FiClipboard className="text-blue-600" /> Bid Summary
            </h1>
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
              One Row Per Firm, With Its Own Result &amp; Remark
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-3 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              <div>
                <label className="text-[8px] font-black uppercase text-slate-400 tracking-wider block mb-1">Bid No</label>
                <input
                  value={bidNoQuery}
                  onChange={(e) => setBidNoQuery(e.target.value)}
                  placeholder="Search Bid No..."
                  className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-[11px] focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-[8px] font-black uppercase text-slate-400 tracking-wider block mb-1">Place</label>
                <input
                  value={instituteQuery}
                  onChange={(e) => setInstituteQuery(e.target.value)}
                  placeholder="Search Place..."
                  className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-[11px] focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-[8px] font-black uppercase text-slate-400 tracking-wider block mb-1">Firm</label>
                <input
                  value={firmQuery}
                  onChange={(e) => setFirmQuery(e.target.value)}
                  placeholder="Search Firm..."
                  className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-[11px] focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-[8px] font-black uppercase text-slate-400 tracking-wider block mb-1">Result</label>
                <select
                  value={resultFilter}
                  onChange={(e) => setResultFilter(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-[11px] focus:outline-none focus:border-blue-500"
                >
                  <option value="">All</option>
                  {RESULT_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {loading ? (
              <div className="flex justify-center items-center py-16">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-blue-500"></div>
              </div>
            ) : bids.length === 0 ? (
              <div className="text-center py-16 text-slate-400 text-xs font-bold uppercase tracking-widest">
                No bids in Bids to Fill / Submitted Bids yet.
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="text-center py-16 text-slate-400 text-xs font-bold uppercase tracking-widest">
                No row matches these filters.
              </div>
            ) : (
              <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: "70vh" }}>
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-2 whitespace-nowrap">Bid No / Last Date</th>
                      <th className="py-2 px-2">Item</th>
                      <th className="py-2 px-2">Place</th>
                      <th className="py-2 px-2 whitespace-nowrap">Evaluation Type</th>
                      <th className="py-2 px-2 whitespace-nowrap">Bid To RA</th>
                      <th className="py-2 px-2">Firm</th>
                      <th className="py-2 px-2 whitespace-nowrap">Result</th>
                      <th className="py-2 px-2">Remark</th>
                      <th className="py-2 px-2 text-right whitespace-nowrap">Final Rate</th>
                      <th className="py-2 px-2 w-16"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredRows.map((r, i) => {
                      const canEdit = !!r.partyId;
                      const rowBg = r.result === "Bid Awarded" ? "bg-emerald-50" : "hover:bg-slate-50";
                      return (
                        <tr key={`${r.bid._id}-${r.partyId || "none"}-${i}`} className={rowBg}>
                          <td className="py-2 px-2 font-bold text-slate-700 whitespace-nowrap align-top">
                            <div>
                              {r.bid.bidLink ? (
                                <a href={r.bid.bidLink} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                                  {r.bid.bidNo}
                                </a>
                              ) : (
                                r.bid.bidNo
                              )}
                            </div>
                            <div className="text-[10px] font-normal text-slate-400">{r.bid.bidEndDateTime || "—"}</div>
                          </td>
                          <td className="py-2 px-2 max-w-[220px] truncate align-top" title={r.bid.items}>
                            {r.bid.items || "—"}
                          </td>
                          <td className="py-2 px-2 max-w-[180px] truncate align-top" title={r.bid.address}>
                            <span className={r.bid.address ? "text-blue-700 font-bold" : "text-slate-400"}>{r.bid.address || "—"}</span>
                          </td>
                          <td className="py-2 px-2 text-slate-600 whitespace-nowrap align-top">{r.bid.evaluationMethod || "—"}</td>
                          <td
                            className="py-2 px-2 text-slate-600 max-w-[140px] truncate align-top"
                            title={[r.bid.bidToRaEnabled, r.bid.raQualificationRule].filter(Boolean).join(" / ")}
                          >
                            {r.bid.bidToRaEnabled || "—"}
                            {r.bid.raQualificationRule ? ` / ${r.bid.raQualificationRule}` : ""}
                          </td>
                          <td className="py-2 px-2 font-bold text-slate-700 max-w-[160px] truncate align-top" title={r.firmName}>
                            {r.firmName}
                          </td>
                          <td className="py-2 px-2 align-top">
                            <select
                              key={r.result}
                              defaultValue={r.result}
                              disabled={!canEdit || saving === `${r.bid._id}:${r.partyId}:result`}
                              onChange={(e) => updateSummary(r.bid._id, r.partyId as string, "result", e.target.value)}
                              title={canEdit ? undefined : "Assign a party to this bid first"}
                              className="bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[10px] w-32 disabled:opacity-50"
                            >
                              <option value="">—</option>
                              {RESULT_OPTIONS.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 px-2 align-top">
                            <input
                              key={r.remark}
                              defaultValue={r.remark}
                              disabled={!canEdit}
                              placeholder={canEdit ? "Remark..." : ""}
                              onBlur={(e) => {
                                if (e.target.value !== r.remark) updateSummary(r.bid._id, r.partyId as string, "remark", e.target.value);
                              }}
                              className="bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[10px] w-36 disabled:opacity-50"
                            />
                          </td>
                          <td className="py-2 px-2 text-right font-black text-slate-900 whitespace-nowrap align-top">
                            {r.finalRate != null ? r.finalRate.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
                          </td>
                          <td className="py-2 px-2 whitespace-nowrap align-top">
                            <Link
                              href={`/dashboard/gem-bids/document-maker?bidId=${r.bid._id}&tab=rate`}
                              className="text-[10px] font-black uppercase text-amber-700 hover:text-amber-900 underline"
                            >
                              Edit
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </BlockGuard>
  );
}
