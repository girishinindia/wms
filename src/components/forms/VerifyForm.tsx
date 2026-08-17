"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import Field from "@/components/Field";
import { ArrowIcon } from "@/components/icons";
import { api } from "@/lib/api/client";
import { formNote, submitButton } from "@/components/authStyles";

type Status = {
  resendAfterSeconds: number;
  expiresInSeconds: number;
  codeLength: number;
  channels: Array<"EMAIL" | "SMS">;
};

type VerifyResponse = {
  emailVerified: boolean;
  mobileVerified: boolean;
  complete: boolean;
  roleAssigned?: boolean;
  importerCode?: string;
  resetToken?: string;
};

const PURPOSES = ["registration", "passwordRecovery"] as const;
type Purpose = (typeof PURPOSES)[number];

/**
 * The dual-code screen.
 *
 * Two codes, two boxes, and they are DIFFERENT codes — one per channel.
 * That is the whole point of the dual flow: if the same value went to
 * both, holding either channel would be enough and the second is
 * decoration.
 *
 * The countdown is read from the server on mount rather than started at
 * zero locally. Reload the page mid-cooldown and a local timer forgets,
 * the user presses resend, gets a 429, and concludes the site is broken.
 */
export default function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();

  const rawPurpose = params.get("purpose") ?? "registration";
  const purpose: Purpose = (PURPOSES as readonly string[]).includes(rawPurpose)
    ? (rawPurpose as Purpose)
    : "registration";
  const identifier = params.get("identifier") ?? "";
  const mobile = params.get("mobile") ?? "";

  const [emailCode, setEmailCode] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadStatus = useCallback(async () => {
    const query = new URLSearchParams({ purpose, identifier });
    const result = await api<Status>(`/auth/otp/status?${query}`, { method: "GET" });
    if (!mounted.current || !result.ok) return;
    setStatus(result.data);
    setCooldown(result.data.resendAfterSeconds);
  }, [purpose, identifier]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // One interval for the whole component; cleared on unmount so a fast
  // navigation does not leave it ticking against a dead setState.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const codeLength = status?.codeLength ?? 6;
  const digitsOnly = (value: string) => value.replace(/\D/g, "").slice(0, codeLength);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);

    const result = await api<VerifyResponse>("/auth/otp/verify", {
      body: { purpose, identifier, emailCode, smsCode },
    });
    setBusy(false);
    if (!mounted.current) return;

    if (!result.ok) {
      setError(result.error.message);
      // An expired or spent code needs a new one, so surface the resend
      // rather than leaving the user staring at a dead form.
      if (result.error.code === "OTP_EXPIRED") setCooldown(0);
      return;
    }

    if (purpose === "passwordRecovery" && result.data.resetToken) {
      const query = new URLSearchParams({ token: result.data.resetToken });
      router.push(`/reset-password?${query.toString()}`);
      return;
    }

    if (result.data.complete) {
      const query = new URLSearchParams({ registered: "1" });
      if (result.data.importerCode) query.set("code", result.data.importerCode);
      router.push(`/sign-in?${query.toString()}`);
      return;
    }

    setNotice("One channel is verified. Enter the other code to finish.");
  };

  const resend = async () => {
    setError(null);
    setNotice(null);
    setResending(true);
    const result = await api<{ resendAfterSeconds: number }>("/auth/otp/send", {
      body: { purpose, identifier },
    });
    setResending(false);
    if (!mounted.current) return;

    if (!result.ok) {
      setError(result.error.message);
      // The server owns the cooldown; trust its number over ours.
      if (result.error.retryAfter) setCooldown(result.error.retryAfter);
      return;
    }
    setCooldown(result.data.resendAfterSeconds);
    setNotice("New codes sent. The previous ones no longer work.");
  };

  const ready = emailCode.length === codeLength && smsCode.length === codeLength;

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div className="rounded-xl border border-verdigris-300/15 bg-ink-900/40 px-4 py-3 text-sm text-verdigris-200/70">
        Codes sent to <span className="text-verdigris-100">{identifier}</span>
        {mobile ? (
          <>
            {" "}and <span className="text-verdigris-100">+91 {mobile}</span>
          </>
        ) : null}
        .
      </div>

      <Field
        id="emailCode"
        label="Code from your email"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder={"0".repeat(codeLength)}
        maxLength={codeLength}
        required
        value={emailCode}
        onChange={(event) => setEmailCode(digitsOnly(event.target.value))}
      />

      <Field
        id="smsCode"
        label="Code from your mobile"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder={"0".repeat(codeLength)}
        maxLength={codeLength}
        hint="The two codes are different."
        required
        value={smsCode}
        onChange={(event) => setSmsCode(digitsOnly(event.target.value))}
      />

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-xl border border-verdigris-300/25 bg-verdigris-500/10 px-4 py-3 text-sm text-verdigris-100">
          {notice}
        </p>
      )}

      <button type="submit" disabled={busy || !ready} className={`${submitButton} mt-2`}>
        {busy ? "Verifying…" : "Verify and continue"}
        {!busy && <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />}
      </button>

      <div className="flex items-center justify-center gap-2 pt-1 text-sm">
        <span className="text-verdigris-200/45">Didn&rsquo;t get them?</span>
        <button
          type="button"
          onClick={resend}
          disabled={cooldown > 0 || resending}
          className="font-medium text-verdigris-300 underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-verdigris-200/35 disabled:no-underline"
        >
          {resending
            ? "Sending…"
            : cooldown > 0
              ? `Resend in ${cooldown}s`
              : "Resend both codes"}
        </button>
      </div>

      <p className={formNote}>
        Codes expire after {Math.round((status?.expiresInSeconds ?? 300) / 60)} minutes.
      </p>
    </form>
  );
}
