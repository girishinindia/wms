import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { verifyJobRequest } from "./qstash";

/**
 * The envelope every job route shares: verify the caller is QStash (or
 * holds JOBS_SECRET), run, answer 200 with what happened.
 *
 * Always 200 once verified, even when the work inside failed: QStash
 * retries non-2xx responses on its own schedule, and these jobs manage
 * their own attempts. A 500 here would mean QStash's retries stacked on
 * top of ours — the "sent four times" bug the attempt cap exists to
 * prevent. The failure is still in the response body and in the logs.
 */
export function jobRoute(
  name: string,
  run: (body: Record<string, unknown>) => Promise<Record<string, unknown>>,
) {
  return async function handler(request: NextRequest) {
    const raw = await request.text();
    if (!(await verifyJobRequest(request, raw))) {
      return NextResponse.json({ error: "unauthorised" }, { status: 401 });
    }
    let body: Record<string, unknown> = {};
    if (raw) {
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return NextResponse.json({ error: "bad json" }, { status: 400 });
      }
    }
    const started = Date.now();
    try {
      const result = await run(body);
      return NextResponse.json({ job: name, ok: true, ms: Date.now() - started, ...result });
    } catch (error) {
      console.error(`[job ${name}]`, error instanceof Error ? error.message : error);
      return NextResponse.json({
        job: name, ok: false, ms: Date.now() - started,
        error: error instanceof Error ? error.message.slice(0, 300) : "failed",
      });
    }
  };
}
