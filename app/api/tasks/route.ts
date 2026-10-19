import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { createTask, listTasks } from "@/lib/tasks/taskService";

// GET /api/tasks?view=my|byme|team|all&status=&priority=&firm=&category=&assignee=&overdue=true&stat=&q=&page=&limit=&sort=
export async function GET(req: Request) {
  return respond(async () => {
    const actor = await getActor(req);
    return listTasks(actor, new URL(req.url).searchParams);
  });
}

// POST /api/tasks - create
export async function POST(req: Request) {
  return respond(async () => {
    const body = await readBody(req);
    const actor = await getActor(req, body.username);
    return createTask(actor, body);
  }, 201);
}
