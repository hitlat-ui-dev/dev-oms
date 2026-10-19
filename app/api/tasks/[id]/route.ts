import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { getTaskDetail, patchTask, softDeleteTask } from "@/lib/tasks/taskService";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return respond(async () => {
    const { id } = await params;
    const actor = await getActor(req);
    return getTaskDetail(actor, id);
  });
}

// PATCH body may carry expectedUpdatedAt for the optimistic lock (409 on mismatch).
export async function PATCH(req: Request, { params }: Ctx) {
  return respond(async () => {
    const { id } = await params;
    const body = await readBody(req);
    const actor = await getActor(req, body.username);
    return patchTask(actor, id, body);
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return respond(async () => {
    const { id } = await params;
    const actor = await getActor(req);
    return softDeleteTask(actor, id);
  });
}
