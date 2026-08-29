"use client";
import { useEffect, useRef, useState } from "react";
import { FiAlertTriangle, FiCheckCircle, FiClock } from "react-icons/fi";

interface UrgentTaskItem {
  _id: string;
  description: string;
  assignedBy: string;
  status: "pending" | "snoozed" | "done";
  createdAt: string;
  pendingMinutes: number;
}

const POLL_MS = 25000;

// Two short beeps via the Web Audio API - no bundled sound file to fetch/host,
// and it works the same on every device.
function playAlert() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    [0, 0.35].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.3);
    });
  } catch (err) {
    console.error("Could not play urgent task alert sound", err);
  }
}

// Global, mounted once in app/layout.tsx (outside the login page) - polls for
// this logged-in user's due urgent tasks every 25s. A task only ever leaves
// the screen via "Mark as Done" or "Snooze 10 min" (no click-outside/Escape
// dismiss), matching the whole point of this feature: it can't be
// accidentally forgotten in the background.
export default function UrgentTaskPopup() {
  const [queue, setQueue] = useState<UrgentTaskItem[]>([]);
  const [busy, setBusy] = useState(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const usernameRef = useRef<string>("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("oms_user");
      if (stored) usernameRef.current = JSON.parse(stored)?.username || "";
    } catch {
      // ignore
    }
    if (!usernameRef.current) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/urgent-tasks?username=${encodeURIComponent(usernameRef.current)}`);
        const data = await res.json();
        if (!Array.isArray(data)) return;

        const hasNewOne = data.some((t: UrgentTaskItem) => !seenIdsRef.current.has(t._id));
        if (hasNewOne && data.length > 0) playAlert();
        data.forEach((t: UrgentTaskItem) => seenIdsRef.current.add(t._id));

        setQueue(data);
      } catch (err) {
        console.error("Urgent task poll failed", err);
      }
    };

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  const current = queue[0];
  if (!current) return null;

  const resolve = async (action: "done" | "snooze") => {
    setBusy(true);
    try {
      await fetch(`/api/urgent-tasks/${current._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      seenIdsRef.current.delete(current._id);
      setQueue((prev) => prev.slice(1));
    } catch (err) {
      alert("Failed to update the task — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0a1628]/95 p-6">
      <div className="w-full max-w-xl bg-white rounded-3xl shadow-2xl border-4 border-[#ff9933] overflow-hidden">
        <div className="bg-[#0a2540] px-8 py-6 flex items-center gap-4">
          <div className="bg-[#ff9933] text-[#0a2540] p-3 rounded-2xl animate-pulse">
            <FiAlertTriangle size={32} />
          </div>
          <div>
            <h1 className="text-white text-2xl font-black uppercase tracking-tight">Urgent Task</h1>
            <p className="text-[#ff9933] text-xs font-bold uppercase tracking-widest">Assigned by {current.assignedBy}</p>
          </div>
        </div>
        <div className="p-8 space-y-4">
          <p className="text-2xl font-bold text-[#0a2540] leading-snug break-words">{current.description}</p>
          <div className="flex items-center gap-2 text-slate-500 text-sm font-bold">
            <FiClock size={16} />
            Pending for {current.pendingMinutes < 1 ? "less than a minute" : `${current.pendingMinutes} minute(s)`}
          </div>
          {queue.length > 1 && (
            <p className="text-xs font-black uppercase text-slate-400">
              +{queue.length - 1} more urgent task(s) waiting after this one
            </p>
          )}
        </div>
        <div className="p-6 pt-0 flex flex-col sm:flex-row gap-3">
          <button
            disabled={busy}
            onClick={() => resolve("done")}
            className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black uppercase tracking-widest text-sm py-4 rounded-2xl transition-all active:scale-95"
          >
            <FiCheckCircle size={18} /> Mark as Done
          </button>
          <button
            disabled={busy}
            onClick={() => resolve("snooze")}
            className="flex-1 flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-[#0a2540] font-black uppercase tracking-widest text-sm py-4 rounded-2xl transition-all active:scale-95"
          >
            <FiClock size={18} /> Snooze 10 min
          </button>
        </div>
      </div>
    </div>
  );
}
