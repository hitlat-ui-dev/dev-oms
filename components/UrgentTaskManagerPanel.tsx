"use client";
import { useEffect, useState, useCallback } from "react";
import { FiSend, FiClock, FiCheckCircle } from "react-icons/fi";

interface UrgentTask {
  _id: string;
  description: string;
  assignedTo: string;
  assignedBy: string;
  status: "pending" | "snoozed" | "done";
  snoozeUntil?: string | null;
  createdAt: string;
  escalated: boolean;
  pendingMinutes: number;
}

const DASHBOARD_POLL_MS = 25000;

// The create-form + live pending list, shared between the full
// /dashboard/urgent-tasks page and the Header's "Urgent Tasks" popup - same
// component either way, so the two never drift out of sync.
export default function UrgentTaskManagerPanel() {
  const [users, setUsers] = useState<{ username: string }[]>([]);
  const [currentUsername, setCurrentUsername] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tasks, setTasks] = useState<UrgentTask[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("oms_user");
      if (stored) setCurrentUsername(JSON.parse(stored)?.username || "");
    } catch {
      // ignore
    }
    fetch("/api/users")
      .then((res) => res.json())
      .then((data) => setUsers(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load users", err));
  }, []);

  const fetchTasks = useCallback(() => {
    fetch("/api/urgent-tasks")
      .then((res) => res.json())
      .then((data) => setTasks(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load urgent tasks", err));
  }, []);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, DASHBOARD_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || !assignedTo) {
      alert("Description aur staff dono chahiye.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/urgent-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, assignedTo, assignedBy: currentUsername }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create");
      }
      setDescription("");
      setAssignedTo("");
      fetchTasks();
    } catch (err: any) {
      alert(err.message || "Failed to create urgent task");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Create form */}
      <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="space-y-1">
          <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Buyer ko GeM order ka PDF WhatsApp par bhejo"
            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#0a2540] min-h-[70px]"
          />
        </div>
        <div className="flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1 w-full space-y-1">
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Assign To</label>
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#0a2540]"
            >
              <option value="">Select staff...</option>
              {users.map((u) => (
                <option key={u.username} value={u.username}>{u.username}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 bg-[#0a2540] hover:bg-[#0a1628] disabled:opacity-50 text-white font-black uppercase tracking-widest text-xs py-3 px-6 rounded-xl transition-all active:scale-95 shrink-0"
          >
            <FiSend size={14} /> {submitting ? "Sending..." : "Send Urgent Task"}
          </button>
        </div>
      </form>

      {/* Live pending list */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <h3 className="text-xs font-black uppercase tracking-wider text-[#0a2540] flex items-center gap-1.5">
            <FiClock className="text-[#0a2540]" size={14} /> Pending / Snoozed
            <span className="bg-slate-100 text-slate-600 text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">
              {tasks.length}
            </span>
          </h3>
        </div>
        {tasks.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs font-bold uppercase tracking-widest flex flex-col items-center gap-2">
            <FiCheckCircle size={20} />
            Nothing pending — sab clear hai.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                  <th className="py-2.5 px-3">Assigned To</th>
                  <th className="py-2.5 px-3">Description</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Pending Since</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tasks.map((t) => (
                  <tr key={t._id} className={t.escalated ? "bg-red-50" : "hover:bg-slate-50"}>
                    <td className="py-2.5 px-3 font-bold text-[#0a2540]">{t.assignedTo}</td>
                    <td className="py-2.5 px-3 text-slate-700 max-w-[220px]">{t.description}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                          t.status === "snoozed" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"
                        }`}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className={`py-2.5 px-3 text-right font-mono font-bold ${t.escalated ? "text-red-600" : "text-slate-500"}`}>
                      {t.pendingMinutes < 60 ? `${t.pendingMinutes} min` : `${Math.floor(t.pendingMinutes / 60)} hr ${t.pendingMinutes % 60} min`}
                      {t.escalated && <span className="block text-[8px] uppercase">Escalated</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
