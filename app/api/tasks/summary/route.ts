import { getActor } from "@/lib/tasks/permissions";
import { respond } from "@/lib/tasks/http";
import { taskSummary } from "@/lib/tasks/taskService";

// GET /api/tasks/summary?view=my|byme|team|all - counts for the stats row
export async function GET(req: Request) {
  return respond(async () => {
    const actor = await getActor(req);
    return taskSummary(actor, new URL(req.url).searchParams.get("view") || "my");
  });
}
