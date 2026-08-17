import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The DLT texts, copied from the reference server.js supplied with the
 * registration. These are the strings the operator has on file.
 *
 * This test exists because a single changed character is ErrorCode 0024
 * and a user who never receives their OTP — a failure that looks like
 * nothing at all from the application's side. Comparing against a
 * second copy of the approved text turns "someone tidied the wording"
 * into a red test instead of a support ticket.
 */
const APPROVED = {
  registration: (n: string, o: string) =>
    `Dear ${n}, OTP is for new user registration is ${o}. Thank You, Genius ITens (Grow Up More)`,
  passwordRecovery: (n: string, o: string) =>
    `Dear ${n}, OTP is for password recovery is ${o}. Thank You, Genius ITens (Grow Up More)`,
  resetPassword: (n: string, o: string) =>
    `Dear ${n}, OTP to reset password is ${o}. Thank You, Genius ITens (Grow Up More)`,
  updateEmail: (n: string, o: string) =>
    `Dear ${n}, OTP to update email is ${o}. Thank You, Genius ITens (Grow Up More)`,
  updateMobile: (n: string, o: string) =>
    `Dear ${n}, OTP to update mobile number is ${o}. Thank You, Genius ITens (Grow Up More)`,
} as const;

const DB = process.env.TEST_DATABASE_URL;
const describeDb = DB ? describe : describe.skip;

describeDb("DLT templates, as stored in the database", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = DB;
    process.env.DATABASE_SSL = "disable";
    vi.resetModules();
  });

  it("match the approved wording character for character", async () => {
    const { getTemplate, OTP_EVENTS, render, clearTemplateCache } = await import(
      "@/lib/notify/templates"
    );
    clearTemplateCache();

    for (const [purpose, approved] of Object.entries(APPROVED)) {
      const template = await getTemplate(
        OTP_EVENTS[purpose as keyof typeof APPROVED],
        "SMS",
      );
      const built = render(template.body, { name: "Girish", otp: "483920" });
      expect(built, `template '${purpose}'`).toBe(approved("Girish", "483920"));
    }
  });

  it("carries a DLT id, entity id and sender id on every SMS row", async () => {
    const { getTemplate, OTP_EVENTS, clearTemplateCache } = await import(
      "@/lib/notify/templates"
    );
    clearTemplateCache();

    for (const purpose of Object.keys(APPROVED)) {
      const t = await getTemplate(OTP_EVENTS[purpose as keyof typeof APPROVED], "SMS");
      expect(t.dltTemplateId, `dlt id for '${purpose}'`).toMatch(/^\d{15,20}$/);
      expect(t.dltEntityId, `entity id for '${purpose}'`).toMatch(/^\d+$/);
      expect(t.senderId, `sender id for '${purpose}'`).toHaveLength(6);
    }
  });

  it("registers a distinct id per purpose", async () => {
    const { getTemplate, OTP_EVENTS, clearTemplateCache } = await import(
      "@/lib/notify/templates"
    );
    clearTemplateCache();
    const ids = await Promise.all(
      Object.keys(APPROVED).map(async (p) =>
        (await getTemplate(OTP_EVENTS[p as keyof typeof APPROVED], "SMS")).dltTemplateId,
      ),
    );
    // Five purposes sharing one id is the mistake a single
    // SMS_DLT_TEMPLATE_ID in .env quietly encourages.
    expect(new Set(ids).size).toBe(5);
  });
});

describe("template rendering", () => {
  it("keeps a hostile name from reshaping the message", async () => {
    const { sanitiseName } = await import("@/lib/notify/templates");
    expect(sanitiseName("Gi\nrish   Kumar")).toBe("Gi rish Kumar");
    expect(sanitiseName("   ")).toBe("User");
    expect(sanitiseName("x".repeat(80))).toHaveLength(30);
  });

  it("refuses to send a placeholder as if it were a value", async () => {
    const { render } = await import("@/lib/notify/templates");
    // Leaving {{otp}} in place still passes the DLT pattern match, so
    // the message is delivered and the code it contains is "{{otp}}".
    expect(() => render("code {{otp}}", {})).toThrow(/otp/);
    expect(render("code {{otp}}", { otp: "1" })).toBe("code 1");
  });
});

const describeSend = DB ? describe : describe.skip;

