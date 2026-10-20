"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { TaskUserDTO } from "@/lib/tasks/types";
import CreateTaskModal from "@/app/dashboard/tasks/components/CreateTaskModal";
import { TaskCtx, api, readSessionUser, roleFromSession } from "@/app/dashboard/tasks/components/taskUi";

/** Window events: other components (e.g. the Tasks page button) open the modal / get told a task was created. */
export const NEW_TASK_EVENT = "oms:new-task";
export const TASK_CREATED_EVENT = "oms:task-created";

let toastTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Single owner of the "New Task" modal, mounted once in the root layout so
 * Alt+N works on every OMS page. Alt+N is used (not a bare letter) because it
 * works even while typing in a field and doesn't clash with page shortcuts or
 * browser ones (Ctrl+N is taken by the browser).
 */
export default function GlobalTaskCreate() {
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const [sessionRole, setSessionRole] = useState<"admin" | "manager" | "staff">("staff");
  const [users, setUsers] = useState<TaskUserDTO[]>([]);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);

  const openModal = useCallback(() => {
    const u = readSessionUser();
    if (!u) return;
    setMe(u.username);
    setSessionRole(roleFromSession(u));
    setOpen(true);
    api<TaskUserDTO[]>("/api/tasks/users", u.username).then(setUsers).catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyN") {
        e.preventDefault();
        openModal();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(NEW_TASK_EVENT, openModal);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(NEW_TASK_EVENT, openModal);
    };
  }, [openModal]);

  const notify = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast(null), 4000);
  }, []);

  const role = users.find((u) => u.username === me)?.role ?? sessionRole;
  const ctx: TaskCtx | null = useMemo(() => (me ? { me, role, users, notify } : null), [me, role, users, notify]);

  return (
    <>
      {open && ctx && (
        <CreateTaskModal
          ctx={ctx}
          onClose={() => setOpen(false)}
          onCreated={() => { setOpen(false); window.dispatchEvent(new Event(TASK_CREATED_EVENT)); }}
        />
      )}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] px-5 py-3 rounded-xl text-sm font-bold shadow-xl ${toast.kind === "err" ? "bg-red-600 text-white" : "bg-[#0a2540] text-white"}`}>
          {toast.msg}
        </div>
      )}
    </>
  );
}
