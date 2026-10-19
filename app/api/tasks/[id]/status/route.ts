import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { changeStatus } from "@/lib/tasks/taskService";

// POST { status, reason?, waitingOn?, nextFollowUpAt? } - Start / Waiting / Done / Resume / Cancel
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const { id } = await params;
    const body = await readBody(req);
    const actor = await getActor(req, body.username);
    return changeStatus(actor, id, body);
  });
}
