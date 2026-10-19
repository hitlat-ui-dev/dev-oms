"use client";
import type { TaskStatKey, TaskSummaryDTO } from "@/lib/tasks/types";

const CARDS: { key: TaskStatKey; label: string; cls: string; active: string }[] = [
  { key: "open", label: "Open", cls: "text-[#0a2540]", active: "ring-[#0a2540]" },
  { key: "dueToday", label: "Due Today", cls: "text-[#ea580c]", active: "ring-[#ea580c]" },
  { key: "overdue", label: "Overdue", cls: "text-red-600", active: "ring-red-600" },
  { key: "waiting", label: "Waiting", cls: "text-amber-600", active: "ring-amber-500" },
  { key: "followUpsToday", label: "Follow-ups Today", cls: "text-sky-700", active: "ring-sky-600" },
  { key: "toVerify", label: "To Verify", cls: "text-violet-700", active: "ring-violet-600" },
];

interface Props {
  summary: TaskSummaryDTO | null;
  active: TaskStatKey | null;
  onSelect: (key: TaskStatKey | null) => void;
}

export default function TaskStatsRow({ summary, active, onSelect }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {CARDS.map((c) => {
        const isActive = active === c.key;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onSelect(isActive ? null : c.key)}
            className={`bg-white rounded-2xl border border-slate-200 p-4 text-left transition-all hover:shadow-md cursor-pointer ${isActive ? `ring-2 ${c.active}` : ""}`}
          >
            <p className={`text-3xl font-black leading-none ${c.cls}`}>{summary ? summary[c.key] : "-"}</p>
            <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-slate-500">{c.label}</p>
          </button>
        );
      })}
    </div>
  );
}
