"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";
import { fmtDay } from "@/lib/format/datetime";

import { Card } from "./ui";

/**
 * One person's exceptions to what their roles grant.
 *
 * The third card on a user's page, beside the roles they hold and the
 * roles you may give them. It answers the question a role cannot: "this
 * one person, for this one reason, for now."
 *
 * Two lists rather than one, because they are not the same kind of
 * thing. A DENY is a fence — the role still says yes and this says no.
 * An ALLOW is a loan, and the reason and the end date are what stop the
 * loan becoming the answer to "who can dispatch?" a year from now.
 */

export type Override = {
  id: number;
  permission: string;
  effect: "ALLOW" | "DENY";
  scope: string | null;
  reason: string;
  expiresAt: string | null;
  grantedBy: string | null;
};

export type Grantable = { key: string; description: string | null; maxScope: string };

const SCOPES = ["OWN", "WAREHOUSE", "ALL"] as const;
const rank = (s: string) => (s === "ALL" ? 3 : s === "WAREHOUSE" ? 2 : 1);

const day = (iso: string | null) => (iso ? fmtDay(iso) : null);

export default function UserOverrides({
  userId,
  overrides,
  held,
  grantable,
  manageable,
}: {
  userId: number;
  overrides: Override[];
  /** What the target currently has — the only things a DENY can remove. */
  held: { key: string; scope: string }[];
  /** What the VIEWER holds — the only things an ALLOW can hand out. */
  grantable: Grantable[];
  manageable: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState<"ALLOW" | "DENY" | null>(null);
  const [permission, setPermission] = useState("");
  const [scope, setScope] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState<number | "new" | null>(null);

  const denies = overrides.filter((o) => o.effect === "DENY");
  const allows = overrides.filter((o) => o.effect === "ALLOW");

  const already = useMemo(() => new Set(overrides.map((o) => o.permission)), [overrides]);

  /** A DENY offers what they have; an ALLOW offers what you have and
   *  they do not. Both minus anything already excepted. */
  const options = useMemo(() => {
    if (open === "DENY") {
      return held.filter((h) => !already.has(h.key)).map((h) => ({ key: h.key, maxScope: h.scope }));
    }
    const hasIt = new Set(held.map((h) => h.key));
    return grantable
      .filter((g) => !hasIt.has(g.key) && !already.has(g.key))
      .map((g) => ({ key: g.key, maxScope: g.maxScope }));
  }, [open, held, grantable, already]);

  const maxScope = options.find((o) => o.key === permission)?.maxScope ?? "OWN";

  function start(effect: "ALLOW" | "DENY") {
    setOpen(effect);
    setPermission("");
    setScope("");
    setReason("");
    setExpiresAt("");
  }

  async function save() {
    if (!permission) {
      toast.error("Choose a permission.");
      return;
    }
    if (open === "ALLOW" && !scope) {
      toast.error("Choose how wide the allowance goes.");
      return;
    }
    if (reason.trim().length < 5) {
      toast.error("Say why — it stays on the record.");
      return;
    }
    setBusy("new");
    const result = await api<{ ok: true }>(`/admin/users/${userId}/overrides`, {
      body: {
        permission,
        effect: open,
        ...(open === "ALLOW" ? { scope } : {}),
        reason: reason.trim(),
        ...(expiresAt ? { expiresAt } : {}),
      },
    });
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success(open === "ALLOW" ? "Allowed." : "Denied.");
    setOpen(null);
    router.refresh();
  }

  async function lift(o: Override) {
    setBusy(o.id);
    const result = await api(`/admin/users/${userId}/overrides/${o.id}`, { method: "DELETE" });
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Lifted.");
    router.refresh();
  }

  const line = (o: Override) => (
    <li
      key={o.id}
      className="flex items-start gap-2 rounded-lg border border-verdigris-300/12 bg-ink-900/40 px-3 py-2"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[0.76rem] text-verdigris-100">
          {o.permission}
          {o.scope ? (
            <span className="text-verdigris-200/50"> @ {o.scope.toLowerCase()}</span>
          ) : null}
        </span>
        <span className="block text-xs text-verdigris-200/55">{o.reason}</span>
        <span className="block text-[0.7rem] text-verdigris-200/35">
          {o.grantedBy ? `by ${o.grantedBy}` : "by an earlier hand"}
          {o.expiresAt ? ` · ends ${day(o.expiresAt)}` : " · no end date"}
        </span>
      </span>
      {manageable ? (
        <button
          type="button"
          onClick={() => void lift(o)}
          disabled={busy === o.id}
          className="shrink-0 rounded-lg border border-verdigris-300/15 px-2.5 py-1 text-xs text-verdigris-200/80 transition-colors hover:border-verdigris-300/40 hover:text-verdigris-50 disabled:opacity-50"
        >
          {busy === o.id ? <Spinner className="h-3 w-3" /> : "Lift"}
        </button>
      ) : null}
    </li>
  );

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-verdigris-50">Exceptions</h2>
      <p className="mt-1 text-xs leading-5 text-verdigris-200/50">
        One person, one reason. Anything here overrides what their roles say, and takes effect on
        their very next request.
      </p>

      {denies.length > 0 ? (
        <>
          <p className="mt-4 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-rose-300/80">
            Cannot, despite the role
          </p>
          <ul className="mt-2 space-y-1.5">{denies.map(line)}</ul>
        </>
      ) : null}

      {allows.length > 0 ? (
        <>
          <p className="mt-4 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-emerald-300/80">
            Can, beyond the role
          </p>
          <ul className="mt-2 space-y-1.5">{allows.map(line)}</ul>
        </>
      ) : null}

      {overrides.length === 0 ? (
        <p className="mt-4 text-xs text-verdigris-200/45">
          None. This account can do exactly what its roles say.
        </p>
      ) : null}

      {manageable && open === null ? (
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => start("DENY")}
            className="flex-1 rounded-lg border border-rose-400/30 px-3 py-2 text-sm text-rose-200 transition-colors hover:border-rose-400/60"
          >
            Take one away
          </button>
          <button
            type="button"
            onClick={() => start("ALLOW")}
            className="flex-1 rounded-lg border border-emerald-400/30 px-3 py-2 text-sm text-emerald-200 transition-colors hover:border-emerald-400/60"
          >
            Add one
          </button>
        </div>
      ) : null}

      {manageable && open !== null ? (
        <div className="mt-5 border-t border-verdigris-300/10 pt-4">
          <p className="text-[0.84rem] font-medium text-verdigris-100">
            {open === "DENY"
              ? "Take a permission away from this person"
              : "Give this person a permission their roles do not carry"}
          </p>

          <label className="mt-3 block text-xs font-medium text-verdigris-200/70">
            Permission
            <select
              value={permission}
              onChange={(e) => {
                setPermission(e.target.value);
                setScope("");
              }}
              className="mt-1 w-full rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 focus:outline-none focus:ring-2 focus:ring-patina/40"
            >
              <option value="" className="bg-ink-850">
                {options.length === 0
                  ? open === "DENY"
                    ? "Nothing left to take away"
                    : "Nothing you hold that they do not"
                  : "Choose"}
              </option>
              {options.map((o) => (
                <option key={o.key} value={o.key} className="bg-ink-850">
                  {o.key}
                </option>
              ))}
            </select>
          </label>

          {open === "ALLOW" && permission ? (
            <label className="mt-3 block text-xs font-medium text-verdigris-200/70">
              How wide
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="mt-1 w-full rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 focus:outline-none focus:ring-2 focus:ring-patina/40"
              >
                <option value="" className="bg-ink-850">
                  Choose
                </option>
                {/* Never wider than you hold it yourself. The server
                    checks this again; this is so the list does not offer
                    something it will refuse. */}
                {SCOPES.filter((s) => rank(s) <= rank(maxScope)).map((s) => (
                  <option key={s} value={s} className="bg-ink-850">
                    {s.toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="mt-3 block text-xs font-medium text-verdigris-200/70">
            Why
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Stays on the record, and on their page."
              className="mt-1 w-full rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40"
            />
          </label>

          <label className="mt-3 block text-xs font-medium text-verdigris-200/70">
            Until (optional)
            <input
              type="date"
              value={expiresAt}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="mt-1 w-full rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 focus:outline-none focus:ring-2 focus:ring-patina/40"
            />
            <span className="mt-1 block text-[0.7rem] text-verdigris-200/40">
              It lifts itself at the end of that day. Leave empty to keep it until somebody lifts it.
            </span>
          </label>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="rounded-lg border border-verdigris-300/20 px-3 py-1.5 text-sm text-verdigris-100 hover:border-verdigris-300/45"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy === "new" || options.length === 0}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold disabled:opacity-55 ${
                open === "ALLOW"
                  ? "bg-verdigris-400 text-ink-900 hover:bg-patina"
                  : "bg-rose-500/85 text-white hover:bg-rose-500"
              }`}
            >
              {busy === "new" ? <Spinner className="h-3.5 w-3.5" /> : null}
              {open === "ALLOW" ? "Allow" : "Deny"}
            </button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
