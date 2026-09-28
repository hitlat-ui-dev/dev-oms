"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { FiX, FiSave, FiUserCheck } from "react-icons/fi";

// Daily reminder time (local clock of the browser the owner is logged in on).
const REMINDER_HOUR = 17;
const REMINDER_MINUTE = 30;
const SNOOZE_MINUTES = 30;

type Status = "present" | "absent" | "half_day" | "leave" | "holiday";

const STATUSES: { key: Status; short: string; label: string; on: string }[] = [
  { key: "present", short: "P", label: "Present", on: "bg-emerald-600 border-emerald-600 text-white" },
  { key: "absent", short: "A", label: "Absent", on: "bg-red-600 border-red-600 text-white" },
  { key: "half_day", short: "H", label: "Half Day", on: "bg-amber-500 border-amber-500 text-white" },
  { key: "leave", short: "L", label: "Leave", on: "bg-blue-600 border-blue-600 text-white" },
  { key: "holiday", short: "Ho", label: "Holiday", on: "bg-slate-500 border-slate-500 text-white" },
];

interface Emp {
  _id: string;
  name: string;
  designation?: string;
}

interface Rec {
  employeeId: string;
  status: Status;
  inTime?: string;
  outTime?: string;
  overtimeHours?: number;
  note?: string;
}

// Local calendar date - toISOString() would give yesterday's date before
// 05:30 IST (same reason as todayLocal in the attendance page).
function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // storage blocked - the reminder just may repeat, which is harmless
  }
};
const lsDel = (k: string) => {
  try {
    localStorage.removeItem(k);
  } catch {
    // ignore
  }
};

const SNOOZE_KEY = "oms_att_reminder_snooze";
const ASKED_KEY = "oms_att_reminder_asked";
const doneKey = (date: string) => `oms_att_reminder_done_${date}`;
const shownKey = (date: string) => `oms_att_reminder_shown_${date}`;

