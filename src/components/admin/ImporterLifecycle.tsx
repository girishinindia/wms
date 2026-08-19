"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";

/**
 * Suspend / reactivate / delete a company. Each reaches its owner login,
 * its sales agents and their logins (lifecycle.ts), so the confirm text
 * says so before anything happens.
 */
export default function ImporterLifecycle({
  importerId,
  companyName,
  status,
  canUpdate,
  canDelete,
}: {
  importerId: number;
  companyName: string;
  status: string;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<"suspend" | "reactivate" | "delete" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!canUpdate && !canDelete) return null;

  async function run() {
    if (!pending) return;
    if (pending !== "reactivate" && reason.trim().length < 3) {
      toast.error("Give a short reason — it goes to the audit log.");
      return;
    }
    setBusy(true);
    const result = await api<{ ok: true }>(`/admin/importers/${importerId}/lifecycle`, {
      body: { action: pending, reason: reason.trim() || undefined },
    });
    setBusy(false);
    if (!result.ok) { toast.error(result.error.message); return; }
    toast.success(
      pending === "delete"
        ? `${companyName} deleted, with its logins and sales agents.`
        : pending === "suspend"
          ? `${companyName} suspended. Its logins and sales agents are deactivated.`
          : `${companyName} reactivated, with its logins and sales agents.`,
    );
    setPending(null);
    setReason("");
    if (pending === "delete") window.location.assign("/admin/importers");
    else router.refresh();
  }

  const b = "rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-40";
  const text = {
    suspend: `Suspend ${companyName}? Its owner login and every sales agent (and their logins) are deactivated until you reactivate. Nobody from this company can sign in meanwhile.`,
    reactivate: `Reactivate ${companyName}? Its owner login and its sales agents come back too.`,
    delete: `Delete ${companyName}? The company, its owner login, its sales agents and their logins are all closed. The audit log keeps a copy. This cannot be undone from the portal.`,
  } as const;

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs uppercase tracking-[0.12em] text-verdigris-200/50">Company</span>
        {canUpdate && status === "ACTIVE" ? (
          <button type="button" onClick={() => setPending("suspend")} className={`${b} border-amber-400/35 text-amber-200 hover:border-amber-400/60`}>
            Suspend
          </button>
        ) : null}
        {canUpdate && status === "SUSPENDED" ? (
          <button type="button" onClick={() => setPending("reactivate")} className={`${b} border-verdigris-300/25 text-verdigris-100 hover:border-verdigris-300/50`}>
            Reactivate
          </button>
        ) : null}
        {canDelete ? (
          <button type="button" onClick={() => setPending("delete")} className={`${b} border-rose-400/30 text-rose-200 hover:border-rose-400/60`}>
            Delete company
          </button>
        ) : null}
      </div>

      {pending ? (
        <div
          role="alertdialog"
          className={`mt-3 rounded-xl border p-4 text-[0.9rem] ${
            pending === "delete"
              ? "border-rose-400/25 bg-rose-500/[0.07] text-rose-100"
              : "border-amber-400/25 bg-amber-500/[0.07] text-amber-100"
          }`}
        >
          <p>{text[pending]}</p>
          {pending !== "reactivate" ? (
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (kept in the audit log)"
              className="mt-3 w-full rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40"
            />
          ) : null}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={run}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white ${
                pending === "delete" ? "bg-rose-500/80 hover:bg-rose-500" : "bg-amber-500/80 hover:bg-amber-500 text-ink-900"
              }`}
            >
              {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
              {pending === "delete" ? "Delete" : pending === "suspend" ? "Suspend" : "Reactivate"}
            </button>
            <button type="button" onClick={() => setPending(null)} className="rounded-lg border border-verdigris-300/20 px-3 py-1.5 text-xs text-verdigris-100 hover:border-verdigris-300/45">
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
