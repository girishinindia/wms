"use client";

import { useState } from "react";

import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";

/**
 * "Send sign-in details" — the answer to "I never got the email".
 *
 * It mints a NEW temporary password and emails it. It does not repeat
 * the old one, because the old one exists only as an argon2 hash and is
 * meant to: nothing in this system can tell you a password back, which
 * is the whole reason the create dialog no longer prints one.
 *
 * Two places use it: the panel after an account is created, when the
 * email did not go out, and the account's own page, for the same
 * request a week later.
 */

type EmailStatus = "SENT" | "SUPPRESSED" | "FAILED";

export default function ResendInvite({
  userId,
  label = "Send sign-in details",
  className,
}: {
  userId: number;
  label?: string;
  className?: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function send() {
    setBusy(true);
    const result = await api<{ email: string; emailStatus: EmailStatus }>(
      `/admin/users/${userId}/invite`,
      { body: {} },
    );
    setBusy(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    /**
     * The API reports what actually happened, and so does this. Saying
     * "Sent." after a suppressed send is the failure mode worth
     * avoiding: somebody waits for an email that was never posted.
     */
    if (result.data.emailStatus === "SENT") {
      setSent(true);
      toast.success(`Sign-in details sent to ${result.data.email}.`);
      return;
    }
    if (result.data.emailStatus === "SUPPRESSED") {
      toast.info("A new password was set, but email is switched off in this environment.");
      return;
    }
    toast.error("A new password was set, but the email did not go out. Try again shortly.");
  }

  return (
    <button
      type="button"
      onClick={() => void send()}
      disabled={busy || sent}
      className={
        className ??
        "inline-flex items-center gap-2 rounded-lg border border-verdigris-300/25 px-3 py-2 text-sm text-verdigris-100 transition-colors hover:border-verdigris-300/50 disabled:opacity-55"
      }
    >
      {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
      {sent ? "Sent" : label}
    </button>
  );
}
