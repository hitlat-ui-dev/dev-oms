import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { addComment } from "@/lib/tasks/taskService";

// POST { text } - internal comment, @username mentions stored in activity.to
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const { id } = await params;
    const body = await readBody(req);
    const actor = await getActor(req, body.username);
    return addComment(actor, id, body);
  }, 201);
}
