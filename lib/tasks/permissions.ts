import mongoose from "mongoose";
import dbConnect from "@/lib/dbConnect";
import type { TaskRole } from "./types";

export class TaskError extends Error {
  status: number;
  extra?: Record<string, any>;
  constructor(status: number, message: string, extra?: Record<string, any>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Same hardcoded super-admins as app/api/login + app/api/users: they may not
// exist in the users collection at all.
const HARDCODED_ADMINS = ["admin", "chintan", "hitesh"];

export function getTaskRole(user: { permissions?: Record<string, boolean> } | null | undefined): TaskRole {
  if (user?.permissions?.boss) return "admin";
  if (user?.permissions?.taskManager) return "manager";
  return "staff";
}

export interface TaskActor {
  username: string;
  role: TaskRole;
  /** Manager only: usernames whose managerUsername is this manager. Empty = no team set. */
  team: string[];
}

export function usersCollection() {
  const db = mongoose.connection.db;
  if (!db) throw new TaskError(500, "Database connection not initialized");
  return db.collection("users");
}

/**
 * Identify the acting user. Mirrors the existing routes (client sends the
 * username) but re-reads permissions from the DB on every request.
 * Known gap: a forged username can impersonate a user (spec D4 / section 11).
 */
export async function getActor(req: Request, bodyUsername?: string | null): Promise<TaskActor> {
  await dbConnect();
  const url = new URL(req.url);
  const username = (req.headers.get("x-oms-user") || url.searchParams.get("username") || bodyUsername || "").trim();
  if (!username) throw new TaskError(401, "Login karo pehle (user pehchaan nahi hui)");

  let role: TaskRole;
  if (HARDCODED_ADMINS.includes(username.toLowerCase())) {
    role = "admin";
  } else {
    const user = await usersCollection().findOne({ username }, { projection: { permissions: 1 } });
    if (!user) throw new TaskError(401, "User nahi mila, dobara login karo");
    role = getTaskRole(user as any);
  }

  let team: string[] = [];
  if (role === "manager") {
    const members = await usersCollection()
      .find({ managerUsername: username }, { projection: { username: 1 } })
      .toArray();
    team = members.map((m: any) => m.username);
  }
  return { username, role, team };
}

export const isManagerOrAdmin = (a: TaskActor) => a.role === "admin" || a.role === "manager";

/** Manager with no team members set sees/assigns everything (admin minus delete). */
export const managerSeesAll = (a: TaskActor) => a.role === "manager" && a.team.length === 0;

/** Mongo filter limiting tasks to the ones this actor may see (spec 2.2). */
export function visibilityFilter(a: TaskActor): Record<string, any> {
  if (a.role === "admin" || managerSeesAll(a)) return {};
  const people = a.role === "manager" ? [a.username, ...a.team] : [a.username];
  return {
    $or: [
      { assignee: { $in: people } },
      { assignedBy: { $in: people } },
      { watchers: a.username },
    ],
  };
}

export function canViewTask(a: TaskActor, t: { assignee: string; assignedBy: string; watchers?: string[] }): boolean {
  if (a.role === "admin" || managerSeesAll(a)) return true;
  const people = a.role === "manager" ? [a.username, ...a.team] : [a.username];
  return people.includes(t.assignee) || people.includes(t.assignedBy) || (t.watchers || []).includes(a.username);
}

/** May the actor assign (or reassign) work to `target`? */
export function canAssignTo(a: TaskActor, target: string): boolean {
  if (a.role === "admin") return true;
  if (a.role === "manager") return target === a.username || managerSeesAll(a) || a.team.includes(target);
  return target === a.username;
}
