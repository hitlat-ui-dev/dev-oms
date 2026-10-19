/**
 * Phase 1 Task API test runner (HTTP, against a running dev server).
 *
 * Usage (TEST database only):
 *   1. .env.test.local must define MONGODB_URI pointing at a DB whose name contains "test".
 *   2. Start the server with that env, e.g. in PowerShell:
 *        Get-Content .env.test.local | % { if ($_ -match '^([^#=]+)=(.*)$') { Set-Item "env:$($Matches[1])" $Matches[2] } }; npx next dev
 *   3. node scripts/test-tasks-api.ts            (Node 22.6+ runs .ts directly)
 *      TEST_BASE_URL=http://localhost:3000 by default.
 *
 * SAFETY: refuses to run unless the DB name contains "test" and is not dev_oms_db.
 * It seeds testadmin / testmanager / teststaff1 / teststaff2 and then wipes only
 * tasks, task_activities, task_followups and task-* counters in that DB.
 */
import { MongoClient } from "mongodb";
// @ts-ignore - explicit .ts extension is required when Node runs this file directly
import { istDayBounds, istYYMM } from "../lib/tasks/ist.ts";

try { process.loadEnvFile(".env.test.local"); } catch { /* env may already be set */ }

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";
const URI = process.env.MONGODB_URI || "";
const dbName = (() => { try { return new URL(URI.replace("mongodb+srv://", "https://").replace("mongodb://", "http://")).pathname.replace("/", ""); } catch { return ""; } })();

if (!URI || !/test/i.test(dbName) || /dev_oms_db/i.test(dbName)) {
  console.error(`REFUSING TO RUN: MONGODB_URI database "${dbName}" is not a test database (name must contain "test").`);
  process.exit(2);
}

type R = { status: number; data: any };
const results: { name: string; ok: boolean; detail?: string }[] = [];

function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail: ok ? undefined : detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `   -> ${detail}`}`);
}
const expectStatus = (name: string, r: R, status: number) =>
  check(name, r.status === status, `expected ${status}, got ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);

