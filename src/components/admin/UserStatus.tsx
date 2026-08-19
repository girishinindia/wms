"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";

/**
 * Suspend, or reinstate.
 *
 * Suspending asks for a reason before it will do anything, because the
 * `users` table refuses a SUSPENDED row without one — and because the
 * reason is what the next person to open this screen reads when they
 * wonder why someone cannot sign in.
 *
 * Two cases render as an explanation rather than a button: a super
 * admin, whom `protect_super_admin` will not let anyone else touch, and
 * yourself, because signing yourself out of the panel permanently is not
 * a click anybody meant to make.
 */
export default function UserStatus({
  userId,
  status,
  isSuperAdmin,
  isSelf,
}: {
  userId: number;
  status: string;
  isSuperAdmin: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const suspended = status === "SUSPENDED";

  if (isSelf) {
    return (
      <p className="text-xs text-verdigris-200/45">
        This is your own account. Suspending it here would lock you out, so it is not offered.
      </p>
    );
  }

  if (isSuperAdmin) {
    return (
      <p className="text-xs text-verdigris-200/45">
        Super admins cannot be suspended by anyone else. The database enforces it, not just
        this screen.
      </p>
    );
  }

  async function apply(next: "ACTIVE" | "SUSPENDED") {
    if (next === "SUSPENDED" && reason.trim().length < 5) {
      toast.error("Give a reason for suspending.");
      return;
    }
    setBusy(true);
    const result = await api<{ ok: true }>(`/admin/users/${userId}/status`, {
      method: "PATCH",
      body: { status: next, ...(next === "SUSPENDED" ? { reason: reason.trim() } : {}) },
    });
    setBusy(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success(
      next === "SUSPENDED" ? "Suspended, and their sessions were ended." : "Account reinstated.",
    );
    setOpen(false);
    setReason("");
    router.refresh();
  }

  if (suspended) {
    return (
      <button
        type="button"
        onClick={() => apply("ACTIVE")}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-xl border border-verdigris-300/20 px-5 py-2.5 text-sm font-medium text-verdigris-100 transition-colors hover:border-verdigris-300/45 disabled:opacity-55"
      >
        {busy ? <Spinner className="h-4 w-4" /> : null}
        {busy ? "Reinstating…" : "Reinstate account"}
      </button>
    );
  }

  return open ? (
    <div className="rounded-xl border border-rose-400/25 bg-rose-500/[0.06] p-4">
      <label htmlFor="suspendReason" className="block text-[0.9rem] font-medium text-rose-100">
        Why is this account being suspended?
      </label>
      <input
        id="suspendReason"
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Left the company"
        className="mt-2.5 w-full rounded-xl border border-rose-400/25 bg-ink-900/60 px-4 py-2.5 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-rose-400/40"
      />
      <p className="mt-2 text-xs text-rose-200/60">
        Every session they have open ends immediately.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => apply("SUSPENDED")}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-rose-500/90 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-500 disabled:opacity-55"
        >
          {busy ? <Spinner className="h-4 w-4" /> : null}
          {busy ? "Suspending…" : "Suspend"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-xl px-4 py-2.5 text-sm text-verdigris-200/60 hover:text-verdigris-100"
        >
          Cancel
        </button>
      </div>
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="rounded-xl border border-rose-400/25 px-5 py-2.5 text-sm font-medium text-rose-200 transition-colors hover:border-rose-400/50 hover:text-rose-100"
    >
      Suspend account
    </button>
  );
}
