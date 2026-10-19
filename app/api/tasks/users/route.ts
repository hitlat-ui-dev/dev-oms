import { getActor } from "@/lib/tasks/permissions";
import { respond } from "@/lib/tasks/http";
import { listTaskUsers } from "@/lib/tasks/taskService";

// GET /api/tasks/users - assignee list with open-task counts (never returns passwords)
export async function GET(req: Request) {
  return respond(async () => {
    const actor = await getActor(req);
    return listTaskUsers(actor);
  });
}
