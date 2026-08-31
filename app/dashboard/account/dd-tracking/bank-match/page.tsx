"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { FiArrowLeft, FiLink, FiChevronDown, FiChevronUp, FiCheckCircle } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

interface DDEntry {
  _id: string;
  ddNumber: string;
  amount: number;
  payeeName: string;
  firmBankAccount: { firmCode: string; bankName: string; accountNumber: string };
  tenderReference: string;
  cancellationCharge?: number;
}

interface Candidate {
  statementId: string;
  txnKey: string;
  date: string;
  description: string;
  credit: number;
  balance: number;
  score: number;
  reasons: string[];
  bankName: string;
  accountNumber: string;
}

const fmtMoney = (n: number) => (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function scorePill(score: number) {
  if (score >= 70) return "bg-emerald-100 text-emerald-800 border-emerald-300";
  if (score >= 40) return "bg-amber-100 text-amber-800 border-amber-300";
  return "bg-slate-100 text-slate-600 border-slate-300";
}

export default function BankMatchPage() {
  const [entries, setEntries] = useState<DDEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidateNote, setCandidateNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/dd-entries?status=returned_cancelled")
      .then((r) => r.json())
      .then((d) => setEntries(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleExpand = async (entry: DDEntry) => {
    if (expandedId === entry._id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(entry._id);
    setCandidates([]);
    setCandidateNote(null);
    setCandidatesLoading(true);
    try {
      const res = await fetch(`/api/dd-entries/${entry._id}/match-candidates`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load candidates");
      setCandidates(data.candidates || []);
      if (data.note) setCandidateNote(data.note);
    } catch (err: any) {
      setCandidateNote(err.message || "Failed to load candidates");
    } finally {
      setCandidatesLoading(false);
    }
  };

  const confirmMatch = async (entryId: string, candidate: Candidate) => {
    if (!confirm(`Confirm this bank entry (₹${fmtMoney(candidate.credit)} on ${candidate.date}) as the refund for this DD?`)) return;
    setConfirming(candidate.txnKey);
    try {
      const res = await fetch(`/api/dd-entries/${entryId}/confirm-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statementId: candidate.statementId, txnKey: candidate.txnKey, date: candidate.date }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to confirm match");
      setExpandedId(null);
      load();
    } catch (err: any) {
      alert(err.message || "Failed to confirm match");
    } finally {
      setConfirming(null);
    }
  };

  return (
    <BlockGuard permission="accountStatements">
      <div className="p-4 md:p-8 bg-slate-50 min-h-screen">
        <div className="max-w-5xl mx-auto flex flex-col gap-6">
          <div>
            <Link href="/dashboard/account/dd-tracking" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
              <FiArrowLeft /> Back to DD Tracking
            </Link>
            <h1 className="text-xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
              <FiLink className="text-emerald-600" /> Bank Match — DD Refunds
            </h1>
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
              {entries.length} DDs waiting for a matched refund credit
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-5 w-5 border-t-2 border-blue-500"></div></div>
          ) : entries.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm py-10 text-center text-slate-400 text-xs uppercase font-bold tracking-widest">
              No DDs currently need refund matching
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {entries.map((entry) => (
                <div key={entry._id} className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                  <button onClick={() => toggleExpand(entry)} className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-50 transition-colors">
                    <div>
                      <p className="font-black text-slate-800 text-sm">{entry.ddNumber} — {entry.payeeName}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">
                        {entry.firmBankAccount?.firmCode} · {entry.tenderReference} · ₹{fmtMoney(entry.amount)}
                        {entry.cancellationCharge ? ` (net expected ≈ ₹${fmtMoney(entry.amount - entry.cancellationCharge)})` : ""}
                      </p>
                    </div>
                    {expandedId === entry._id ? <FiChevronUp /> : <FiChevronDown />}
                  </button>

                  {expandedId === entry._id && (
                    <div className="border-t border-slate-100 p-4 bg-slate-50/50">
                      {candidatesLoading ? (
                        <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-4 w-4 border-t-2 border-blue-500"></div></div>
                      ) : candidates.length === 0 ? (
                        <p className="text-xs text-slate-400 uppercase font-bold tracking-widest text-center py-4">
                          {candidateNote || "No matching bank entries found yet"}
                        </p>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {candidateNote && <p className="text-[10px] font-bold text-slate-400 mb-1">{candidateNote}</p>}
                          {candidates.map((c) => (
                            <div key={c.txnKey} className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl p-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`inline-block border text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${scorePill(c.score)}`}>
                                    {c.score}% match
                                  </span>
                                  <span className="text-[11px] font-bold text-slate-500">{c.date}</span>
                                  <span className="text-xs font-black text-emerald-700">₹{fmtMoney(c.credit)}</span>
                                </div>
                                <p className="text-[11px] text-slate-600 truncate mt-1" title={c.description}>{c.description}</p>
                                {c.reasons.length > 0 && (
                                  <p className="text-[10px] text-slate-400 mt-0.5">{c.reasons.join(" · ")}</p>
                                )}
                              </div>
                              <button
                                onClick={() => confirmMatch(entry._id, c)}
                                disabled={confirming === c.txnKey}
                                className="shrink-0 flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg py-1.5 px-3 text-[10px] font-black uppercase tracking-wide"
                              >
                                <FiCheckCircle size={12} /> Confirm
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </BlockGuard>
  );
}
