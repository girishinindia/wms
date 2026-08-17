import "server-only";

import { createSign } from "node:crypto";

import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { shouldReallySend } from "@/lib/env";

import type { SendOutcome } from "./types";

/**
 * Firebase Cloud Messaging, HTTP v1.
 *
 * Not the legacy `fcm.googleapis.com/fcm/send` endpoint with a server
 * key — Google turned that off in 2024. v1 needs a short-lived OAuth
 * access token, minted from the service account by signing a JWT.
 *
 * No `firebase-admin` dependency. That package pulls in ~40 MB and a
 * gRPC stack to do what is, for one endpoint, a signed JWT and two
 * fetches. On a serverless function that is cold-start time paid on
 * every deploy for no benefit.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

let cachedAccount: ServiceAccount | undefined;

/**
 * FIREBASE_SERVICE_ACCOUNT_JSON is the whole JSON blob, single-quoted in
 * .env. The `\n` inside `private_key` survive as literal backslash-n
 * through dotenv, so they have to be turned back into newlines or the
 * PEM will not parse — an error that reads as "invalid key" and sends
 * people hunting for the wrong problem.
 */
function serviceAccount(): ServiceAccount {
  if (cachedAccount) return cachedAccount;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is not set. Push cannot be sent without it.",
    );
  }

  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON. It should be the " +
        "whole service-account file on one line, in single quotes.",
    );
  }
  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is missing client_email, private_key or project_id.",
    );
  }

  parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  cachedAccount = parsed;
  return parsed;
}

const base64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64url");

/**
 * Access token, cached until shortly before it expires.
 *
 * Google issues these for an hour. Minting one per notification is two
 * extra round trips on every send and, at volume, a rate limit.
 */
let cachedToken: { value: string; expiresAt: number } | undefined;

async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const account = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: account.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const signingInput =
    base64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) +
    "." +
    base64url(JSON.stringify(claims));

  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(account.private_key);

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signingInput}.${base64url(signature)}`,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };

  if (!response.ok || !body.access_token) {
    throw new Error(
      `Firebase rejected the service account: ${body.error_description ?? response.status}`,
    );
  }

  cachedToken = {
    value: body.access_token,
    // 60s of headroom, so a token never expires mid-flight.
    expiresAt: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000,
  };
  return cachedToken.value;
}

export type SendPushInput = {
  /** FCM registration token from the device. */
  token: string;
  title: string;
  body: string;
  /** Deep link and anything else the app needs. Values must be strings. */
  data?: Record<string, string>;
};

/**
 * A token FCM says is dead. The device uninstalled, restored from a
 * backup, or the token was rotated. Retrying is pointless forever, so
 * the row is deactivated instead.
 */
const DEAD_TOKEN = new Set(["UNREGISTERED", "INVALID_ARGUMENT"]);

export async function sendPush(input: SendPushInput): Promise<SendOutcome> {
  if (!shouldReallySend()) {
    return {
      status: "SUPPRESSED",
      retryable: false,
      provider: "fcm",
      address: input.token.slice(0, 12) + "…",
      response: {
        suppressed: "APP_ENV is not production and SMS_FORCE_SEND is off",
        wouldSend: { title: input.title, body: input.body },
      },
    };
  }

  let token: string;
  let projectId: string;
  try {
    token = await accessToken();
    projectId = serviceAccount().project_id;
  } catch (error) {
    return {
      status: "FAILED",
      retryable: false,
      errorCode: "FIREBASE_CONFIG",
      error: error instanceof Error ? error.message : String(error),
      provider: "fcm",
    };
  }

  let raw: string;
  let httpStatus: number;
  try {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: input.token,
            notification: { title: input.title, body: input.body },
            data: input.data ?? {},
            android: { priority: "HIGH" },
            apns: {
              headers: { "apns-priority": "10" },
              payload: { aps: { sound: "default" } },
            },
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    httpStatus = response.status;
    raw = await response.text();
  } catch (error) {
    return {
      status: "FAILED",
      retryable: true,
      errorCode: "NETWORK",
      error: error instanceof Error ? error.message : String(error),
      provider: "fcm",
      address: input.token.slice(0, 12) + "…",
    };
  }

  let body: { name?: string; error?: { status?: string; message?: string } } | undefined;
  try {
    body = JSON.parse(raw);
  } catch {
    body = undefined;
  }

  if (httpStatus >= 200 && httpStatus < 300) {
    return {
      status: "SENT",
      retryable: false,
      provider: "fcm",
      address: input.token.slice(0, 12) + "…",
      providerMessageId: body?.name,
      response: body ?? { raw },
    };
  }

  const status = body?.error?.status;
  if (status && DEAD_TOKEN.has(status)) {
    // Deactivate rather than delete: which device a notification was
    // aimed at is worth keeping for the audit trail.
    await getDb()
      .execute(sql`
        update wms.user_device set is_active = false where push_token = ${input.token}
      `)
      .catch(() => undefined);
  }

  return {
    status: "FAILED",
    retryable: !status || (!DEAD_TOKEN.has(status) && httpStatus >= 500),
    errorCode: status ?? `HTTP_${httpStatus}`,
    error: body?.error?.message ?? raw.slice(0, 300),
    provider: "fcm",
    address: input.token.slice(0, 12) + "…",
    response: body ?? { raw },
  };
}

/** Every live push token for a user. One row per device they signed in on. */
export async function devicesFor(userId: number): Promise<string[]> {
  const rows = await getDb().execute<{ push_token: string }>(sql`
    select push_token from wms.user_device
     where user_id = ${userId} and is_active
     order by last_seen_at desc
  `);
  return rows.map((r) => r.push_token);
}
