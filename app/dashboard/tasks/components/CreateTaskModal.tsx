"use client";
import { useEffect, useRef, useState } from "react";
import { FiX } from "react-icons/fi";
import { TASK_CATEGORIES, TASK_PRIORITIES } from "@/lib/tasks/types";
import { ApiError, CATEGORY_LABEL, DUE_CHIPS, TaskCtx, api, toLocalInput } from "./taskUi";
import SearchableSelect from "./SearchableSelect";

interface Props {
  ctx: TaskCtx;
  onClose: () => void;
  onCreated: () => void;
}

const inputCls = "w-full p-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#ff9933]";
const labelCls = "block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1";

export default function CreateTaskModal({ ctx, onClose, onCreated }: Props) {
  const staff = ctx.role === "staff";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState(ctx.me);
  const [priority, setPriority] = useState("NORMAL");
  const [dueAt, setDueAt] = useState("");
  const [category, setCategory] = useState("GENERAL");
  const [watchers, setWatchers] = useState<string[]>([]);
  const [checklist, setChecklist] = useState("");
  const [requiresVerification, setRequiresVerification] = useState(false);
  const [verTouched, setVerTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => titleRef.current?.focus(), []);

  // Self-tasks default to no verification; tasks for others default to verification (spec 6.4).
  useEffect(() => {
    if (!verTouched) setRequiresVerification(assignee !== ctx.me);
  }, [assignee, ctx.me, verTouched]);

  const assignable = ctx.users.filter((u) => u.assignable);
  const assigneeOptions = assignable.map((u) => ({ value: u.username, label: `${u.username} (${u.openCount} open)`, searchText: u.username }));
  const categoryOptions = TASK_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL(c) }));
  // The assignee is already on the task, so they are not offered as a watcher.
  const watcherOptions = ctx.users.filter((u) => u.username !== assignee).map((u) => ({ value: u.username, label: u.username }));

  function changeAssignee(next: string) {
    setAssignee(next);
    setWatchers((w) => w.filter((x) => x !== next));
  }

  async function submit() {
    if (saving) return;
    setError("");
    if (!title.trim()) return setError("Title zaroori hai");
    if (!dueAt) return setError("Due date zaroori hai");
    setSaving(true);
    try {
      const res = await api<{ warning?: string }>("/api/tasks", ctx.me, {
        method: "POST",
        body: {
          title, description, assignee, priority, category, watchers, requiresVerification,
          dueAt: new Date(dueAt).toISOString(),
          checklist: checklist.split("\n").map((s) => s.trim()).filter(Boolean),
        },
      });
      ctx.notify(res.warning ? `Task bana. ${res.warning}` : "Task ban gaya");
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Task nahi bana");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl my-4"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="text-sm font-black uppercase tracking-wider text-[#0a2540]">New Task</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 cursor-pointer"><FiX /></button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {error && <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{error}</p>}

          <div>
            <label className={labelCls}>Title *</label>
            <input ref={titleRef} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Kya kaam karna hai?" />
          </div>
          {/* Two columns on md+: text content on the left, assignment/schedule on the right. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Description</label>
              <textarea value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} rows={4} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Checklist (ek line = ek item)</label>
              <textarea value={checklist} onChange={(e) => setChecklist(e.target.value)} rows={4} className={inputCls} />
            </div>
          </div>

          <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Assignee *</label>
              {staff ? (
                <input value={ctx.me} disabled className={`${inputCls} bg-slate-50 text-slate-500`} />
              ) : (
                <SearchableSelect value={assignee} onChange={changeAssignee} options={assigneeOptions} placeholder="Select assignee" />
              )}
            </div>
            <div>
              <label className={labelCls}>Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputCls}>
                {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Due date & time *</label>
            <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={inputCls} />
            <div className="flex flex-wrap gap-2 mt-2">
              {DUE_CHIPS.map((c) => (
                <button key={c.label} type="button" onClick={() => setDueAt(toLocalInput(c.get()))}
                  className="text-[10px] font-black uppercase tracking-wider bg-slate-100 hover:bg-[#ff9933]/20 rounded-full px-3 py-1 cursor-pointer">{c.label}</button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Category</label>
              <SearchableSelect value={category} onChange={setCategory} options={categoryOptions} placeholder="Select category" />
            </div>
            <div>
              <label className={labelCls}>Watchers (CC)</label>
              <SearchableSelect multiple value={watchers} onChange={setWatchers} options={watcherOptions} placeholder="+ Add watcher" />
            </div>
          </div>
          </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
            <input type="checkbox" checked={requiresVerification} onChange={(e) => { setRequiresVerification(e.target.checked); setVerTouched(true); }} />
            Done ke baad manager/admin verify kare (Requires verification)
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-100">
          <p className="text-[10px] text-slate-400 font-bold">Ctrl+Enter save · Esc close</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl bg-slate-100 text-xs font-black uppercase cursor-pointer">Cancel</button>
            <button type="button" onClick={submit} disabled={saving} className="px-6 py-2.5 rounded-xl bg-[#0a2540] text-white text-xs font-black uppercase tracking-wider disabled:opacity-50 cursor-pointer">
              {saving ? "Saving..." : "Create Task"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
