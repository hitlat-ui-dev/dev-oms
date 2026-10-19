import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { rejectTask } from "@/lib/tasks/taskService";

// POST { reason } - DONE -> IN_PROGRESS (manager/admin)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const { id } = await params;
    const body = await readBody(req);
    const actor = await getActor(req, body.username);
    return rejectTask(actor, id, body);
  });
}
