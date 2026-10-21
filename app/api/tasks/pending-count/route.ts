import { getActor } from "@/lib/tasks/permissions";
import { respond } from "@/lib/tasks/http";
import { pendingTaskCount } from "@/lib/tasks/taskService";

// GET /api/tasks/pending-count -> { count } for the TASKS navbar badge.
// Always the acting user's own tasks (identity from the x-oms-user header, never a userId param).
export async function GET(req: Request) {
  return respond(async () => {
    const actor = await getActor(req);
    return pendingTaskCount(actor);
  });
}
