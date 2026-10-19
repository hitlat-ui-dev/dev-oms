import type { TaskPriority, TaskRole, TaskStatus, TaskUserDTO } from "@/lib/tasks/types";

/* ---------------------------------------------------------------- session */

export interface SessionUser {
  username: string;
  permissions?: Record<string, boolean>;
}

export function readSessionUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem("oms_user");
    if (!raw) return null;
    const u = JSON.parse(raw);
    return u?.username ? u : null;
  } catch {
    return null;
  }
}

/** Mirrors lib/tasks/permissions.ts getTaskRole (+ the hardcoded super-admins) for first paint. */
export function roleFromSession(u: SessionUser | null): TaskRole {
  if (!u) return "staff";
  if (["admin", "chintan", "hitesh"].includes(u.username.toLowerCase()) || u.permissions?.boss) return "admin";
  return u.permissions?.taskManager ? "manager" : "staff";
}

export interface TaskCtx {
  me: string;
  role: TaskRole;
  users: TaskUserDTO[];
  notify: (msg: string, kind?: "ok" | "err") => void;
}

/* -------------------------------------------------------------------- api */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(path: string, me: string, init: { method?: string; body?: any } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method || "GET",
    headers: { "Content-Type": "application/json", "x-oms-user": me },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error || "Request fail ho gayi");
  return data as T;
}

/* ---------------------------------------------------------------- display */

export const STATUS_META: Record<TaskStatus, { label: string; cls: string }> = {
  OPEN: { label: "Open", cls: "bg-slate-100 text-slate-700 border-slate-200" },
  IN_PROGRESS: { label: "In Progress", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  WAITING: { label: "Waiting", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  DONE: { label: "Done (verify)", cls: "bg-violet-50 text-violet-700 border-violet-200" },
  CLOSED: { label: "Closed", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CANCELLED: { label: "Cancelled", cls: "bg-rose-50 text-rose-400 border-rose-200 line-through" },
};

export const PRIORITY_META: Record<TaskPriority, { label: string; cls: string }> = {
  LOW: { label: "Low", cls: "bg-slate-100 text-slate-500 border-slate-200" },
  NORMAL: { label: "Normal", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  HIGH: { label: "High", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  URGENT: { label: "Urgent", cls: "bg-red-50 text-red-700 border-red-300" },
};

export const CATEGORY_LABEL = (c: string) => c.replace(/_/g, " ").toLowerCase();

const IST = "Asia/Kolkata";

/** dd-MMM-yyyy hh:mm a, in IST. */
export function fmtDateTime(d?: string | Date | null): string {
  if (!d) return "-";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "-";
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: IST, day: "2-digit", month: "short", year: "numeric" })
    .format(date).replace(/ /g, "-");
  const time = new Intl.DateTimeFormat("en-US", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: true }).format(date);
  return `${day} ${time}`;
}

const istDayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d); // YYYY-MM-DD
const istTime = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true }).format(d);

export const ACTIVE = ["OPEN", "IN_PROGRESS", "WAITING"];
export const isOverdue = (t: { status: string; dueAt: string }) => ACTIVE.includes(t.status) && new Date(t.dueAt).getTime() < Date.now();

/** "Today 5:00 PM", "Tomorrow 10:00 AM", "2 days overdue", "3h overdue". */
export function relativeDue(t: { status: string; dueAt: string }): { text: string; overdue: boolean } {
  const due = new Date(t.dueAt);
  const now = new Date();
  if (isOverdue(t)) {
    const mins = Math.floor((now.getTime() - due.getTime()) / 60000);
    if (mins < 60) return { text: `${Math.max(mins, 1)}m overdue`, overdue: true };
    if (mins < 24 * 60) return { text: `${Math.floor(mins / 60)}h overdue`, overdue: true };
    const days = Math.floor(mins / (24 * 60));
    return { text: `${days} day${days > 1 ? "s" : ""} overdue`, overdue: true };
  }
  const dayDiff = Math.round((Date.parse(istDayKey(due)) - Date.parse(istDayKey(now))) / 86400000);
  if (dayDiff === 0) return { text: `Today ${istTime(due)}`, overdue: false };
  if (dayDiff === 1) return { text: `Tomorrow ${istTime(due)}`, overdue: false };
  return { text: fmtDateTime(due), overdue: false };
}

/* ------------------------------------------------------------ date chips */

const pad = (n: number) => String(n).padStart(2, "0");

/** Value for <input type="datetime-local"> (browser-local time; OMS users are in IST). */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const atHour = (d: Date, h: number, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export const DUE_CHIPS: { label: string; get: () => Date }[] = [
  { label: "Today EOD", get: () => { const d = atHour(new Date(), 19); return d.getTime() > Date.now() ? d : atHour(new Date(), 23, 59); } },
  { label: "Tomorrow", get: () => atHour(addDays(new Date(), 1), 18) },
  { label: "3 days", get: () => atHour(addDays(new Date(), 3), 18) },
  { label: "Next week", get: () => atHour(addDays(new Date(), 7), 18) },
];

export const FOLLOWUP_CHIPS: { label: string; get: () => Date }[] = [
  { label: "Tomorrow", get: () => atHour(addDays(new Date(), 1), 10) },
  { label: "2 days", get: () => atHour(addDays(new Date(), 2), 10) },
  {
    label: "Next Mon",
    get: () => { const now = new Date(); const diff = ((8 - now.getDay()) % 7) || 7; return atHour(addDays(now, diff), 10); },
  },
  { label: "1 week", get: () => atHour(addDays(new Date(), 7), 10) },
];
