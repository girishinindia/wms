import "server-only";

import { otpEnv } from "@/lib/env";
import { deliverDualChannel } from "@/lib/notify/deliver";
import { getTemplate, OTP_EVENTS, render, type OtpPurpose } from "@/lib/notify/templates";

import { issueOtp, resendCooldownRemaining, type OtpPurpose as TokenPurpose } from "./otp";

/**
 * Issue and send both codes for one purpose.
 *
 * The two codes are INDEPENDENT — a separate row and a separate random
 * value per channel. That is what makes "dual OTP" mean anything: if the
 * same code went to both, compromising either channel compromises the
 * whole check and the second channel is decoration.
 *
 * Email and SMS are dispatched concurrently. They must arrive at roughly
 * the same time or the user sits watching one field with the other code
 * still in flight.
 */

/** Which `user_verification_token.purpose` each API purpose writes. */
const TOKEN_PURPOSE: Record<OtpPurpose, TokenPurpose> = {
  registration: "EMAIL_VERIFY",
  passwordRecovery: "PASSWORD_RESET",
  resetPassword: "PASSWORD_RESET",
  updateEmail: "EMAIL_VERIFY",
  updateMobile: "MOBILE_VERIFY",
};

/**
 * Registration verifies an email address AND a mobile number, so the two
 * channels get different token purposes. Everything else is one logical
 * check delivered twice.
 */
function purposeFor(purpose: OtpPurpose, channel: "EMAIL" | "SMS"): TokenPurpose {
  if (purpose === "registration") {
    return channel === "EMAIL" ? "EMAIL_VERIFY" : "MOBILE_VERIFY";
  }
  return TOKEN_PURPOSE[purpose];
}

export type DispatchResult = {
  channels: Array<"EMAIL" | "SMS">;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  /** Per channel: did the provider accept it? For the audit row. */
  delivery: Record<string, string>;
};

export async function dispatchOtp(params: {
  userId: number;
  purpose: OtpPurpose;
  firstName: string;
  email: string;
  mobile: string;
  /** Restrict to one channel; default is both. */
  only?: "EMAIL" | "SMS";
  ip?: string | null;
  correlationId?: string;
}): Promise<DispatchResult> {
  const env = otpEnv();
  const eventKey = OTP_EVENTS[params.purpose];
  const channels: Array<"EMAIL" | "SMS"> =
    params.only ? [params.only] : env.OTP_REQUIRE_BOTH_CHANNELS ? ["EMAIL", "SMS"] : ["EMAIL"];

  // Separate codes, one per channel. Issued before sending so a provider
  // failure still leaves a usable code the user can request again.
  const issued = await Promise.all(
    channels.map(async (channel) => ({
      channel,
      otp: await issueOtp({
        userId: params.userId,
        purpose: purposeFor(params.purpose, channel),
        channel,
        sentTo: channel === "EMAIL" ? params.email : params.mobile,
        ip: params.ip,
      }),
    })),
  );

  const emailIssued = issued.find((i) => i.channel === "EMAIL");
  const smsIssued = issued.find((i) => i.channel === "SMS");

  let emailSubject = "Your verification code";
  let emailBody = "";
  if (emailIssued) {
    const template = await getTemplate(eventKey, "EMAIL");
    emailSubject = template.subject ?? emailSubject;
    emailBody = render(template.body, {
      otp: emailIssued.otp.code,
      ttl_minutes: emailIssued.otp.ttlMinutes,
    });
  }

  const outcome = await deliverDualChannel(
    {
      eventKey,
      recipientUserId: params.userId,
      // One notification per (user, purpose, token). Including the token
      // id is what makes a replayed HTTP request reuse the row instead
      // of sending a second pair of codes.
      dedupeKey: `otp:${params.purpose}:${params.userId}:${issued.map((i) => i.otp.tokenId).join("-")}`,
      title: emailSubject,
      // The in-app feed must never carry the code itself — it is visible
      // to anyone already holding the session the code is protecting.
      body: "A verification code was sent to your email and mobile.",
      correlationId: params.correlationId,
      payload: { purpose: params.purpose, channels },
    },
    {
      email: emailIssued
        ? {
            toEmail: params.email,
            toName: params.firstName,
            subject: emailSubject,
            message: emailBody,
          }
        : undefined,
      sms: smsIssued
        ? {
            purpose: params.purpose,
            name: params.firstName,
            otp: smsIssued.otp.code,
            mobile: params.mobile,
          }
        : undefined,
    },
  );

  const cooldowns = await Promise.all(
    issued.map((i) =>
      resendCooldownRemaining({
        userId: params.userId,
        purpose: purposeFor(params.purpose, i.channel),
        channel: i.channel,
      }),
    ),
  );

  return {
    channels,
    expiresInSeconds: env.OTP_TTL_SECONDS,
    resendAfterSeconds: Math.max(0, ...cooldowns),
    delivery: {
      ...(outcome.email ? { EMAIL: outcome.email.status } : {}),
      ...(outcome.sms ? { SMS: outcome.sms.status } : {}),
    },
  };
}

export { purposeFor };
