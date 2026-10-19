"use client";
import { useCallback, useEffect, useState } from "react";
import { FiX } from "react-icons/fi";
import { TASK_PRIORITIES, WAITING_ON, ChecklistItemDTO, TaskActivityDTO, TaskDTO } from "@/lib/tasks/types";
import {
  ApiError, FOLLOWUP_CHIPS, PRIORITY_META, STATUS_META, TaskCtx, api, fmtDateTime, relativeDue, toLocalInput,
} from "./taskUi";

interface Props {
  taskId: string;
  ctx: TaskCtx;
  onClose: () => void;
  /** Called after any successful mutation so the list + stats refetch. */
  onChanged: () => void;
}

type Panel = null | "waiting" | "reject" | "reopen" | "cancel";
type ActTab = "all" | "comments" | "system";

const btn = "px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider cursor-pointer disabled:opacity-50";
const field = "w-full p-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#ff9933]";

export default function TaskDrawer({ taskId, ctx, onClose, onChanged }: Props) {
  const [task, setTask] = useState<TaskDTO | null>(null);
  const [activities, setActivities] = useState<TaskActivityDTO[]>([]);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [reason, setReason] = useState("");
  const [waitingOn, setWaitingOn] = useState<string>("BUYER");
  const [nextFollowUp, setNextFollowUp] = useState("");
  const [comment, setComment] = useState("");
  const [tab, setTab] = useState<ActTab>("all");
  const [title, setTitle] = useState("");

  const mgr = ctx.role !== "staff";
  const load = useCallback(async () => {
    try {
      const res = await api<{ task: TaskDTO; activities: TaskActivityDTO[] }>(`/api/tasks/${taskId}`, ctx.me);
      setTask(res.task);
      setTitle(res.task.title);
      setActivities(res.activities);
      setError("");
      setConflict(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Task load nahi hua");
    }
  }, [taskId, ctx.me]);

  useEffect(() => { setTask(null); setPanel(null); load(); }, [load]);

  /** Run a mutation, refresh drawer + list, surface 409 with a refresh option. */
  async function run(fn: () => Promise<any>, okMsg?: string) {
    setBusy(true);
    try {
      await fn();
      setPanel(null);
      setReason("");
      await load();
      onChanged();
      if (okMsg) ctx.notify(okMsg);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      ctx.notify(e instanceof ApiError ? e.message : "Action fail ho gaya", "err");
    } finally {
      setBusy(false);
    }
  }

  if (!task) {
    return (
      <Shell onClose={onClose}>
        <p className="p-10 text-center text-xs font-black uppercase tracking-widest text-slate-400">{error || "Loading..."}</p>
      </Shell>
    );
  }

  const own = task.assignee === ctx.me;
  const canAct = mgr || own;
  const live = task.status !== "CLOSED" && task.status !== "CANCELLED";
  const due = relativeDue(task);
  const post = (path: string, body: any = {}) => api(`/api/tasks/${task._id}/${path}`, ctx.me, { method: "POST", body });
  const patch = (body: any) => api(`/api/tasks/${task._id}`, ctx.me, { method: "PATCH", body: { ...body, expectedUpdatedAt: task.updatedAt } });
  const setStatus = (status: string, extra: any = {}) => run(() => post("status", { status, ...extra }));

  const checklist = task.checklist || [];
  const doneCount = checklist.filter((c) => c.done).length;

  async function toggleItem(item: ChecklistItemDTO) {
    const next = checklist.map((c) => ({ _id: c._id, text: c.text, done: c._id === item._id ? !c.done : c.done }));
    await run(() => patch({ checklist: next }));
    if (next.length && next.every((c) => c.done) && task!.status !== "DONE") {
      ctx.notify("Checklist complete - Mark Done karo?");
    }
  }

  const filteredActs = activities.filter((a) =>
    tab === "all" ? true : tab === "comments" ? a.type === "COMMENT" : a.type !== "COMMENT"
  );

  return (
    <Shell onClose={onClose}>
      {/* Header */}
      <div className="p-5 border-b border-slate-100 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] font-bold text-slate-400">{task.taskNo}</p>
            {mgr && live ? (
              <input
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => title.trim() && title !== task.title && run(() => patch({ title }))}
                className="w-full text-lg font-black text-[#0a2540] bg-transparent border-b border-transparent hover:border-slate-200 focus:border-[#ff9933] outline-none"
              />
            ) : (
              <h2 className="text-lg font-black text-[#0a2540]">{task.title}</h2>
            )}
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 cursor-pointer shrink-0"><FiX /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[10px] font-black uppercase border rounded-full px-2.5 py-0.5 ${STATUS_META[task.status].cls}`}>{STATUS_META[task.status].label}</span>
          <span className={`text-[10px] font-black uppercase border rounded-full px-2.5 py-0.5 ${PRIORITY_META[task.priority].cls}`}>{PRIORITY_META[task.priority].label}</span>
          <span className={`text-xs font-bold ${due.overdue ? "text-red-600" : "text-slate-500"}`}>{due.text}</span>
          {due.overdue && <span className="text-[10px] font-black uppercase bg-red-600 text-white rounded-full px-2 py-0.5">Overdue</span>}
        </div>
      </div>

      {conflict && (
        <div className="m-5 mb-0 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-800 flex items-center justify-between gap-3">
          Task kisi aur ne update kiya hai, refresh karo
          <button type="button" onClick={load} className="bg-amber-500 text-white rounded-lg px-3 py-1 font-black uppercase cursor-pointer">Refresh</button>
        </div>
      )}

      {/* Actions */}
      <div className="p-5 space-y-3 border-b border-slate-100">
        <div className="flex flex-wrap gap-2">
          {canAct && task.status === "OPEN" && <button disabled={busy} onClick={() => setStatus("IN_PROGRESS")} className={`${btn} bg-blue-600 text-white`}>Start</button>}
          {canAct && task.status === "WAITING" && <button disabled={busy} onClick={() => setStatus("IN_PROGRESS")} className={`${btn} bg-blue-600 text-white`}>Resume</button>}
          {canAct && (task.status === "OPEN" || task.status === "IN_PROGRESS") && (
            <button disabled={busy} onClick={() => setPanel(panel === "waiting" ? null : "waiting")} className={`${btn} bg-amber-100 text-amber-800`}>Mark Waiting</button>
          )}
          {canAct && (task.status === "OPEN" || task.status === "IN_PROGRESS" || task.status === "WAITING") && (
            <button disabled={busy} onClick={() => setStatus("DONE")} className={`${btn} bg-emerald-600 text-white`}>Mark Done</button>
          )}
          {mgr && task.status === "DONE" && <button disabled={busy} onClick={() => run(() => post("verify"), "Verify karke close kiya")} className={`${btn} bg-emerald-600 text-white`}>Verify & Close</button>}
          {mgr && task.status === "DONE" && <button disabled={busy} onClick={() => setPanel(panel === "reject" ? null : "reject")} className={`${btn} bg-red-100 text-red-700`}>Reject</button>}
          {mgr && task.status === "CLOSED" && <button disabled={busy} onClick={() => setPanel(panel === "reopen" ? null : "reopen")} className={`${btn} bg-violet-100 text-violet-700`}>Reopen</button>}
          {mgr && (task.status === "OPEN" || task.status === "IN_PROGRESS" || task.status === "WAITING") && <button disabled={busy} onClick={() => setPanel(panel === "cancel" ? null : "cancel")} className={`${btn} bg-slate-100 text-slate-600`}>Cancel</button>}
        </div>

        {panel === "waiting" && (
          <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200 space-y-2">
            <select value={waitingOn} onChange={(e) => setWaitingOn(e.target.value)} className={field}>
              {WAITING_ON.map((w) => <option key={w} value={w}>Waiting on: {w}</option>)}
            </select>
            <input type="datetime-local" value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} className={field} />
            <div className="flex flex-wrap gap-2">
              {FOLLOWUP_CHIPS.map((c) => (
                <button key={c.label} type="button" onClick={() => setNextFollowUp(toLocalInput(c.get()))}
                  className="text-[10px] font-black uppercase bg-white border border-amber-200 hover:bg-amber-100 rounded-full px-3 py-1 cursor-pointer">{c.label}</button>
              ))}
            </div>
            <button
              disabled={busy}
              onClick={() => (nextFollowUp ? setStatus("WAITING", { waitingOn, nextFollowUpAt: new Date(nextFollowUp).toISOString() }) : ctx.notify("Next follow-up date zaroori hai", "err"))}
              className={`${btn} bg-amber-500 text-white`}
            >Set Waiting</button>
          </div>
        )}
        {(panel === "reject" || panel === "reopen" || panel === "cancel") && (
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (zaroori)" className={field} />
            <button
              disabled={busy}
              onClick={() => {
                if (!reason.trim()) return ctx.notify("Reason likhna zaroori hai", "err");
                if (panel === "cancel") return setStatus("CANCELLED", { reason });
                return run(() => post(panel, { reason }), panel === "reject" ? "Task reject hua" : "Task reopen hua");
              }}
              className={`${btn} bg-[#0a2540] text-white`}
            >Confirm {panel}</button>
          </div>
        )}
      </div>

      {/* Details */}
      <div className="p-5 space-y-4 border-b border-slate-100">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <Info label="Assignee">
            {mgr && live ? (
              <select
                value={task.assignee}
                disabled={busy}
                onChange={(e) => e.target.value !== task.assignee && run(() => post("assign", { assignee: e.target.value }), "Reassign ho gaya")}
                className={field}
              >
                {!ctx.users.some((u) => u.username === task.assignee) && <option value={task.assignee}>{task.assignee}</option>}
                {ctx.users.filter((u) => u.assignable || u.username === task.assignee).map((u) => (
                  <option key={u.username} value={u.username}>{u.username} ({u.openCount} open)</option>
                ))}
              </select>
            ) : <b>{task.assignee}</b>}
          </Info>
          <Info label="Assigned by"><b>{task.assignedBy}</b></Info>
          <Info label="Due">
            {mgr && live ? (
              <input
                type="datetime-local"
                defaultValue={toLocalInput(new Date(task.dueAt))}
                key={task.updatedAt}
                onBlur={(e) => e.target.value && new Date(e.target.value).getTime() !== new Date(task.dueAt).getTime() && run(() => patch({ dueAt: new Date(e.target.value).toISOString() }))}
                className={field}
              />
            ) : <b>{fmtDateTime(task.dueAt)}</b>}
          </Info>
          <Info label="Priority">
            {mgr && live ? (
              <select value={task.priority} disabled={busy} onChange={(e) => run(() => patch({ priority: e.target.value }))} className={field}>
                {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            ) : <b>{task.priority}</b>}
          </Info>
          {task.firm && <Info label="Firm"><b>{task.firm}</b></Info>}
          <Info label="Verification"><b>{task.requiresVerification ? "Required" : "Not required"}</b></Info>
          {task.status === "WAITING" && (
            <>
              <Info label="Waiting on"><b>{task.waitingOn}</b></Info>
              <Info label="Next follow-up"><b>{fmtDateTime(task.nextFollowUpAt)}</b></Info>
            </>
          )}
          {task.completedAt && <Info label="Completed"><b>{fmtDateTime(task.completedAt)}</b></Info>}
          {task.closedAt && <Info label="Closed"><b>{fmtDateTime(task.closedAt)} by {task.closedBy}</b></Info>}
        </div>

        {(task.watchers?.length > 0) && (
          <p className="text-xs text-slate-500"><b className="uppercase tracking-widest text-[10px]">Watchers:</b> {task.watchers.join(", ")}</p>
        )}

        {Object.values(task.links || {}).some(Boolean) && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(task.links).filter(([, v]) => v).map(([k, v]) => (
              <span key={k} className="text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-100 rounded-full px-2.5 py-1">{k.replace(/([A-Z])/g, " $1").toLowerCase()}: {v}</span>
            ))}
          </div>
        )}

        {task.description && <p className="text-sm text-slate-700 whitespace-pre-wrap">{task.description}</p>}

        {checklist.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Checklist</p>
              <p className="text-[10px] font-bold text-slate-500">{doneCount}/{checklist.length}</p>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-2">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(doneCount / checklist.length) * 100}%` }} />
            </div>
            <div className="space-y-1">
              {checklist.map((c) => (
                <label key={c._id} className={`flex items-center gap-2 text-sm ${canAct && live ? "cursor-pointer" : "opacity-70"}`}>
                  <input type="checkbox" checked={c.done} disabled={busy || !canAct || !live} onChange={() => toggleItem(c)} />
                  <span className={c.done ? "line-through text-slate-400" : "text-slate-700"}>{c.text}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Activity */}
      <div className="p-5 space-y-3">
        <div className="flex gap-1.5">
          {(["all", "comments", "system"] as ActTab[]).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`text-[10px] font-black uppercase tracking-wider rounded-full px-3 py-1 cursor-pointer ${tab === t ? "bg-[#0a2540] text-white" : "bg-slate-100 text-slate-600"}`}>{t}</button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!comment.trim()) return;
            run(() => post("comments", { text: comment }).then(() => setComment("")));
          }}
          className="flex gap-2"
        >
          <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} placeholder="Comment likho... (@username se mention)" className={field} />
          <button disabled={busy || !comment.trim()} className={`${btn} bg-[#ff9933] text-white shrink-0`}>Post</button>
        </form>

        <ul className="space-y-2">
          {filteredActs.map((a) => (
            <li key={a._id} className={`text-xs rounded-xl p-3 border ${a.type === "COMMENT" ? "bg-sky-50/50 border-sky-100" : "bg-slate-50 border-slate-100"}`}>
              <div className="flex justify-between gap-2 text-[10px] font-bold text-slate-400">
                <span className="uppercase tracking-wider">{a.by || "system"} · {a.type.replace(/_/g, " ")}</span>
                <span>{fmtDateTime(a.createdAt)}</span>
              </div>
              {a.text && <p className="mt-1 text-slate-700 whitespace-pre-wrap">{a.text}</p>}
            </li>
          ))}
          {!filteredActs.length && <li className="text-xs text-slate-400 font-bold">Kuch nahi</li>}
        </ul>
      </div>
    </Shell>
  );
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="w-full max-w-xl bg-white h-full overflow-y-auto shadow-2xl">{children}</aside>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-0.5">{label}</p>
      <div className="text-slate-800">{children}</div>
    </div>
  );
}
