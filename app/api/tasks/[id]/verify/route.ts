import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { verifyTask } from "@/lib/tasks/taskService";

// POST - DONE -> CLOSED (manager/admin)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const { id } = await params;
    const body = await readBody(req);
    const actor = await getActor(req, body.username);
    return verifyTask(actor, id);
  });
}
