// Shared task types/enums for the API routes and the dashboard UI.

export const TASK_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING", "DONE", "CLOSED", "CANCELLED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_CATEGORIES = [
  "ORDER", "DELIVERY", "BILLING", "PAYMENT_FOLLOWUP", "BID",
  "GEM_CATALOGUE", "DOCUMENT", "PURCHASE", "ACCOUNTS", "GENERAL",
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const WAITING_ON = ["BUYER", "STAFF", "MATERIAL", "PAYMENT", "OTHER"] as const;
export type WaitingOn = (typeof WAITING_ON)[number];

export type TaskRole = "admin" | "manager" | "staff";

/** Statuses in which a task is still live (overdue clock runs). */
export const ACTIVE_STATUSES: TaskStatus[] = ["OPEN", "IN_PROGRESS", "WAITING"];

/** Statuses that no longer count as "pending" for the navbar badge: DONE = "Done (verify)",
 *  CLOSED = "Done", CANCELLED = no longer anybody's work. Edit here to change the badge rule. */
export const DONE_STATUSES: TaskStatus[] = ["DONE", "CLOSED", "CANCELLED"];

/** Single source of truth for lifecycle transitions made via the status route.
 *  DONE -> CLOSED/IN_PROGRESS go through verify/reject, CLOSED -> OPEN through reopen. */
export const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  OPEN: ["IN_PROGRESS", "WAITING", "DONE", "CANCELLED"],
  IN_PROGRESS: ["WAITING", "DONE", "CANCELLED"],
  WAITING: ["IN_PROGRESS", "DONE", "CANCELLED"],
  DONE: ["CLOSED", "IN_PROGRESS"],
  CLOSED: ["OPEN"],
  CANCELLED: [],
};

export interface ChecklistItemDTO {
  _id?: string;
  text: string;
  done: boolean;
  doneBy?: string;
  doneAt?: string;
}

export interface TaskDTO {
  _id: string;
  taskNo: string;
  title: string;
  description: string;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  firm: string;
  links: {
    sellerOrderId?: string; gemOrderNo?: string; bidId?: string; bidNo?: string;
    billId?: string; billNo?: string; buyerName?: string; buyerPhone?: string;
  };
  assignedBy: string;
  assignee: string;
  watchers: string[];
  dueAt: string;
  startedAt?: string;
  completedAt?: string;
  closedAt?: string;
  closedBy?: string;
  requiresVerification: boolean;
  waitingOn: WaitingOn | null;
  nextFollowUpAt?: string;
  followUpCount: number;
  checklist: ChecklistItemDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskActivityDTO {
  _id: string;
  taskId: string;
  by: string | null;
  type: string;
  from?: any;
  to?: any;
  text: string;
  createdAt: string;
}

export interface TaskUserDTO {
  username: string;
  role: TaskRole;
  managerUsername: string | null;
  openCount: number;
  /** Whether the acting user may assign tasks to this person. */
  assignable: boolean;
}

export interface TaskSummaryDTO {
  open: number;
  dueToday: number;
  overdue: number;
  waiting: number;
  followUpsToday: number;
  toVerify: number;
}

export type TaskStatKey = "open" | "dueToday" | "overdue" | "waiting" | "followUpsToday" | "toVerify";