describeSend("sendSms", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  beforeEach(() => {
    process.env.DATABASE_URL = DB;
    process.env.DATABASE_SSL = "disable";
    vi.resetModules();
  });

  it("suppresses outside production instead of spending credits", async () => {
    const spy = vi.fn();
    global.fetch = spy as unknown as typeof fetch;

    const { sendSms } = await import("@/lib/notify/sms");
    const out = await sendSms({
      purpose: "registration",
      name: "Girish",
      otp: "483920",
      mobile: "9876543210",
    });

    expect(spy).not.toHaveBeenCalled();
    expect(out.status).toBe("SUPPRESSED");
    // Still builds the full message, so a template break fails here too.
    expect((out.response as { wouldSend: string }).wouldSend).toBe(
      APPROVED.registration("Girish", "483920"),
    );
  });

  it("sends the exact payload SmsGatewayHub expects", async () => {
    vi.stubEnv("SMS_FORCE_SEND", "true");
    let captured: { url: string; body: Record<string, unknown> } | undefined;
    global.fetch = (async (url: string, init: RequestInit) => {
      captured = { url: String(url), body: JSON.parse(String(init.body)) };
      return new Response(
        JSON.stringify({ ErrorCode: "000", ErrorMessage: "Success", JobId: "job-1" }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const { sendSms } = await import("@/lib/notify/sms");
    const { smsEnv } = await import("@/lib/env");
    const out = await sendSms({
      purpose: "resetPassword",
      name: "Girish",
      otp: "112233",
      // Deliberately messy: the caller should not have to normalise.
      mobile: "+91 98765 43210",
    });

    expect(captured?.url).toBe("https://www.smsgatewayhub.com/api/mt/SendSMS");
    const account = (captured?.body as { Account: Record<string, string> }).Account;
    expect(account.APIkey).toBe(smsEnv().SMS_API_KEY);
    // Sender and entity come from the template row, not from .env.
    expect(account.SenderId).toBe("GUMORE");
    expect(account.EntityId).toMatch(/^\d+$/);

    const messages = (captured?.body as { Messages: Array<Record<string, string>> }).Messages;
    expect(messages[0].Number).toBe("919876543210");
    const { getTemplate, OTP_EVENTS } = await import("@/lib/notify/templates");
    const stored = await getTemplate(OTP_EVENTS.resetPassword, "SMS");
    expect(messages[0].DLTTemplateId).toBe(stored.dltTemplateId);
    expect(messages[0].Text).toBe(APPROVED.resetPassword("Girish", "112233"));

    expect(out.status).toBe("SENT");
    expect(out.providerMessageId).toBe("job-1");
  });

  it("does not retry a template mismatch or an empty account", async () => {
    vi.stubEnv("SMS_FORCE_SEND", "true");
    const { sendSms } = await import("@/lib/notify/sms");

    for (const code of ["0024", "0021", "0013", "0005", "0012"]) {
      global.fetch = (async () =>
        new Response(JSON.stringify({ ErrorCode: code, ErrorMessage: "nope" }), {
          status: 200,
        })) as unknown as typeof fetch;
      const out = await sendSms({
        purpose: "registration",
        name: "G",
        otp: "1",
        mobile: "9876543210",
      });
      expect(out.status, code).toBe("FAILED");
      expect(out.retryable, `${code} must not be retried`).toBe(false);
      expect(out.errorCode).toBe(code);
    }
  });

  it("does retry a gateway 500 and a network timeout", async () => {
    vi.stubEnv("SMS_FORCE_SEND", "true");
    const { sendSms } = await import("@/lib/notify/sms");
    const input = {
      purpose: "registration" as const,
      name: "G",
      otp: "1",
      mobile: "9876543210",
    };

    global.fetch = (async () =>
      new Response("upstream unavailable", { status: 503 })) as unknown as typeof fetch;
    expect((await sendSms(input)).retryable).toBe(true);

    global.fetch = (async () => {
      throw new Error("timed out");
    }) as unknown as typeof fetch;
    const timedOut = await sendSms(input);
    expect(timedOut.retryable).toBe(true);
    expect(timedOut.errorCode).toBe("NETWORK");
  });

  it("rejects an impossible number before the gateway charges for it", async () => {
    vi.stubEnv("SMS_FORCE_SEND", "true");
    const spy = vi.fn();
    global.fetch = spy as unknown as typeof fetch;
    const { sendSms } = await import("@/lib/notify/sms");

    for (const mobile of ["1234567890", "98765", ""]) {
      const out = await sendSms({
        purpose: "registration",
        name: "G",
        otp: "1",
        mobile,
      });
      expect(out.status, mobile).toBe("FAILED");
      expect(out.errorCode).toBe("INVALID_MOBILE");
    }
    expect(spy).not.toHaveBeenCalled();
  });
});
