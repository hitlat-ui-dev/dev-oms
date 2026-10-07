"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FiArrowLeft, FiPercent } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import { guessInstituteForAddress, SellerLite } from "@/lib/gemBids/instituteMatch";

interface Company {
  _id: string;
  firmName: string;
  firmCode?: string;
}

interface BoqRateRow {
  itemNumber: string;
  itemTitle: string;
  rate: string;
  quantity?: string;
}

interface FinalRateBid {
  _id: string;
  bidNo: string;
  items?: string;
  address?: string;
  departmentNameAndAddress?: string;
  bidLink?: string;
  buyerAddedBidSpecificAtcUrl?: string;
  bidToRaEnabled?: string;
  raQualificationRule?: string;
  typeOfBid?: string;
  evaluationMethod?: string;
  emdAmount?: string;
  selectedPartyIds?: string[];
  selectedPartyId?: string | null;
  boqRates: BoqRateRow[];
  itemsRated: number;
  finalTotal: number;
}

// Read-only summary of every bid that's had its rates filled and saved in
// Bid Rate's Rate tab (see /api/gem-bids/boq/save) - what's actually been
// quoted so far, across every bid, without opening each one individually.
// Replaces the Rate Variant Tool's old slot in the GeM Bids page's nav
// (that tool moved into Bid Rate itself, as its own tab, now that it's
// meant to run directly on a bid's own items rather than a separately
// uploaded file - see document-maker/page.tsx's "variant" tab).
export default function FinalRatesPage() {
  const [bids, setBids] = useState<FinalRateBid[]>([]);
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [sellers, setSellers] = useState<SellerLite[]>([]);

  const [bidNoQuery, setBidNoQuery] = useState("");
  const [instituteQuery, setInstituteQuery] = useState("");
  const [firmQuery, setFirmQuery] = useState("");

  useEffect(() => {
    setLoading(true);
    fetch("/api/gem-bids/final-rates")
      .then((res) => res.json())
      .then((data) => setBids(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load final rates", err))
      .finally(() => setLoading(false));
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

  // Computed once per bid (institute guess, resolved firm names), rather
  // than inline per render, so the same values back both the filter text
  // match below and the actual row rendering without doing the work twice.
  const enrichedBids = useMemo(
    () =>
      bids.map((b) => {
        const matchedInstitute = guessInstituteForAddress(b.departmentNameAndAddress || b.address || "", sellers);
        const partyIds = b.selectedPartyIds?.length ? b.selectedPartyIds : b.selectedPartyId ? [b.selectedPartyId] : [];
        const firmNames = partyIds.map((id) => companyById.get(id)?.firmName).filter(Boolean) as string[];
        return { ...b, matchedInstitute, firmNames };
      }),
    [bids, sellers, companyById]
  );

  const filteredBids = useMemo(() => {
    const bidNoQ = bidNoQuery.trim().toLowerCase();
    const instituteQ = instituteQuery.trim().toLowerCase();
    const firmQ = firmQuery.trim().toLowerCase();
    return enrichedBids.filter((b) => {
      if (bidNoQ && !b.bidNo.toLowerCase().includes(bidNoQ)) return false;
      if (instituteQ && !(b.matchedInstitute || "").toLowerCase().includes(instituteQ)) return false;
      if (firmQ && !b.firmNames.join(", ").toLowerCase().includes(firmQ)) return false;
      return true;
    });
  }, [enrichedBids, bidNoQuery, instituteQuery, firmQuery]);

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
        <div className="max-w-[1400px] mx-auto flex flex-col gap-4">
          <div>
            <Link href="/dashboard/gem-bids" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
              <FiArrowLeft /> Back to GeM Bids
            </Link>
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
              <FiPercent className="text-blue-600" /> Final Rates
            </h1>
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
              Firm-Wise Final Rates Filled In Bid Rate, Across Every Bid
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-3 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
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
                <label className="text-[8px] font-black uppercase text-slate-400 tracking-wider block mb-1">Institute</label>
                <input
                  value={instituteQuery}
                  onChange={(e) => setInstituteQuery(e.target.value)}
                  placeholder="Search Institute..."
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
            </div>
            {loading ? (
              <div className="flex justify-center items-center py-16">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-blue-500"></div>
              </div>
            ) : bids.length === 0 ? (
              <div className="text-center py-16 text-slate-400 text-xs font-bold uppercase tracking-widest">
                No bid has had rates saved yet — fill &amp; save rates from Bid Rate&apos;s Rate tab first.
              </div>
            ) : filteredBids.length === 0 ? (
              <div className="text-center py-16 text-slate-400 text-xs font-bold uppercase tracking-widest">
                No bid matches these filters.
              </div>
            ) : (
              <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: "65vh" }}>
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-2 whitespace-nowrap">Bid No</th>
                      <th className="py-2 px-2">Institute</th>
                      <th className="py-2 px-2 whitespace-nowrap">Bid To RA / RA</th>
                      <th className="py-2 px-2 whitespace-nowrap">Type of Bid</th>
                      <th className="py-2 px-2 whitespace-nowrap">Evaluation / EMD</th>
                      <th className="py-2 px-2 whitespace-nowrap">Bid Doc</th>
                      <th className="py-2 px-2 whitespace-nowrap">ATC</th>
                      <th className="py-2 px-2">Firm</th>
                      <th className="py-2 px-2 text-right whitespace-nowrap">Items Rated</th>
                      <th className="py-2 px-2 text-right whitespace-nowrap">Final Rate</th>
                      <th className="py-2 px-2 w-16"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredBids.map((b) => {
                      const { matchedInstitute, firmNames } = b;
                      return (
                        <tr key={b._id} className="hover:bg-slate-50">
                          <td className="py-2 px-2 font-bold text-slate-700 whitespace-nowrap">
                            <div>{b.bidNo}</div>
                            <div className="text-[10px] font-normal text-slate-400 max-w-[220px] truncate" title={b.items}>
                              {b.items || ""}
                            </div>
                          </td>
                          <td className="py-2 px-2 max-w-[200px] truncate" title={matchedInstitute || ""}>
                            <span className={matchedInstitute ? "text-blue-700 font-bold" : "text-slate-400"}>
                              {matchedInstitute || "No match"}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-slate-600 whitespace-nowrap">
                            {b.bidToRaEnabled || "—"}
                            {b.raQualificationRule ? ` / ${b.raQualificationRule}` : ""}
                          </td>
                          <td className="py-2 px-2 text-slate-600 whitespace-nowrap">{b.typeOfBid || "—"}</td>
                          <td className="py-2 px-2 text-slate-600 whitespace-nowrap">
                            {b.evaluationMethod || "—"}
                            {b.emdAmount ? ` / ${b.emdAmount}` : ""}
                          </td>
                          <td className="py-2 px-2 whitespace-nowrap">
                            {b.bidLink ? (
                              <a href={b.bidLink} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                                Link
                              </a>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-2 px-2 whitespace-nowrap">
                            {b.buyerAddedBidSpecificAtcUrl ? (
                              <a href={b.buyerAddedBidSpecificAtcUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                                Link
                              </a>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-2 px-2 max-w-[180px]">
                            {firmNames.length > 0 ? (
                              <span className="font-bold text-slate-700">{firmNames.join(", ")}</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right text-slate-600 whitespace-nowrap">{b.itemsRated}</td>
                          <td className="py-2 px-2 text-right font-black text-slate-900 whitespace-nowrap">
                            {b.finalTotal ? b.finalTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
                          </td>
                          <td className="py-2 px-2 whitespace-nowrap">
                            <Link
                              href={`/dashboard/gem-bids/document-maker?bidId=${b._id}&tab=rate`}
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
