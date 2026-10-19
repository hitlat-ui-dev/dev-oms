"use client";
import type { TaskDTO } from "@/lib/tasks/types";
import { CATEGORY_LABEL, PRIORITY_META, STATUS_META, TaskCtx, fmtDateTime, relativeDue } from "./taskUi";

interface Props {
  tasks: TaskDTO[];
  ctx: TaskCtx;
  loading: boolean;
  selectable: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  onOpen: (id: string) => void;
  onQuick: (task: TaskDTO, action: "start" | "done" | "verify") => void;
}

export default function TaskTable({ tasks, ctx, loading, selectable, selected, onToggle, onToggleAll, onOpen, onQuick }: Props) {
  const mgr = ctx.role !== "staff";
  const allChecked = tasks.length > 0 && tasks.every((t) => selected.has(t._id));
  // Firm is optional (no longer captured on new tasks) - only show the column when some row has one.
  const showFirm = tasks.some((t) => t.firm);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto xl:overflow-visible">
        <table className="w-full text-sm table-fixed xl:table-auto">
          <thead className="bg-[#0a2540] text-white sticky top-0 z-10">
            <tr className="text-[10px] font-black uppercase tracking-widest text-left">
              {selectable && (
                <th className="w-9 px-3 py-3">
                  <input type="checkbox" checked={allChecked} onChange={(e) => onToggleAll(e.target.checked)} className="cursor-pointer" />
                </th>
              )}
              <th className="px-3 py-3 w-32">Task No</th>
              <th className="px-3 py-3">Title</th>
              {showFirm && <th className="px-3 py-3 hidden xl:table-cell">Firm</th>}
              <th className="px-3 py-3 w-28">Assignee</th>
              <th className="px-3 py-3 w-24">Priority</th>
              <th className="px-3 py-3 w-36">Due</th>
              <th className="px-3 py-3 w-28">Status</th>
              <th className="px-3 py-3 w-28 hidden lg:table-cell">Next F/U</th>
              <th className="px-3 py-3 w-24 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const due = relativeDue(t);
              const links = [t.links?.gemOrderNo && `Order ${t.links.gemOrderNo}`, t.links?.bidNo && `Bid ${t.links.bidNo}`, t.links?.billNo && `Bill ${t.links.billNo}`, t.links?.buyerName]
                .filter(Boolean) as string[];
              const own = t.assignee === ctx.me;
              const canAct = mgr || own;
              const quick =
                t.status === "OPEN" && canAct ? "start"
                : (t.status === "IN_PROGRESS" || t.status === "WAITING") && canAct ? "done"
                : t.status === "DONE" && mgr ? "verify"
                : null;
              return (
                <tr
                  key={t._id}
                  onClick={() => onOpen(t._id)}
                  className={`border-t border-slate-100 hover:bg-slate-50 cursor-pointer border-l-4 ${due.overdue ? "border-l-red-500 bg-red-50/30" : "border-l-transparent"}`}
                >
                  {selectable && (
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(t._id)} onChange={() => onToggle(t._id)} className="cursor-pointer" />
                    </td>
                  )}
                  <td className="px-3 py-3 font-mono text-[11px] font-bold text-slate-500">{t.taskNo}</td>
                  <td className="px-3 py-3 min-w-0">
                    <p className="font-bold text-[#0a2540] truncate">{t.title}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {t.category !== "GENERAL" && (
                        <span className="hidden xl:inline text-[9px] font-black uppercase tracking-wider bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{CATEGORY_LABEL(t.category)}</span>
                      )}
                      {links.map((l) => (
                        <span key={l} className="text-[9px] font-bold bg-sky-50 text-sky-700 border border-sky-100 rounded px-1.5 py-0.5 truncate max-w-[10rem]">{l}</span>
                      ))}
                    </div>
                  </td>
                  {showFirm && <td className="px-3 py-3 hidden xl:table-cell text-xs text-slate-600 truncate">{t.firm}</td>}
                  <td className="px-3 py-3 text-xs font-bold text-slate-700 truncate">{t.assignee}</td>
                  <td className="px-3 py-3">
                    <span className={`text-[10px] font-black uppercase border rounded-full px-2 py-0.5 ${PRIORITY_META[t.priority].cls}`}>{PRIORITY_META[t.priority].label}</span>
                  </td>
                  <td className={`px-3 py-3 text-xs font-bold ${due.overdue ? "text-red-600" : "text-slate-600"}`}>{due.text}</td>
                  <td className="px-3 py-3">
                    <span className={`text-[10px] font-black uppercase border rounded-full px-2 py-0.5 whitespace-nowrap ${STATUS_META[t.status].cls}`}>{STATUS_META[t.status].label}</span>
                  </td>
                  <td className="px-3 py-3 hidden lg:table-cell text-[11px] text-slate-500">{t.nextFollowUpAt ? fmtDateTime(t.nextFollowUpAt) : "-"}</td>
                  <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    {quick && (
                      <button
                        type="button"
                        onClick={() => onQuick(t, quick)}
                        className="text-[10px] font-black uppercase tracking-wider bg-[#ff9933]/15 hover:bg-[#ff9933]/30 text-[#c2410c] border border-[#ff9933]/40 rounded-full px-3 py-1 cursor-pointer"
                      >
                        {quick === "start" ? "Start" : quick === "done" ? "Done" : "Verify"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!tasks.length && (
        <p className="p-10 text-center text-xs font-black uppercase tracking-widest text-slate-400">
          {loading ? "Loading..." : "Koi task nahi mila"}
        </p>
      )}
    </div>
  );
}
