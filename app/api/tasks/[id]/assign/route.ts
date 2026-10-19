import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { assignTask } from "@/lib/tasks/taskService";

// POST { assignee, note? } - reassign (manager team / admin)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const { id } = await params;
    const body = await readBody(req);
    const actor = await getActor(req, body.username);
    return assignTask(actor, id, body);
  });
}
