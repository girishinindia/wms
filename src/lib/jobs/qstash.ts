import "server-only";

import { Client, Receiver } from "@upstash/qstash";

import { appEnv, qstashEnv } from "@/lib/env";

/**
 * Upstash QStash: the queue and the cron for this application.
 *
 * Why a queue at all: a notification was sent inside the request that
 * caused it. A slow Brevo or FCM call made "Submit for verification"
 * slow, and a failure was one log line nobody reads. With QStash the
 * request only writes a `notification_delivery` row and publishes its
 * id; QStash calls `/api/v1/jobs/deliver` back, which sends and records.
 *
 * Attempts are OURS to count, not QStash's. The job route always answers
 * 200 (so QStash never retries on its own) and decides itself whether to
 * publish the same id again with a delay — up to `NOTIFY_MAX_ATTEMPTS`
 * (3). After that the row is FAILED for good and nothing touches it.
 *
 * Safe mode: with no QSTASH_TOKEN, `enqueue` returns false and the
 * caller sends inline — exactly the pre-queue behaviour, for local
 * development and for a misconfigured deploy.
 */

let client: Client | null | undefined;
let receiver: Receiver | null | undefined;

export function qstash(): Client | null {
  if (client !== undefined) return client;
  const env = qstashEnv();
  client = env.QSTASH_TOKEN ? new Client({ token: env.QSTASH_TOKEN, baseUrl: env.QSTASH_URL }) : null;
  return client;
}

export function qstashActive(): boolean {
  return qstash() !== null;
}

/** The public origin QStash will call back. */
export function callbackBase(): string {
  const env = qstashEnv();
  return (env.QSTASH_CALLBACK_BASE_URL ?? appEnv().appUrl).replace(/\/$/, "");
}

/**
 * Publish a job. Returns false when there is no queue (caller falls
 * back to inline) or when publishing failed (caller should also fall
 * back — a lost job is worse than a slow request).
 */
export async function enqueue(
  path: string,
  body: Record<string, unknown>,
  options: { delaySeconds?: number; deduplicationId?: string } = {},
): Promise<boolean> {
  const q = qstash();
  if (!q) return false;
  try {
    await q.publishJSON({
      url: `${callbackBase()}${path}`,
      body,
      // Our own attempt counter decides retries; QStash must not pile
      // its own on top and send the same email four times.
      retries: 0,
      ...(options.delaySeconds ? { delay: Math.max(1, Math.floor(options.delaySeconds)) } : {}),
      ...(options.deduplicationId ? { deduplicationId: options.deduplicationId } : {}),
    });
    return true;
  } catch (error) {
    console.error("[qstash] publish failed", path, error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Verify that a request really came from QStash.
 *
 * Both signing keys are accepted so a key rotation in the Upstash
 * console does not drop jobs in flight. When the keys are not configured
 * (safe mode) the routes are still protected by `JOBS_SECRET` if set, and
 * otherwise refused outright — an open job endpoint is an open relay.
 */
export async function verifyJobRequest(request: Request, rawBody: string): Promise<boolean> {
  const env = qstashEnv();
  const signature = request.headers.get("upstash-signature");
  if (signature && env.QSTASH_CURRENT_SIGNING_KEY && env.QSTASH_NEXT_SIGNING_KEY) {
    receiver ??= new Receiver({
      currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
    });
    try {
      return await receiver.verify({ signature, body: rawBody, url: request.url });
    } catch {
      // Behind a proxy the URL QStash signed may differ from what Next
      // sees; verify the body alone before giving up.
      try {
        return await receiver.verify({ signature, body: rawBody });
      } catch {
        return false;
      }
    }
  }
  const secret = env.JOBS_SECRET;
  if (secret) {
    const given = request.headers.get("x-jobs-secret") ?? new URL(request.url).searchParams.get("secret");
    return given === secret;
  }
  return false;
}
