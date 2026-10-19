"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiCheckSquare, FiPlus, FiRefreshCw } from "react-icons/fi";
import {
  TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES, TaskDTO, TaskStatKey, TaskSummaryDTO, TaskUserDTO,
} from "@/lib/tasks/types";
import TaskStatsRow from "./components/TaskStatsRow";
import TaskTable from "./components/TaskTable";
import TaskDrawer from "./components/TaskDrawer";
import CreateTaskModal from "./components/CreateTaskModal";
import { ApiError, CATEGORY_LABEL, TaskCtx, api, readSessionUser, roleFromSession } from "./components/taskUi";

type View = "my" | "watching" | "byme" | "team" | "all";
const POLL_MS = 30_000;
const PAGE_SIZE = 50;
const BULK_MAX = 50;

const selectCls = "p-2 border border-slate-200 rounded-xl text-xs font-bold bg-white outline-none focus:ring-2 focus:ring-[#ff9933]";

export default function TasksPage() {
  const [me, setMe] = useState<string | null>(null);
  const [sessionRole, setSessionRole] = useState<"admin" | "manager" | "staff">("staff");
  const [users, setUsers] = useState<TaskUserDTO[]>([]);
  const [view, setView] = useState<View>("my");
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<TaskSummaryDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [stat, setStat] = useState<TaskStatKey | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [firm, setFirm] = useState("");
  const [category, setCategory] = useState("");
  const [assignee, setAssignee] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [firms, setFirms] = useState<string[]>([]);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const u = readSessionUser();
    if (u) { setMe(u.username); setSessionRole(roleFromSession(u)); }
    else setLoading(false);
  }, []);

  // Prefer the server-resolved role (DB permissions) over the cached session one.
  const role = users.find((u) => u.username === me)?.role ?? sessionRole;
  const mgr = role !== "staff";

  const notify = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const ctx: TaskCtx | null = useMemo(() => (me ? { me, role, users, notify } : null), [me, role, users, notify]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Any filter change goes back to page 1 and clears the bulk selection.
  useEffect(() => { setPage(1); setSelected(new Set()); }, [view, stat, debouncedQ, status, priority, firm, category, assignee, overdueOnly]);

  const fetchAll = useCallback(async () => {
    if (!me) return;
    const sp = new URLSearchParams({ view, page: String(page), limit: String(PAGE_SIZE) });
    if (stat) sp.set("stat", stat);
    if (debouncedQ) sp.set("q", debouncedQ);
    if (status) sp.set("status", status);
    if (priority) sp.set("priority", priority);
    if (firm) sp.set("firm", firm);
    if (category) sp.set("category", category);
    if (assignee) sp.set("assignee", assignee);
    if (overdueOnly) sp.set("overdue", "true");
    try {
      const [list, sum] = await Promise.all([
        api<{ tasks: TaskDTO[]; total: number }>(`/api/tasks?${sp}`, me),
        api<TaskSummaryDTO>(`/api/tasks/summary?view=${view}`, me),
      ]);
      setTasks(list.tasks);
      setTotal(list.total);
      setSummary(sum);
      setFirms((prev) => [...new Set([...prev, ...list.tasks.map((t) => t.firm).filter(Boolean)])].sort());
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "Tasks load nahi hue", "err");
    } finally {
      setLoading(false);
    }
  }, [me, view, page, stat, debouncedQ, status, priority, firm, category, assignee, overdueOnly, notify]);

  const fetchUsers = useCallback(async () => {
    if (!me) return;
    try { setUsers(await api<TaskUserDTO[]>("/api/tasks/users", me)); } catch { /* assignee list is optional */ }
  }, [me]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  // 30 s polling while the tab is visible; refetch immediately when it becomes visible again.
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && fetchAll();
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [fetchAll]);

  // N opens the create modal (not while typing); Esc closes drawer/modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.tagName === "SELECT" || el?.isContentEditable;
      if (e.key === "Escape") { if (showCreate) setShowCreate(false); else if (openId) setOpenId(null); return; }
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "n" && !showCreate && !openId) {
        e.preventDefault();
        setShowCreate(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showCreate, openId]);

  const refreshAll = () => { fetchAll(); fetchUsers(); };

  async function quick(task: TaskDTO, action: "start" | "done" | "verify") {
    if (!me) return;
    try {
      if (action === "verify") await api(`/api/tasks/${task._id}/verify`, me, { method: "POST", body: {} });
      else await api(`/api/tasks/${task._id}/status`, me, { method: "POST", body: { status: action === "start" ? "IN_PROGRESS" : "DONE" } });
      refreshAll();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "Action fail ho gaya", "err");
    }
  }

  async function bulk(kind: "assign" | "priority", value: string) {
    if (!me || !value) return;
    const ids = [...selected];
    if (ids.length > BULK_MAX) return notify(`Ek baar mein max ${BULK_MAX} tasks`, "err");
    let ok = 0;
    const failed: string[] = [];
    for (const id of ids) {
      try {
        if (kind === "assign") await api(`/api/tasks/${id}/assign`, me, { method: "POST", body: { assignee: value } });
        else await api(`/api/tasks/${id}`, me, { method: "PATCH", body: { priority: value } });
        ok++;
      } catch (e) {
        failed.push(e instanceof ApiError ? e.message : "error");
      }
    }
    notify(`${ok} updated${failed.length ? `, ${failed.length} fail (${failed[0]})` : ""}`, failed.length ? "err" : "ok");
    setSelected(new Set());
    refreshAll();
  }

  if (!me || !ctx) {
    return (
      <div className="p-8">
        {loading ? null : <p className="text-sm font-bold text-red-500">Login karke aao.</p>}
      </div>
    );
  }

  const tabs: { key: View; label: string }[] = [
    { key: "my", label: "My Tasks" },
    { key: "watching", label: "Watching" },
    { key: "byme", label: "Assigned by Me" },
    ...(mgr ? [{ key: "team" as View, label: "Team" }] : []),
    ...(role === "admin" ? [{ key: "all" as View, label: "All" }] : []),
  ];
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = !!(stat || q || status || priority || firm || category || assignee || overdueOnly);
  const clearFilters = () => { setStat(null); setQ(""); setStatus(""); setPriority(""); setFirm(""); setCategory(""); setAssignee(""); setOverdueOnly(false); };

  return (
    <div className="p-4 md:p-6 bg-[#f3f6f9] min-h-screen">
      <div className="max-w-[1500px] mx-auto flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="bg-[#0a2540] text-white p-3.5 rounded-2xl"><FiCheckSquare size={22} /></div>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tight text-[#0a2540]">Tasks</h1>
              <p className="text-[#ff9933] text-[10px] font-black tracking-widest uppercase">Assign · Track · Follow-up</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={refreshAll} title="Refresh" className="p-2.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 cursor-pointer"><FiRefreshCw size={15} /></button>
            <button type="button" onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-[#ff9933] hover:bg-[#f08a24] text-white text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-xl cursor-pointer">
              <FiPlus /> New Task <kbd className="hidden sm:inline bg-white/25 rounded px-1.5 text-[10px]">N</kbd>
            </button>
          </div>
        </div>

        <TaskStatsRow summary={summary} active={stat} onSelect={setStat} />

        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button key={t.key} type="button" onClick={() => setView(t.key)}
              className={`text-xs font-black uppercase tracking-wider rounded-full px-4 py-2 cursor-pointer ${view === t.key ? "bg-[#0a2540] text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search task no, title, buyer, order..." className={`${selectCls} w-64`} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
            <option value="">All status</option>
            {TASK_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className={selectCls}>
            <option value="">All priority</option>
            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {/* Firm is no longer set on new tasks; only offer the filter if older tasks carry one. */}
          {(firms.length > 0 || firm) && (
            <select value={firm} onChange={(e) => setFirm(e.target.value)} className={`${selectCls} hidden xl:block`}>
              <option value="">All firms</option>
              {firms.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          )}
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${selectCls} hidden xl:block`}>
            <option value="">All categories</option>
            {TASK_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL(c)}</option>)}
          </select>
          {mgr && (
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={selectCls}>
              <option value="">All assignees</option>
              {users.map((u) => <option key={u.username} value={u.username}>{u.username}</option>)}
            </select>
          )}
          <label className="flex items-center gap-1.5 text-xs font-bold text-red-600 cursor-pointer select-none">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only
          </label>
          {hasFilters && <button type="button" onClick={clearFilters} className="text-[10px] font-black uppercase tracking-wider text-slate-500 underline cursor-pointer">Clear filters</button>}
        </div>

        {mgr && selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 bg-[#0a2540] text-white rounded-2xl px-4 py-3">
            <p className="text-xs font-black uppercase tracking-wider">{selected.size} selected</p>
            <select defaultValue="" onChange={(e) => { bulk("assign", e.target.value); e.target.value = ""; }} className="p-1.5 rounded-lg text-xs font-bold text-slate-800">
              <option value="">Reassign to...</option>
              {users.filter((u) => u.assignable).map((u) => <option key={u.username} value={u.username}>{u.username} ({u.openCount})</option>)}
            </select>
            <select defaultValue="" onChange={(e) => { bulk("priority", e.target.value); e.target.value = ""; }} className="p-1.5 rounded-lg text-xs font-bold text-slate-800">
              <option value="">Set priority...</option>
              {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <button type="button" onClick={() => setSelected(new Set())} className="text-[10px] font-black uppercase underline cursor-pointer ml-auto">Clear</button>
          </div>
        )}

        <TaskTable
          tasks={tasks}
          ctx={ctx}
          loading={loading}
          selectable={mgr}
          selected={selected}
          onToggle={(id) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
          onToggleAll={(checked) => setSelected(checked ? new Set(tasks.map((t) => t._id)) : new Set())}
          onOpen={setOpenId}
          onQuick={quick}
        />

        <div className="flex items-center justify-between text-xs font-bold text-slate-500">
          <span>{total} task{total === 1 ? "" : "s"}</span>
          {pages > 1 && (
            <div className="flex items-center gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 disabled:opacity-40 cursor-pointer">Prev</button>
              <span>{page} / {pages}</span>
              <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 disabled:opacity-40 cursor-pointer">Next</button>
            </div>
          )}
        </div>
      </div>

      {openId && <TaskDrawer taskId={openId} ctx={ctx} onClose={() => setOpenId(null)} onChanged={refreshAll} />}
      {showCreate && (
        <CreateTaskModal
          ctx={ctx}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refreshAll(); }}
        />
      )}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-xl text-sm font-bold shadow-xl ${toast.kind === "err" ? "bg-red-600 text-white" : "bg-[#0a2540] text-white"}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
