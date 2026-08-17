import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("buildEmailHtml", () => {
  beforeEach(() => vi.resetModules());

  it("keeps the branded wrapper from the reference implementation", async () => {
    const { buildEmailHtml } = await import("@/lib/notify/email");
    const html = buildEmailHtml({ toName: "Girish", message: "Your OTP is 483920." });

    expect(html).toContain("background-color:#0891b2"); // header bar
    expect(html).toContain("Dear Girish,");
    expect(html).toContain("Your OTP is 483920.");
    expect(html).toContain("Regards,");
    expect(html).toContain("Please do not reply to this email.");
  });

  it("turns newlines into line breaks", async () => {
    const { buildEmailHtml } = await import("@/lib/notify/email");
    expect(buildEmailHtml({ message: "one\ntwo" })).toContain("one<br>two");
  });

  /**
   * The reference template interpolated the message straight into the
   * HTML. That is fine for a demo page where you type the message
   * yourself, and not fine once the message carries a user-supplied
   * name — the mail becomes a stored-XSS vector in whatever webmail
   * renders it.
   */
  it("escapes user-supplied content instead of interpolating it raw", async () => {
    const { buildEmailHtml } = await import("@/lib/notify/email");
    const html = buildEmailHtml({
      toName: '<img src=x onerror="alert(1)">',
      message: '<script>fetch("//evil")</script> & "quoted"',
    });

    // What matters is that no tag survives as a TAG. The literal text
    // `onerror=` is still in the output and is harmless, because the
    // `<` that would have opened the element is now `&lt;`.
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;quoted&quot;");
    // The <br> we generate ourselves must survive.
    expect(buildEmailHtml({ message: "a\nb" })).toContain("<br>");
  });
});

describe("sendEmail", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  beforeEach(() => vi.resetModules());

  it("suppresses outside production", async () => {
    const spy = vi.fn();
    global.fetch = spy as unknown as typeof fetch;
    const { sendEmail } = await import("@/lib/notify/email");

    const out = await sendEmail({
      toEmail: "someone@example.com",
      subject: "OTP",
      message: "Your OTP is 1.",
    });
    expect(spy).not.toHaveBeenCalled();
    expect(out.status).toBe("SUPPRESSED");
  });

  it("sends the payload Brevo expects, with the key in the header", async () => {
    vi.stubEnv("SMS_FORCE_SEND", "true");
    let captured: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | undefined;
    global.fetch = (async (url: string, init: RequestInit) => {
      captured = {
        url: String(url),
        headers: init.headers as Record<string, string>,
        body: JSON.parse(String(init.body)),
      };
      return new Response(JSON.stringify({ messageId: "<abc@brevo>" }), { status: 201 });
    }) as unknown as typeof fetch;

    const { sendEmail } = await import("@/lib/notify/email");
    const { emailEnv } = await import("@/lib/env");
    const out = await sendEmail({
      toEmail: "someone@example.com",
      toName: "Girish",
      subject: "Verify your account",
      message: "Your OTP is 483920.",
    });

    expect(captured?.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(captured?.headers["api-key"]).toBe(emailEnv().BREVO_API_KEY);
    const body = captured?.body as {
      sender: { email: string };
      to: Array<{ email: string; name: string }>;
      subject: string;
      htmlContent: string;
    };
    expect(body.sender.email).toBe(emailEnv().EMAIL_FROM);
    expect(body.to[0]).toEqual({ email: "someone@example.com", name: "Girish" });
    expect(body.subject).toBe("Verify your account");
    expect(body.htmlContent).toContain("Your OTP is 483920.");

    expect(out.status).toBe("SENT");
    expect(out.providerMessageId).toBe("<abc@brevo>");
  });

  it("does not retry a rejected key, does retry a rate limit", async () => {
    vi.stubEnv("SMS_FORCE_SEND", "true");
    const { sendEmail } = await import("@/lib/notify/email");
    const input = { toEmail: "a@b.com", subject: "s", message: "m" };

    global.fetch = (async () =>
      new Response(JSON.stringify({ code: "unauthorized", message: "Key not found" }), {
        status: 401,
      })) as unknown as typeof fetch;
    const unauthorised = await sendEmail(input);
    expect(unauthorised.status).toBe("FAILED");
    expect(unauthorised.retryable).toBe(false);
    expect(unauthorised.errorCode).toBe("unauthorized");

    global.fetch = (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
    expect((await sendEmail(input)).retryable).toBe(true);

    global.fetch = (async () => new Response("{}", { status: 502 })) as unknown as typeof fetch;
    expect((await sendEmail(input)).retryable).toBe(true);
  });

  it("does not fail the user's send when the admin copy fails", async () => {
    vi.stubEnv("SMS_FORCE_SEND", "true");
    let call = 0;
    global.fetch = (async () => {
      call += 1;
      return call === 1
        ? new Response(JSON.stringify({ messageId: "main" }), { status: 201 })
        : new Response(JSON.stringify({ code: "invalid_parameter" }), { status: 400 });
    }) as unknown as typeof fetch;

    const { sendEmail } = await import("@/lib/notify/email");
    const out = await sendEmail({
      toEmail: "a@b.com",
      subject: "s",
      message: "m",
      notifyAdmin: true,
    });

    expect(call).toBe(2);
    expect(out.status).toBe("SENT");
    expect(out.providerMessageId).toBe("main");
  });
});

describe("env validation", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("names every offending variable at once", async () => {
    vi.stubEnv("BREVO_API_KEY", "not-a-brevo-key");
    vi.stubEnv("EMAIL_FROM", "not-an-email");
    const { emailEnv } = await import("@/lib/env");

    expect(() => emailEnv()).toThrow(/BREVO_API_KEY/);
    // Cached failure: same error, still naming both.
    try {
      emailEnv();
    } catch (error) {
      expect(String(error)).toMatch(/EMAIL_FROM/);
    }
  });

  it("flags a malformed sender id by name", async () => {
    // Six characters exactly — a DLT sender id is not free-form, and a
    // wrong one is ErrorCode 0012 at the gateway rather than an error here.
    vi.stubEnv("SMS_SENDER_ID", "TOOLONG");
    const { smsEnv } = await import("@/lib/env");
    expect(() => smsEnv()).toThrow(/SMS_SENDER_ID/);
  });

  it("does not look for DLT template ids in the environment at all", async () => {
    // They live in wms.notification_template. Clearing them must change
    // nothing, or something is still reading env for the id.
    for (const key of [
      "SMS_TEMPLATE_REGISTRATION",
      "SMS_TEMPLATE_PASSWORD_RECOVERY",
      "SMS_TEMPLATE_RESET_PASSWORD",
      "SMS_TEMPLATE_UPDATE_EMAIL",
      "SMS_TEMPLATE_UPDATE_MOBILE",
      // Junk value in the real .env; nothing reads it, so nothing breaks.
      "SMS_ROUTE",
    ]) {
      vi.stubEnv(key, "");
    }
    const { smsEnv } = await import("@/lib/env");
    expect(() => smsEnv()).not.toThrow();
  });
});
