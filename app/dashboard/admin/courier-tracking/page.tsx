"use client";
import { useEffect, useState } from "react";
import { FiTruck, FiCheckCircle, FiAlertTriangle, FiRefreshCw, FiPackage, FiSend } from "react-icons/fi";

interface MatchedParcel {
  docketNo: string;
  instituteName: string;
  city: string;
  receiverName: string;
  score: number;
  whatsappNumber?: string;
  whatsappStatus?: "NOT_SENT" | "PENDING" | "SENT" | "FAILED" | "NO_NUMBER";
}

interface ReviewParcel {
  docketNo: string;
  parsedCity: string;
  parsedReceiverName: string;
  bestGuessInstituteName?: string;
  score: number;
  reason: string;
}

interface CourierRunLog {
  _id: string;
  date: string;
  status: "SUCCESS" | "FAILED" | "IN_PROGRESS";
  totalParcels?: number;
  matchedCount?: number;
  needsReviewCount?: number;
  matched?: MatchedParcel[];
  needsReview?: ReviewParcel[];
  timestamp: string;
  error?: string;
  triggeredBy?: string;
}

export default function CourierTrackingPage() {
  const [runLoading, setRunLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error" | null; message: string }>({
    type: null,
    message: "",
  });
  const [selectedDockets, setSelectedDockets] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  const [autoStatus, setAutoStatus] = useState<{
    todayRunCompleted: boolean;
    todayLog: CourierRunLog | null;
    history: CourierRunLog[];
    gmailConfigured: boolean;
    courierSenderConfigured: boolean;
  }>({
    todayRunCompleted: false,
    todayLog: null,
    history: [],
    gmailConfigured: false,
    courierSenderConfigured: false,
  });

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/courier/auto");
      const data = await res.json();
      if (res.ok) {
        setAutoStatus({
          todayRunCompleted: data.todayRunCompleted,
          todayLog: data.todayLog,
          history: data.history || [],
          gmailConfigured: data.gmailConfigured,
          courierSenderConfigured: data.courierSenderConfigured,
        });
      }
    } catch (e) {
      console.error("Failed to fetch courier run status", e);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleRunNow = async () => {
    if (runLoading) return;
    setRunLoading(true);
    setStatus({ type: null, message: "" });
    try {
      const res = await fetch("/api/courier/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus({ type: "success", message: data.message || "Courier run completed." });
        setSelectedDockets(new Set());
        await fetchStatus();
      } else {
        throw new Error(data.error || "Failed to trigger courier run");
      }
    } catch (err: any) {
      setStatus({ type: "error", message: err.message });
    } finally {
      setRunLoading(false);
    }
  };

  const todayLog = autoStatus.todayLog;

  // Only NOT_SENT/FAILED parcels can be selected - PENDING is already
  // queued (waiting on the bridge), SENT is done, NO_NUMBER has nothing to
  // send to.
  const selectableDockets = (todayLog?.matched || [])
    .filter((m) => m.whatsappStatus === "NOT_SENT" || m.whatsappStatus === "FAILED")
    .map((m) => m.docketNo);

  const toggleDocket = (docketNo: string) => {
    setSelectedDockets((prev) => {
      const next = new Set(prev);
      if (next.has(docketNo)) next.delete(docketNo);
      else next.add(docketNo);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedDockets((prev) =>
      prev.size === selectableDockets.length ? new Set() : new Set(selectableDockets)
    );
  };

  const handleSendWhatsApp = async () => {
    if (sending || selectedDockets.size === 0 || !todayLog) return;
    setSending(true);
    setStatus({ type: null, message: "" });
    try {
      const res = await fetch("/api/courier/queue-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: todayLog.date, docketNos: [...selectedDockets] }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus({
          type: "success",
          message: `Queued ${selectedDockets.size} WhatsApp message(s) - the bridge will send them shortly.`,
        });
        setSelectedDockets(new Set());
        await fetchStatus();
      } else {
        throw new Error(data.error || "Failed to queue WhatsApp sends");
      }
    } catch (err: any) {
      setStatus({ type: "error", message: err.message });
    } finally {
      setSending(false);
    }
  };

  return (
      <div className="min-h-screen bg-slate-50 p-6 flex justify-center">
        <div className="max-w-5xl w-full flex flex-col gap-6">
          {/* Header Banner */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="bg-orange-50 p-4 rounded-xl text-orange-600">
                <FiTruck size={28} />
              </div>
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                  Courier Tracking Automation
                </h1>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                  Yesterday&apos;s dispatch register → institute matching
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-end">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${
                  autoStatus.gmailConfigured
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                    : "bg-amber-100 text-amber-800 border border-amber-300"
                }`}
              >
                {autoStatus.gmailConfigured ? "Gmail Connected" : "Gmail Setup Pending"}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${
                  autoStatus.courierSenderConfigured
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                    : "bg-amber-100 text-amber-800 border border-amber-300"
                }`}
              >
                {autoStatus.courierSenderConfigured ? "Courier Sender Set" : "Courier Sender Pending"}
              </span>
            </div>
          </div>

          {status.type === "success" && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3 text-emerald-800 text-xs font-bold leading-normal">
              <FiCheckCircle size={16} className="text-emerald-600 shrink-0 mt-0.5" />
              <span>{status.message}</span>
            </div>
          )}
          {status.type === "error" && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-800 text-xs font-bold leading-normal">
              <FiAlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
              <span>{status.message}</span>
            </div>
          )}

          {/* Today's run summary + Run Now */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-black uppercase text-orange-600 bg-orange-50 px-2.5 py-1 rounded-lg">
                  First-Login Auto-Run
                </span>
                <span className="text-xs text-slate-400 font-medium">Daily, once per calendar day</span>
              </div>

              <p className="text-slate-600 text-xs leading-relaxed mb-4">
                Triggers automatically the first time OMS is opened each day - fetches yesterday&apos;s courier PDF,
                parses each parcel, and matches it to an institute by receiver name + city. WhatsApp sending is
                always manual - select the parcels you want to notify below and press &quot;Send WhatsApp&quot;;
                nothing gets messaged on its own.
              </p>

              <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100 mb-6 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-semibold">Today Status:</span>
                  <span className={`font-black ${autoStatus.todayRunCompleted ? "text-emerald-600" : "text-amber-600"}`}>
                    {autoStatus.todayRunCompleted ? "COMPLETED TODAY" : "PENDING / NOT RUN YET"}
                  </span>
                </div>
                {todayLog && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-semibold">Run Time:</span>
                      <span className="text-slate-700 font-mono">{new Date(todayLog.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-semibold">Total Parcels:</span>
                      <span className="text-slate-700 font-mono">{todayLog.totalParcels ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-semibold">Matched:</span>
                      <span className="text-emerald-700 font-mono">{todayLog.matchedCount ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-semibold">Needs Review:</span>
                      <span className="text-amber-700 font-mono">{todayLog.needsReviewCount ?? 0}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <button
              type="button"
              disabled={runLoading}
              onClick={handleRunNow}
              className="w-full flex items-center justify-center gap-2 bg-orange-600 text-white font-black uppercase text-xs tracking-wider py-3.5 rounded-xl transition-all hover:bg-orange-700 active:scale-[0.98] disabled:opacity-40"
            >
              {runLoading ? (
                <>
                  <FiRefreshCw size={14} className="animate-spin" />
                  <span>Running...</span>
                </>
              ) : (
                <>
                  <FiPackage size={16} />
                  <span>Run Now</span>
                </>
              )}
            </button>
          </div>

          {/* Matched */}
          {todayLog?.matched && todayLog.matched.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                <h3 className="text-sm font-black text-slate-900 uppercase">Matched ({todayLog.matched.length})</h3>
                <button
                  type="button"
                  disabled={selectedDockets.size === 0 || sending}
                  onClick={handleSendWhatsApp}
                  className="flex items-center gap-2 bg-emerald-600 text-white font-black uppercase text-[11px] tracking-wider px-4 py-2.5 rounded-xl transition-all hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {sending ? (
                    <FiRefreshCw size={13} className="animate-spin" />
                  ) : (
                    <FiSend size={13} />
                  )}
                  {sending ? "Queueing..." : `Send WhatsApp (${selectedDockets.size} Selected)`}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-400 uppercase text-[10px] tracking-wide">
                      <th className="pb-2 pr-3 w-8">
                        <input
                          type="checkbox"
                          checked={selectableDockets.length > 0 && selectedDockets.size === selectableDockets.length}
                          onChange={toggleSelectAll}
                          disabled={selectableDockets.length === 0}
                          className="w-3.5 h-3.5"
                        />
                      </th>
                      <th className="pb-2 pr-4">Docket No</th>
                      <th className="pb-2 pr-4">Institute</th>
                      <th className="pb-2 pr-4">City</th>
                      <th className="pb-2 pr-4">Receiver</th>
                      <th className="pb-2 pr-4">Score</th>
                      <th className="pb-2">WhatsApp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {todayLog.matched.map((m) => {
                      const selectable = m.whatsappStatus === "NOT_SENT" || m.whatsappStatus === "FAILED";
                      return (
                        <tr key={m.docketNo}>
                          <td className="py-2 pr-3">
                            <input
                              type="checkbox"
                              checked={selectedDockets.has(m.docketNo)}
                              onChange={() => toggleDocket(m.docketNo)}
                              disabled={!selectable}
                              className="w-3.5 h-3.5"
                            />
                          </td>
                          <td className="py-2 pr-4 font-mono">{m.docketNo}</td>
                          <td className="py-2 pr-4 font-bold text-slate-800">{m.instituteName}</td>
                          <td className="py-2 pr-4 text-slate-500">{m.city}</td>
                          <td className="py-2 pr-4 text-slate-500">{m.receiverName}</td>
                          <td className="py-2 pr-4 text-emerald-700 font-mono">{m.score.toFixed(2)}</td>
                          <td className="py-2">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                m.whatsappStatus === "SENT"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : m.whatsappStatus === "FAILED"
                                  ? "bg-red-100 text-red-700"
                                  : m.whatsappStatus === "NO_NUMBER"
                                  ? "bg-slate-100 text-slate-500"
                                  : m.whatsappStatus === "PENDING"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-blue-100 text-blue-700"
                              }`}
                            >
                              {m.whatsappStatus === "NO_NUMBER"
                                ? "No Number"
                                : m.whatsappStatus === "NOT_SENT"
                                ? "Not Sent"
                                : m.whatsappStatus === "PENDING"
                                ? "Queued"
                                : m.whatsappStatus || "Not Sent"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Needs Review */}
          {todayLog?.needsReview && todayLog.needsReview.length > 0 && (
            <div className="bg-white rounded-2xl border border-amber-200 p-6 shadow-sm">
              <h3 className="text-sm font-black text-amber-700 uppercase mb-4">
                Needs Review ({todayLog.needsReview.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-400 uppercase text-[10px] tracking-wide">
                      <th className="pb-2 pr-4">Docket No</th>
                      <th className="pb-2 pr-4">Parsed City</th>
                      <th className="pb-2 pr-4">Parsed Receiver</th>
                      <th className="pb-2 pr-4">Best Guess</th>
                      <th className="pb-2 pr-4">Score</th>
                      <th className="pb-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {todayLog.needsReview.map((r) => (
                      <tr key={r.docketNo}>
                        <td className="py-2 pr-4 font-mono">{r.docketNo}</td>
                        <td className="py-2 pr-4 text-slate-500">{r.parsedCity}</td>
                        <td className="py-2 pr-4 text-slate-500">{r.parsedReceiverName}</td>
                        <td className="py-2 pr-4 text-slate-700">{r.bestGuessInstituteName || "-"}</td>
                        <td className="py-2 pr-4 text-amber-700 font-mono">{r.score.toFixed(2)}</td>
                        <td className="py-2 text-slate-500">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {todayLog && !todayLog.matched?.length && !todayLog.needsReview?.length && (
            <p className="text-xs font-bold text-slate-400 p-4 bg-slate-50 rounded-xl border border-slate-200 text-center">
              {todayLog.error || "No parcels processed yet today."}
            </p>
          )}
        </div>
      </div>
  );
}
