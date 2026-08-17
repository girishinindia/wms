import "server-only";

import { shouldReallySend, smsEnv } from "@/lib/env";
import { normalizeMobile } from "@/lib/normalize";

import { getTemplate, OTP_EVENTS, render, sanitiseName, type OtpPurpose } from "./templates";
import type { SendOutcome } from "./types";

/**
 * SmsGatewayHub transactional SMS.
 *
 * This is the reference proxy server, moved inside the app. The proxy
 * existed because SmsGatewayHub sends no CORS headers and the API key
 * must not reach a browser; a Next route handler is already server-side,
 * so the same protection comes for free and there is no second process
 * to keep running.
 *
 * The caller passes a purpose, a name, an OTP and a mobile number. The
 * API key comes from the environment; the DLT template id, the approved
 * wording, the sender id and the entity id all come from
 * `wms.notification_template` — see notify/templates.ts for why they
 * belong together in one row. Nothing secret crosses back to the client.
 */

const ENDPOINT = "https://www.smsgatewayhub.com/api/mt/SendSMS";
const DELIVERY_ENDPOINT = "https://www.smsgatewayhub.com/api/mt/GetDelivery";

/**
 * Error codes that will fail again no matter how many times we try.
 * Retrying these burns credits and delays the user's OTP for nothing.
 *
 *   0024  text does not match the DLT-approved template
 *   0021  account out of credits
 *   0013  invalid mobile number
 *   0005  invalid API key
 *   0012  invalid sender id
 */
const TERMINAL_CODES = new Set(["0024", "0021", "0013", "0005", "0012"]);

/** SmsGatewayHub signals success with ErrorCode "000". */
const SUCCESS_CODE = "000";

type GatewayResponse = {
  ErrorCode?: string;
  ErrorMessage?: string;
  JobId?: string;
  MessageData?: Array<{ Number?: string; MessageId?: string }>;
};

export type SendSmsInput = {
  purpose: OtpPurpose;
  /** Recipient's first name, or whatever the template should greet. */
  name: string;
  otp: string;
  /** Ten digits, or anything normalizeMobile can reduce to ten. */
  mobile: string;
};