export default function AttendanceReminder({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<Emp[]>([]);
  const [draft, setDraft] = useState<Record<string, Status>>({});
  const [existing, setExisting] = useState<Record<string, Rec>>({});
  const [saving, setSaving] = useState(false);
  const checkingRef = useRef(false);
  const dateRef = useRef(todayLocal());

  // Loads roster + today's saved records and seeds the popup. Returns true when
  // there is still something left to mark.
  const loadToday = useCallback(async (date: string) => {
    const [empRes, attRes] = await Promise.all([
      fetch("/api/employees").then((r) => r.json()),
      fetch(`/api/attendance?date=${date}`).then((r) => r.json()),
    ]);
    const emps: Emp[] = Array.isArray(empRes) ? empRes.filter((e: any) => e.isActive !== false) : [];
    const recs: Rec[] = Array.isArray(attRes) ? attRes : [];
    const byId: Record<string, Rec> = Object.fromEntries(recs.map((r) => [r.employeeId, r]));
    setRoster(emps);
    setExisting(byId);
    // Unmarked rows start at Present - the usual answer, so only exceptions need a tap.
    setDraft(Object.fromEntries(emps.map((e) => [e._id, byId[e._id]?.status || "present"])));
    return emps.length > 0 && emps.some((e) => !byId[e._id]);
  }, []);

  const check = useCallback(async () => {
    const now = new Date();
    if (now.getHours() * 60 + now.getMinutes() < REMINDER_HOUR * 60 + REMINDER_MINUTE) return;

    const date = todayLocal();
    dateRef.current = date;
    if (lsGet(doneKey(date)) || lsGet(shownKey(date))) return;
    if (Date.now() < Number(lsGet(SNOOZE_KEY) || 0)) return;
    if (checkingRef.current) return;
    checkingRef.current = true;

    // Claimed before the network call so a second tab checking at the same
    // moment sees it and stays quiet.
    lsSet(shownKey(date), "1");
    try {
      const needsMarking = await loadToday(date);
      if (!needsMarking) {
        lsSet(doneKey(date), "1");
        return;
      }
      setOpen(true);
      try {
        if ("Notification" in window && Notification.permission === "granted") {
          const n = new Notification("Attendance ka time — 5:30 PM", {
            body: "Aaj ki attendance daal do.",
            tag: "oms-attendance",
          });
          n.onclick = () => {
            window.focus();
            setOpen(true);
            n.close();
          };
        }
      } catch {
        // Some browsers refuse `new Notification` - the popup alone still shows.
      }
    } catch (err) {
      console.error("Attendance reminder check failed", err);
      lsDel(shownKey(date)); // let the next tick retry
    } finally {
      checkingRef.current = false;
    }
  }, [loadToday]);

  useEffect(() => {
    check();
    const id = setInterval(check, 30_000);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  // Ask for notification permission once, on the first click anywhere - browsers
  // ignore or quietly block prompts that are not tied to a user gesture.
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "default" || lsGet(ASKED_KEY)) return;
    const ask = () => {
      lsSet(ASKED_KEY, "1");
      Notification.requestPermission().catch(() => {});
      document.removeEventListener("click", ask);
    };
    document.addEventListener("click", ask);
    return () => document.removeEventListener("click", ask);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const snooze = () => {
    lsSet(SNOOZE_KEY, String(Date.now() + SNOOZE_MINUTES * 60_000));
    lsDel(shownKey(dateRef.current));
    setOpen(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const date = dateRef.current;
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          markedBy: username,
          // The API overwrites a row wholesale, so anything already saved for
          // it (times, OT, note) is sent back unchanged - only status moves.
          records: roster.map((e) => {
            const prev = existing[e._id];
            return {
              employeeId: e._id,
              employeeName: e.name,
              status: draft[e._id] || "present",
              inTime: prev?.inTime || "",
              outTime: prev?.outTime || "",
              overtimeHours: prev?.overtimeHours || 0,
              note: prev?.note || "",
            };
          }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Save failed");
      lsSet(doneKey(date), "1");
      setOpen(false);
      alert(`✓ ${date} ki attendance save ho gayi (${data.saved} log).`);
    } catch (err: any) {
      alert("Save nahi hui: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const markAll = (status: Status) =>
    setDraft(Object.fromEntries(roster.map((e) => [e._id, status])) as Record<string, Status>);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 bg-[#0a2540] text-white flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <FiUserCheck size={20} />
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider">Aaj ki Attendance</h3>
              <p className="text-[10px] font-bold text-white/60 uppercase tracking-wider mt-0.5">
                {dateRef.current} &middot; 5:30 PM reminder
              </p>
            </div>
          </div>
          <button onClick={() => setOpen(false)} className="text-white/60 hover:text-white" title="Close">
            <FiX size={18} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap shrink-0">
          <button
            onClick={() => markAll("present")}
            className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl py-1.5 px-3 text-[10px] font-black uppercase tracking-wider"
          >
            Mark all Present
          </button>
          <button
            onClick={() => markAll("holiday")}
            className="bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-xl py-1.5 px-3 text-[10px] font-black uppercase tracking-wider"
          >
            Holiday
          </button>
          <Link
            href="/dashboard/admin/attendance"
            onClick={() => setOpen(false)}
            className="ml-auto text-[10px] font-black uppercase tracking-wider text-blue-600 hover:underline"
          >
            Full register &rarr;
          </Link>
        </div>

        <div className="overflow-y-auto divide-y divide-slate-100">
          {roster.map((e) => (
            <div key={e._id} className="px-5 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black text-slate-800 truncate">{e.name}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {e.designation || "—"}
                  {existing[e._id] && <span className="text-emerald-600 ml-2">saved</span>}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                {STATUSES.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setDraft((p) => ({ ...p, [e._id]: s.key }))}
                    title={s.label}
                    className={`w-9 h-7 rounded-lg border text-[11px] font-black transition-all ${
                      draft[e._id] === s.key ? s.on : "bg-white border-slate-200 text-slate-400 hover:border-slate-300"
                    }`}
                  >
                    {s.short}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-slate-100 flex items-center justify-between gap-3 shrink-0">
          <button
            onClick={snooze}
            className="text-[10px] font-black uppercase tracking-wider text-slate-500 hover:text-slate-800"
          >
            {SNOOZE_MINUTES} min baad yaad dilao
          </button>
          <button
            onClick={save}
            disabled={saving || roster.length === 0}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl py-2 px-5 text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5"
          >
            <FiSave size={13} /> {saving ? "Saving..." : "Save Day"}
          </button>
        </div>
      </div>
    </div>
  );
}
