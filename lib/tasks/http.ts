import { NextResponse } from "next/server";
import { TaskError } from "./permissions";

/** Parse a JSON body, tolerating empty/invalid bodies (POST actions without a payload). */
export async function readBody(req: Request): Promise<Record<string, any>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

/** Run a handler and map TaskError / validation errors to JSON responses. */
export async function respond(fn: () => Promise<any>, successStatus = 200) {
  try {
    const data = await fn();
    return NextResponse.json(data, { status: successStatus });
  } catch (err: any) {
    if (err instanceof TaskError) {
      return NextResponse.json({ error: err.message, ...(err.extra || {}) }, { status: err.status });
    }
    if (err?.name === "ValidationError") {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Tasks API error:", err);
    return NextResponse.json({ error: err?.message || "Task request fail ho gayi" }, { status: 500 });
  }
}