async function call(user: string | null, method: string, path: string, body?: any): Promise<R> {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(user ? { "x-oms-user": user } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const inMinutes = (m: number) => new Date(Date.now() + m * 60000).toISOString();
const inDays = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

const ADMIN = "testadmin", MGR = "testmanager", S1 = "teststaff1", S2 = "teststaff2";

async function seed() {
  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db(dbName);
  const users = db.collection("users");
  const defs = [
    { username: ADMIN, password: "x", permissions: { boss: true } },
    { username: MGR, password: "x", permissions: { taskManager: true } },
    { username: S1, password: "x", permissions: {}, managerUsername: MGR },
    { username: S2, password: "x", permissions: {}, managerUsername: MGR },
  ];
  for (const u of defs) await users.updateOne({ username: u.username }, { $set: u }, { upsert: true });
  await db.collection("tasks").deleteMany({});
  await db.collection("task_activities").deleteMany({});
  await db.collection("task_followups").deleteMany({});
  await db.collection("counters").deleteMany({ _id: { $regex: "^task-" } as any });
  await client.close();
}

async function mk(user: string, body: any) {
  const r = await call(user, "POST", "/api/tasks", { title: "t", dueAt: inDays(1), ...body });
  if (r.status !== 201) throw new Error(`setup create failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.task;
}

async function main() {
  console.log(`DB: ${dbName}   Server: ${BASE}\n`);
  await seed();

  // ---- indexes (once, on the test DB)
  const idx = await call(null, "GET", "/api/admin/ensure-indexes");
  expectStatus("ensure-indexes on test DB", idx, 200);

  // ---- auth
  expectStatus("unknown user -> 401", await call("nobody", "GET", "/api/tasks"), 401);
  expectStatus("no user header -> 401", await call(null, "GET", "/api/tasks"), 401);

  // ---- create + visibility
  const t1 = await mk(MGR, { title: "Manager -> staff1", assignee: S1 });
  check("manager creates task for team member", t1.assignee === S1 && t1.assignedBy === MGR && t1.status === "OPEN");
  const s1List = await call(S1, "GET", "/api/tasks?view=my");
  check("staff1 sees it in My Tasks", s1List.data.tasks?.some((t: any) => t._id === t1._id));

  const selfT = await mk(S1, { title: "staff self task" });
  check("staff creates self task", selfT.assignee === S1);
  expectStatus("staff assigns to someone else -> 403", await call(S1, "POST", "/api/tasks", { title: "x", dueAt: inDays(1), assignee: S2 }), 403);
  expectStatus("manager assigns outside team (admin) -> 403", await call(MGR, "POST", "/api/tasks", { title: "x", dueAt: inDays(1), assignee: ADMIN }), 403);
  expectStatus("assignee that doesn't exist -> 400", await call(ADMIN, "POST", "/api/tasks", { title: "x", dueAt: inDays(1), assignee: "ghost" }), 400);
  expectStatus("missing title -> 400", await call(MGR, "POST", "/api/tasks", { dueAt: inDays(1), assignee: S1 }), 400);
  expectStatus("past due as manager -> 400", await call(MGR, "POST", "/api/tasks", { title: "x", dueAt: inDays(-1), assignee: S1 }), 400);
  const pastAdmin = await call(ADMIN, "POST", "/api/tasks", { title: "past ok for admin", dueAt: inDays(-1), assignee: S1 });
  check("past due as admin -> 201 + warning", pastAdmin.status === 201 && !!pastAdmin.data.warning, JSON.stringify(pastAdmin.data).slice(0, 200));

  // staff2 must not see staff1's task
  expectStatus("staff2 cannot open staff1's task -> 403", await call(S2, "GET", `/api/tasks/${t1._id}`), 403);

  // ---- tabs / views
  expectStatus("staff view=team -> 403", await call(S1, "GET", "/api/tasks?view=team"), 403);
  expectStatus("staff view=all -> 403", await call(S1, "GET", "/api/tasks?view=all"), 403);
  expectStatus("manager view=team -> 200", await call(MGR, "GET", "/api/tasks?view=team"), 200);
  const adminAll = await call(ADMIN, "GET", "/api/tasks?view=all");
  check("admin view=all sees every task", adminAll.status === 200 && adminAll.data.total >= 3, `total=${adminAll.data.total}`);

  // ---- My vs Watching, stats follow the active tab
  const w = await mk(MGR, { title: "watched by staff2", assignee: S1, watchers: [S2] });
  const s2My = await call(S2, "GET", "/api/tasks?view=my");
  const s2Watch = await call(S2, "GET", "/api/tasks?view=watching");
  check("My Tasks excludes watched-only task", !s2My.data.tasks.some((t: any) => t._id === w._id));
  check("Watching tab includes it", s2Watch.data.tasks.some((t: any) => t._id === w._id));
  const sumWatch = await call(S2, "GET", "/api/tasks/summary?view=watching");
  const sumMy = await call(S2, "GET", "/api/tasks/summary?view=my");
  check("summary(watching).open == watching list size", sumWatch.data.open === s2Watch.data.total, JSON.stringify(sumWatch.data));
  check("summary(my).open == 0 for staff2", sumMy.data.open === 0, JSON.stringify(sumMy.data));
  const statList = await call(S1, "GET", "/api/tasks?view=my&stat=open");
  const statSum = await call(S1, "GET", "/api/tasks/summary?view=my");
  check("stats count == table count for same tab+stat", statSum.data.open === statList.data.total, `${statSum.data.open} vs ${statList.data.total}`);

  // ---- taskNo
  const nums = [t1.taskNo, selfT.taskNo, w.taskNo];
  const seqs = nums.map((n: string) => parseInt(n.split("-")[2], 10));
  check("taskNo format TSK-YYMM-0001", nums.every((n: string) => new RegExp(`^TSK-${istYYMM()}-\\d{4}$`).test(n)), nums.join(","));
  check("taskNo increments by 1", seqs[1] === seqs[0] + 1 && seqs[2] === seqs[1] + 1, seqs.join(","));
  check("first task of the month is 0001", seqs[0] === 1, String(seqs[0]));
  check("IST month: 2026-09-30T19:00Z is Oct (2610)", istYYMM(new Date("2026-09-30T19:00:00Z")) === "2610");
  check("IST month: 2026-09-30T18:29:59Z is Sep (2609)", istYYMM(new Date("2026-09-30T18:29:59Z")) === "2609");
  const b = istDayBounds(new Date("2026-10-19T20:00:00Z")); // 01:30 IST on 20 Oct
  check("IST day bounds start/end", b.start.toISOString() === "2026-10-19T18:30:00.000Z" && b.end.toISOString() === "2026-10-20T18:30:00.000Z", `${b.start.toISOString()} ${b.end.toISOString()}`);

  // ---- lifecycle: waiting rules
  const lc = await mk(MGR, { title: "lifecycle", assignee: S1 });
  const st = (user: string, id: string, body: any) => call(user, "POST", `/api/tasks/${id}/status`, body);
  expectStatus("staff cannot change other's task status -> 403", await st(S2, lc._id, { status: "IN_PROGRESS" }), 403);
  expectStatus("start (OPEN -> IN_PROGRESS)", await st(S1, lc._id, { status: "IN_PROGRESS" }), 200);
  expectStatus("waiting without nextFollowUpAt -> 400", await st(S1, lc._id, { status: "WAITING", waitingOn: "BUYER" }), 400);
  expectStatus("waiting without waitingOn -> 400", await st(S1, lc._id, { status: "WAITING", nextFollowUpAt: inDays(1) }), 400);
  const wait = await st(S1, lc._id, { status: "WAITING", waitingOn: "BUYER", nextFollowUpAt: inDays(1) });
  check("waiting with both -> 200 and stored", wait.status === 200 && wait.data.task.waitingOn === "BUYER" && !!wait.data.task.nextFollowUpAt, JSON.stringify(wait.data).slice(0, 200));
  const resume = await st(S1, lc._id, { status: "IN_PROGRESS" });
  check("resume clears waitingOn", resume.status === 200 && resume.data.task.waitingOn === null);

  // ---- done -> verify / reject / reopen
  expectStatus("mark Done (verification required)", await st(S1, lc._id, { status: "DONE" }), 200);
  check("task stays DONE (not auto-closed)", (await call(S1, "GET", `/api/tasks/${lc._id}`)).data.task.status === "DONE");
  expectStatus("staff verify -> 403", await call(S1, "POST", `/api/tasks/${lc._id}/verify`, {}), 403);
  expectStatus("staff reject -> 403", await call(S1, "POST", `/api/tasks/${lc._id}/reject`, { reason: "x" }), 403);
  expectStatus("reject without reason -> 400", await call(MGR, "POST", `/api/tasks/${lc._id}/reject`, {}), 400);
  const rej = await call(MGR, "POST", `/api/tasks/${lc._id}/reject`, { reason: "photo missing" });
  check("reject with reason -> IN_PROGRESS", rej.status === 200 && rej.data.task.status === "IN_PROGRESS" && !rej.data.task.completedAt);
  expectStatus("staff marks Done again", await st(S1, lc._id, { status: "DONE" }), 200);
  const ver = await call(MGR, "POST", `/api/tasks/${lc._id}/verify`, {});
  check("manager verify -> CLOSED with closedBy", ver.status === 200 && ver.data.task.status === "CLOSED" && ver.data.task.closedBy === MGR);
  expectStatus("verify a non-DONE task -> 400", await call(MGR, "POST", `/api/tasks/${lc._id}/verify`, {}), 400);
  expectStatus("edit closed task -> 400", await call(MGR, "PATCH", `/api/tasks/${lc._id}`, { title: "nope" }), 400);
  expectStatus("staff reopen -> 403", await call(S1, "POST", `/api/tasks/${lc._id}/reopen`, { reason: "x" }), 403);
  expectStatus("reopen without reason -> 400", await call(MGR, "POST", `/api/tasks/${lc._id}/reopen`, {}), 400);
  const reo = await call(MGR, "POST", `/api/tasks/${lc._id}/reopen`, { reason: "buyer complained" });
  check("reopen with reason -> OPEN, closed fields cleared", reo.status === 200 && reo.data.task.status === "OPEN" && !reo.data.task.closedAt && !reo.data.task.closedBy);

  // ---- cancel from OPEN / IN_PROGRESS / WAITING
  for (const from of ["OPEN", "IN_PROGRESS", "WAITING"]) {
    const c = await mk(MGR, { title: `cancel from ${from}`, assignee: S1 });
    if (from !== "OPEN") await st(S1, c._id, { status: "IN_PROGRESS" });
    if (from === "WAITING") await st(S1, c._id, { status: "WAITING", waitingOn: "OTHER", nextFollowUpAt: inDays(1) });
    expectStatus(`staff cancel from ${from} -> 403`, await st(S1, c._id, { status: "CANCELLED", reason: "x" }), 403);
    expectStatus(`cancel from ${from} without reason -> 400`, await st(MGR, c._id, { status: "CANCELLED" }), 400);
    const ok = await st(MGR, c._id, { status: "CANCELLED", reason: "not needed" });
    check(`manager cancel from ${from} with reason -> CANCELLED`, ok.status === 200 && ok.data.task.status === "CANCELLED", JSON.stringify(ok.data).slice(0, 200));
  }
  const dn = await mk(MGR, { title: "done can't cancel", assignee: S1 });
  await st(S1, dn._id, { status: "DONE" });
  expectStatus("cancel from DONE -> 400", await st(MGR, dn._id, { status: "CANCELLED", reason: "x" }), 400);

  // ---- auto-close when verification is off
  const auto = await mk(S1, { title: "no verification", requiresVerification: false });
  const autoDone = await st(S1, auto._id, { status: "DONE" });
  check("requiresVerification=false: Done -> CLOSED immediately", autoDone.status === 200 && autoDone.data.task.status === "CLOSED" && !!autoDone.data.task.closedAt, JSON.stringify(autoDone.data).slice(0, 200));

  // ---- reassign
  const ra = await mk(MGR, { title: "reassign me", assignee: S1 });
  expectStatus("staff reassign -> 403", await call(S1, "POST", `/api/tasks/${ra._id}/assign`, { assignee: S2 }), 403);
  expectStatus("manager reassign outside team -> 403", await call(MGR, "POST", `/api/tasks/${ra._id}/assign`, { assignee: ADMIN }), 403);
  const reas = await call(MGR, "POST", `/api/tasks/${ra._id}/assign`, { assignee: S2, note: "load balance" });
  check("manager reassign -> new assignee, old becomes watcher", reas.status === 200 && reas.data.task.assignee === S2 && reas.data.task.watchers.includes(S1), JSON.stringify(reas.data).slice(0, 200));

  // ---- PATCH rules, activity, optimistic lock
  const p = await mk(MGR, { title: "patch me", assignee: S1, checklist: ["one", "two"] });
  expectStatus("staff edits title -> 403", await call(S1, "PATCH", `/api/tasks/${p._id}`, { title: "hack" }), 403);
  const ck = p.checklist.map((c: any) => ({ _id: c._id, text: c.text, done: c._id === p.checklist[0]._id }));
  const ckRes = await call(S1, "PATCH", `/api/tasks/${p._id}`, { checklist: ck });
  check("staff ticks own checklist item", ckRes.status === 200 && ckRes.data.task.checklist[0].done === true && ckRes.data.task.checklist[0].doneBy === S1, JSON.stringify(ckRes.data).slice(0, 200));

  const fresh = (await call(MGR, "GET", `/api/tasks/${p._id}`)).data.task;
  const pr = await call(MGR, "PATCH", `/api/tasks/${p._id}`, { priority: "HIGH", expectedUpdatedAt: fresh.updatedAt });
  expectStatus("PATCH with current expectedUpdatedAt -> 200", pr, 200);
  const stale = await call(MGR, "PATCH", `/api/tasks/${p._id}`, { priority: "URGENT", expectedUpdatedAt: fresh.updatedAt });
  check("PATCH with stale expectedUpdatedAt -> 409", stale.status === 409, `${stale.status} ${JSON.stringify(stale.data)}`);
  expectStatus("due date change (manager)", await call(MGR, "PATCH", `/api/tasks/${p._id}`, { dueAt: inDays(5) }), 200);

  const cm = await call(S1, "POST", `/api/tasks/${p._id}/comments`, { text: `hello @${MGR} and @ghost` });
  check("comment saved, mentions limited to real users", cm.status === 201 && JSON.stringify(cm.data.activity.to) === JSON.stringify([MGR]), JSON.stringify(cm.data).slice(0, 200));
  expectStatus("empty comment -> 400", await call(S1, "POST", `/api/tasks/${p._id}/comments`, { text: "  " }), 400);
  expectStatus("outsider comment -> 403", await call(S2, "POST", `/api/tasks/${p._id}/comments`, { text: "hi" }), 403);

  const detail = (await call(MGR, "GET", `/api/tasks/${p._id}`)).data;
  const types = new Set(detail.activities.map((a: any) => a.type));
  check("activity has CREATED/CHECKLIST/PRIORITY_CHANGED/DUE_CHANGED/COMMENT", ["CREATED", "CHECKLIST", "PRIORITY_CHANGED", "DUE_CHANGED", "COMMENT"].every((t) => types.has(t)), [...types].join(","));
  check("every activity row has user + timestamp", detail.activities.every((a: any) => a.by && a.createdAt));
  const lcAct = (await call(MGR, "GET", `/api/tasks/${lc._id}`)).data.activities.map((a: any) => a.type);
  check("lifecycle activity: STATUS_CHANGED/REJECTED/VERIFIED/REOPENED all logged", ["STATUS_CHANGED", "REJECTED", "VERIFIED", "REOPENED"].every((t) => lcAct.includes(t)), lcAct.join(","));
  check("reassign logged REASSIGNED", (await call(MGR, "GET", `/api/tasks/${ra._id}`)).data.activities.some((a: any) => a.type === "REASSIGNED"));

  // ---- IST "today" in summary: due today counts, due tomorrow(+2d) does not
  const before = (await call(S2, "GET", "/api/tasks/summary?view=my")).data;
  const { end } = istDayBounds();
  await mk(MGR, { title: "due later", assignee: S2, dueAt: new Date(end.getTime() + 2 * 86400000).toISOString() });
  const afterFar = (await call(S2, "GET", "/api/tasks/summary?view=my")).data;
  check("task due in 2 days does NOT count as dueToday", afterFar.dueToday === before.dueToday && afterFar.open === before.open + 1, JSON.stringify({ before, afterFar }));
  const fu = await mk(MGR, { title: "fu far", assignee: S2, dueAt: new Date(end.getTime() + 3 * 86400000).toISOString() });
  await st(S2, fu._id, { status: "WAITING", waitingOn: "BUYER", nextFollowUpAt: new Date(end.getTime() + 86400000).toISOString() });
  const afterFu = (await call(S2, "GET", "/api/tasks/summary?view=my")).data;
  check("follow-up tomorrow does NOT count as followUpsToday", afterFu.followUpsToday === before.followUpsToday, JSON.stringify({ before, afterFu }));
  const fu2 = await mk(MGR, { title: "fu today", assignee: S2, dueAt: new Date(end.getTime() + 3 * 86400000).toISOString() });
  await st(S2, fu2._id, { status: "WAITING", waitingOn: "BUYER", nextFollowUpAt: new Date(end.getTime() - 60000).toISOString() });
  const afterFu2 = (await call(S2, "GET", "/api/tasks/summary?view=my")).data;
  check("follow-up before end of IST day counts as followUpsToday", afterFu2.followUpsToday === before.followUpsToday + 1, JSON.stringify({ before, afterFu2 }));
  const soon = await mk(MGR, { title: "due in 2 min", assignee: S2, dueAt: inMinutes(2) });
  const afterToday = (await call(S2, "GET", "/api/tasks/summary?view=my")).data;
  const nowIsLastMinutes = end.getTime() - Date.now() < 3 * 60000; // edge: crossing midnight IST
  check("task due in 2 minutes counts as dueToday", nowIsLastMinutes || afterToday.dueToday === afterFu2.dueToday + 1, JSON.stringify({ afterFu2, afterToday }));
  void soon;

  // ---- overdue
  const over = await call(S1, "GET", "/api/tasks?view=my&overdue=true");
  check("overdue filter returns the admin past-due task", over.data.tasks.some((t: any) => t.title === "past ok for admin"), `total=${over.data.total}`);

  // ---- soft delete
  const del = await mk(MGR, { title: "to delete", assignee: S1 });
  expectStatus("staff delete -> 403", await call(S1, "DELETE", `/api/tasks/${del._id}`), 403);
  expectStatus("manager delete -> 403", await call(MGR, "DELETE", `/api/tasks/${del._id}`), 403);
  expectStatus("admin delete -> 200", await call(ADMIN, "DELETE", `/api/tasks/${del._id}`), 200);
  check("deleted task absent from list", !(await call(ADMIN, "GET", "/api/tasks?view=all&limit=200")).data.tasks.some((t: any) => t._id === del._id));
  expectStatus("deleted task detail -> 404", await call(ADMIN, "GET", `/api/tasks/${del._id}`), 404);

  // ---- users endpoint
  const us = await call(S1, "GET", "/api/tasks/users");
  check("users list has no password field, roles resolved", us.status === 200 && us.data.every((u: any) => !("password" in u)) && us.data.find((u: any) => u.username === MGR)?.role === "manager" && us.data.find((u: any) => u.username === ADMIN)?.role === "admin");
  check("staff sees only self as assignable", us.data.filter((u: any) => u.assignable).map((u: any) => u.username).join() === S1);

  // ---- report
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log("\nFAILED:");
    for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error("Test run crashed:", e); process.exit(1); });
