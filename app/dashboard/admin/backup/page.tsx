"use client";
import { useEffect, useState } from "react";
import JSZip from "jszip";
import { FiDownload, FiDatabase, FiCheckCircle, FiAlertTriangle, FiCloud, FiClock, FiRefreshCw } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import Link from "next/link";

interface BackupHistoryLog {
  _id: string;
  date: string;
  status: "SUCCESS" | "FAILED" | "IN_PROGRESS";
  fileName?: string;
  fileId?: string;
  fileSize?: number;
  collectionsCount?: number;
  recordsCount?: number;
  timestamp: string;
  error?: string;
}

export default function BackupPage() {
  const [loading, setLoading] = useState(false);
  const [autoBackupLoading, setAutoBackupLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error" | null; message: string }>({
    type: null,
    message: "",
  });

  const [autoStatus, setAutoStatus] = useState<{
    todayBackupCompleted: boolean;
    todayLog: BackupHistoryLog | null;
    history: BackupHistoryLog[];
    driveConfigured: boolean;
  }>({
    todayBackupCompleted: false,
    todayLog: null,
    history: [],
    driveConfigured: false,
  });

  const fetchAutoBackupStatus = async () => {
    try {
      const res = await fetch("/api/backup/auto");
      const data = await res.json();
      if (res.ok) {
        setAutoStatus({
          todayBackupCompleted: data.todayBackupCompleted,
          todayLog: data.todayLog,
          history: data.history || [],
          driveConfigured: data.driveConfigured,
        });
      }
    } catch (e) {
      console.error("Failed to fetch auto backup status", e);
    }
  };

  useEffect(() => {
    fetchAutoBackupStatus();
  }, []);

  const handleRunAutoBackupNow = async () => {
    if (autoBackupLoading) return;
    setAutoBackupLoading(true);
    try {
      const res = await fetch("/api/backup/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus({
          type: "success",
          message: data.message || "Auto backup completed and saved to log.",
        });
        await fetchAutoBackupStatus();
      } else {
        throw new Error(data.error || "Failed to trigger auto backup");
      }
    } catch (err: any) {
      setStatus({ type: "error", message: err.message });
    } finally {
      setAutoBackupLoading(false);
    }
  };

  const handleDownloadBackup = async () => {
    if (loading) return;
    setLoading(true);
    setStatus({ type: null, message: "" });

    try {
      const response = await fetch("/api/backup");
      if (!response.ok) throw new Error("Failed to fetch backup collections data from server pipeline.");

      const data = await response.json();
      const { collections, database, timestamp } = data;

      const zip = new JSZip();
      const dateStub = timestamp.split("T")[0];
      const folderName = `${database}_backup_${dateStub}`;
      const backupFolder = zip.folder(folderName);

      if (!backupFolder) throw new Error("Failed to initialize download container folder.");

      Object.keys(collections).forEach((colName) => {
        const colData = collections[colName];
        backupFolder.file(`${colName}.json`, JSON.stringify(colData, null, 4));
      });

      const blobContent = await zip.generateAsync({ type: "blob" });
      const downloadUrl = window.URL.createObjectURL(blobContent);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `${folderName}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(downloadUrl);

      setStatus({
        type: "success",
        message: `Database backup compiled and downloaded successfully as: ${folderName}.zip`,
      });
    } catch (err: any) {
      console.error(err);
      setStatus({
        type: "error",
        message: err.message || "An error occurred while compiling your backup archive zip data.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <BlockGuard
      permission="backup"
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
      <div className="min-h-screen bg-slate-50 p-6 flex justify-center">
        <div className="max-w-4xl w-full flex flex-col gap-6">

          {/* Header Banner */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="bg-blue-50 p-4 rounded-xl text-blue-600">
                <FiDatabase size={28} />
              </div>
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                  System Data Backup & Cloud Sync
                </h1>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                  Automated Daily Google Drive Backup Engine
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${
                  autoStatus.driveConfigured
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                    : "bg-amber-100 text-amber-800 border border-amber-300"
                }`}
              >
                <FiCloud size={14} />
                {autoStatus.driveConfigured ? "Google Drive Connected" : "Drive Env Keys Pending"}
              </span>
            </div>
          </div>

          {/* Status Alert */}
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

          {/* Grid of Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Auto Daily Backup Card */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-black uppercase text-blue-600 bg-blue-50 px-2.5 py-1 rounded-lg">
                    Plan B Strategy
                  </span>
                  <span className="text-xs text-slate-400 font-medium">Daily Auto-Run</span>
                </div>

                <h3 className="text-base font-bold text-slate-900 mb-2">Automated Daily Cloud Sync</h3>
                <p className="text-slate-600 text-xs leading-relaxed mb-4">
                  Triggers automatically on the first site access of each calendar day. Backs up database collections and syncs directly to Google Drive.
                </p>

                <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100 mb-6 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-semibold">Today Status:</span>
                    <span
                      className={`font-black ${
                        autoStatus.todayBackupCompleted ? "text-emerald-600" : "text-amber-600"
                      }`}
                    >
                      {autoStatus.todayBackupCompleted ? "COMPLETED TODAY" : "PENDING / NOT RUN YET"}
                    </span>
                  </div>
                  {autoStatus.todayLog && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-semibold">Last Backup Time:</span>
                        <span className="text-slate-700 font-mono">
                          {new Date(autoStatus.todayLog.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      {autoStatus.todayLog.fileSize && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500 font-semibold">Archive Size:</span>
                          <span className="text-slate-700 font-mono">
                            {(autoStatus.todayLog.fileSize / 1024).toFixed(1)} KB
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              <button
                type="button"
                disabled={autoBackupLoading}
                onClick={handleRunAutoBackupNow}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white font-black uppercase text-xs tracking-wider py-3.5 rounded-xl transition-all hover:bg-blue-700 active:scale-[0.98] disabled:opacity-40"
              >
                {autoBackupLoading ? (
                  <>
                    <FiRefreshCw size={14} className="animate-spin" />
                    <span>Executing Sync...</span>
                  </>
                ) : (
                  <>
                    <FiCloud size={16} />
                    <span>Force Run Auto Backup Now</span>
                  </>
                )}
              </button>
            </div>

            {/* Manual Local ZIP Download Card */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-black uppercase text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg">
                    Manual Action
                  </span>
                  <span className="text-xs text-slate-400 font-medium">Browser Download</span>
                </div>

                <h3 className="text-base font-bold text-slate-900 mb-2">Direct Local ZIP Download</h3>
                <p className="text-slate-600 text-xs leading-relaxed mb-6">
                  Instantly fetch and download all MongoDB collections standard JSON files compressed inside a `.zip` archive straight to your desktop.
                </p>
              </div>

              <button
                type="button"
                disabled={loading}
                onClick={handleDownloadBackup}
                className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white font-black uppercase text-xs tracking-wider py-3.5 rounded-xl transition-all hover:bg-slate-800 active:scale-[0.98] disabled:opacity-40 shadow-md shadow-slate-200"
              >
                {loading ? (
                  <>
                    <FiRefreshCw size={14} className="animate-spin text-blue-400" />
                    <span>Compiling Local ZIP...</span>
                  </>
                ) : (
                  <>
                    <FiDownload size={16} />
                    <span>Download Local Backup ZIP</span>
                  </>
                )}
              </button>
            </div>

          </div>

          {/* Backup History Table */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black uppercase text-slate-900 tracking-wider flex items-center gap-2">
                <FiClock size={16} className="text-blue-600" />
                <span>Recent Backup History Logs</span>
              </h3>
              <button
                onClick={fetchAutoBackupStatus}
                className="text-xs text-blue-600 font-bold hover:underline flex items-center gap-1"
              >
                <FiRefreshCw size={12} /> Refresh Logs
              </button>
            </div>

            {autoStatus.history.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-4 text-center">
                No automated backup history recorded yet. Access the site or click "Force Run Auto Backup Now" to create your first log entry.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 font-black uppercase">
                      <th className="pb-3 px-2">Date</th>
                      <th className="pb-3 px-2">Status</th>
                      <th className="pb-3 px-2">File Name</th>
                      <th className="pb-3 px-2">Size</th>
                      <th className="pb-3 px-2">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {autoStatus.history.map((log) => (
                      <tr key={log._id} className="hover:bg-slate-50/50">
                        <td className="py-3 px-2 font-mono font-bold text-slate-800">{log.date}</td>
                        <td className="py-3 px-2">
                          <span
                            className={`inline-block px-2 py-0.5 rounded font-black text-[10px] uppercase ${
                              log.status === "SUCCESS"
                                ? "bg-emerald-100 text-emerald-800"
                                : log.status === "FAILED"
                                ? "bg-red-100 text-red-800"
                                : "bg-blue-100 text-blue-800"
                            }`}
                          >
                            {log.status}
                          </span>
                        </td>
                        <td className="py-3 px-2 font-mono text-slate-600 max-w-[200px] truncate">
                          {log.fileName || "-"}
                        </td>
                        <td className="py-3 px-2 font-mono text-slate-600">
                          {log.fileSize ? `${(log.fileSize / 1024).toFixed(1)} KB` : "-"}
                        </td>
                        <td className="py-3 px-2 text-slate-500 font-mono">
                          {new Date(log.timestamp).toLocaleString()}
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
    </BlockGuard>
  );
}