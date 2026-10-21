"use client";
import { useEffect, useRef, useState } from "react";

/** Fire this after any task create / status change / reassign / delete so the navbar badge refreshes instantly. */
export const TASKS_CHANGED_EVENT = "tasks:changed";
export const notifyTasksChanged = () => window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));

const POLL_MS = 60_000;
const PULSE_MS = 1500;

/**
 * Pending-task count for the logged-in user. Refreshes on mount, every 60 s
 * (visible tab only), on tab focus, and on the "tasks:changed" window event.
 * Returns count 0 (badge hidden) when logged out or when the API fails.
 */
export function usePendingTaskCount(username: string | null) {
  const [count, setCount] = useState(0);
  const [pulse, setPulse] = useState(false);
  const prev = useRef<number | null>(null);

  useEffect(() => {
    if (!username) { prev.current = null; return; }
    let cancelled = false;
    let pulseTimer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      // Logged out in another tab/after logout -> stop quietly.
      if (!localStorage.getItem("oms_user")) { if (!cancelled) setCount(0); return; }
      try {
        const res = await fetch("/api/tasks/pending-count", { headers: { "x-oms-user": username }, cache: "no-store" });
        if (!res.ok) throw new Error(`pending-count ${res.status}`);
        const { count: next } = await res.json();
        if (cancelled || typeof next !== "number") return;
        if (prev.current !== null && next > prev.current) {
          setPulse(true);
          if (pulseTimer) clearTimeout(pulseTimer);
          pulseTimer = setTimeout(() => setPulse(false), PULSE_MS);
        }
        prev.current = next;
        setCount(next);
      } catch (e) {
        console.warn("Pending task count failed:", e); // badge just stays hidden
        if (!cancelled) setCount(0);
      }
    };

    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    load();
    const id = setInterval(onVisible, POLL_MS);
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(TASKS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      clearInterval(id);
      if (pulseTimer) clearTimeout(pulseTimer);
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(TASKS_CHANGED_EVENT, load);
    };
  }, [username]);

  return { count: username ? count : 0, pulse };
}