export async function sendSms(input: SendSmsInput): Promise<SendOutcome> {
  const env = smsEnv();

  const eventKey = OTP_EVENTS[input.purpose];
  if (!eventKey) {
    return {
      status: "FAILED",
      retryable: false,
      errorCode: "UNKNOWN_PURPOSE",
      error: `No OTP event mapped for purpose '${input.purpose}'`,
      provider: "smsgatewayhub",
    };
  }

  let template;
  try {
    template = await getTemplate(eventKey, "SMS");
  } catch (error) {
    return {
      status: "FAILED",
      retryable: false,
      errorCode: "NO_TEMPLATE",
      error: error instanceof Error ? error.message : String(error),
      provider: "smsgatewayhub",
    };
  }

  if (!template.dltTemplateId) {
    // The schema CHECK should make this unreachable; if it ever fires,
    // the row was written around the constraint.
    return {
      status: "FAILED",
      retryable: false,
      errorCode: "NO_DLT_ID",
      error: `SMS template for '${eventKey}' has no dlt_template_id`,
      provider: "smsgatewayhub",
    };
  }

  const mobile = normalizeMobile(input.mobile);
  if (!/^[6-9]\d{9}$/.test(mobile)) {
    // Caught here rather than at the gateway: the gateway charges for
    // the attempt and answers 0013, which reads as a provider fault in
    // the logs when it is actually bad input.
    return {
      status: "FAILED",
      retryable: false,
      errorCode: "INVALID_MOBILE",
      error: "Mobile number must be 10 digits starting 6-9",
      provider: "smsgatewayhub",
    };
  }

  let message: string;
  try {
    message = render(template.body, {
      name: sanitiseName(input.name),
      otp: input.otp,
    });
  } catch (error) {
    return {
      status: "FAILED",
      retryable: false,
      errorCode: "TEMPLATE_RENDER",
      error: error instanceof Error ? error.message : String(error),
      provider: "smsgatewayhub",
    };
  }

  if (!shouldReallySend()) {
    // Outside production the message is built in full — so a template
    // mismatch still shows up in tests — but not handed to the gateway.
    return {
      status: "SUPPRESSED",
      retryable: false,
      provider: "smsgatewayhub",
      address: mobile,
      response: {
        suppressed: "APP_ENV is not production and SMS_FORCE_SEND is off",
        wouldSend: message,
        dltTemplateId: template.dltTemplateId,
      },
    };
  }

  const payload = {
    Account: {
      APIkey: env.SMS_API_KEY,
      // From the template row: the sender id is a property of the DLT
      // registration, so a second brand later is a new row, not a new
      // deployment. Falls back to .env for anything not yet migrated.
      SenderId: template.senderId ?? env.SMS_SENDER_ID,
      Channel: String(env.SMS_CHANNEL),
      DCS: String(env.SMS_DCS),
      SchedTime: null,
      GroupId: null,
      EntityId: template.dltEntityId ?? env.SMS_ENTITY_ID,
    },
    Messages: [
      { Text: message, DLTTemplateId: template.dltTemplateId, Number: `91${mobile}` },
    ],
  };

  let raw: string;
  let httpStatus: number;
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    httpStatus = response.status;
    raw = await response.text();
  } catch (error) {
    // Network failure or timeout. Nothing was necessarily NOT sent, but
    // there is no job id to check, so this is retryable and the dedupe
    // key on `notification` is what stops a double send.
    return {
      status: "FAILED",
      retryable: true,
      errorCode: "NETWORK",
      error: error instanceof Error ? error.message : String(error),
      provider: "smsgatewayhub",
      address: mobile,
    };
  }

  const body = safeParse<GatewayResponse>(raw);
  const code = body?.ErrorCode;

  if (code === SUCCESS_CODE) {
    return {
      status: "SENT",
      retryable: false,
      provider: "smsgatewayhub",
      address: mobile,
      // JobId is what GetDelivery takes, so it is the id worth keeping.
      providerMessageId: body?.JobId ?? body?.MessageData?.[0]?.MessageId,
      response: body ?? { raw },
    };
  }

  const terminal = code !== undefined && TERMINAL_CODES.has(code);
  return {
    status: "FAILED",
    // A 5xx with no parseable code is the gateway being unwell: retry.
    retryable: !terminal && (httpStatus >= 500 || code === undefined),
    errorCode: code ?? `HTTP_${httpStatus}`,
    error: body?.ErrorMessage ?? describe(code) ?? raw.slice(0, 300),
    provider: "smsgatewayhub",
    address: mobile,
    response: body ?? { raw },
  };
}

/** Delivery receipt for a previously sent job. */
export async function checkSmsDelivery(jobId: string): Promise<unknown> {
  const params = new URLSearchParams({ APIKey: smsEnv().SMS_API_KEY, jobid: jobId });
  const response = await fetch(`${DELIVERY_ENDPOINT}?${params}`, {
    signal: AbortSignal.timeout(15_000),
  });
  return safeParse<unknown>(await response.text());
}

/** Turns the gateway's numeric codes into something a human can act on. */
function describe(code?: string): string | undefined {
  switch (code) {
    case "0024":
      return "Message text does not exactly match the DLT-approved template. Compare wms.notification_template.body against the DLT portal - one space or comma is enough.";
    case "0021":
      return "SmsGatewayHub account is out of credits.";
    case "0013":
      return "The gateway rejected the mobile number.";
    case "0005":
      return "SMS_API_KEY was rejected.";
    case "0012":
      return "SMS_SENDER_ID is not approved for this account.";
    default:
      return undefined;
  }
}

function safeParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
