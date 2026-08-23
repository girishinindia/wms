"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";

import { Card, Cell, Empty, Row, Table } from "./ui";

/**
 * Granting and revoking roles.
 *
 * The list of roles offered comes from `role_creation_rule` on the
 * server — not from a constant here — so the dropdown can only ever
 * contain roles this particular actor is allowed to grant. A UI that
 * offers a choice the server will refuse teaches people to distrust it.
 *
 * Immutable assignments render without a revoke button and say why.
 * `ura_protect_immutable` would refuse anyway; a disabled button with an
 * explanation is better than an enabled one that produces an error.
 */

export type Assignment = {
  id: number;
  role: string;
  domain: string;
  isImmutable: boolean;
  warehouseName: string | null;
  importerName: string | null;
  assignedAt: string;
};

export type GrantableRole = {
  role: string;
  domain: "PLATFORM" | "WAREHOUSE" | "IMPORTER";
  scope: string;
};

export type ScopeOption = { id: number; label: string };

export default function UserRoles({
  userId,
  assignments,
  grantable,
  warehouses,
  importers,
  manageable = true,
  lockedReason = null,
}: {
  userId: number;
  assignments: Assignment[];
  grantable: GrantableRole[];
  warehouses: ScopeOption[];
  importers: ScopeOption[];
  /** False when this account is not one the viewer may touch — their
   *  own row, an importer's, or somebody at another branch. Decided on
   *  the server by `mayManageUser`, and re-decided by the API. */
  manageable?: boolean;
  /** Why, in a sentence, when it is false. */
  lockedReason?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();

  const [role, setRole] = useState(grantable[0]?.role ?? "");
  const [scopeId, setScopeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  const selected = useMemo(
    () => grantable.find((g) => g.role === role) ?? null,
    [grantable, role],
  );
  const needs = selected?.domain === "WAREHOUSE" ? "warehouse" : selected?.domain === "IMPORTER" ? "importer" : "none";
  const options = needs === "warehouse" ? warehouses : needs === "importer" ? importers : [];

  async function assign() {
    if (!selected) return;
    if (needs !== "none" && !scopeId) {
      toast.error(`Choose a ${needs} for that role.`);
      return;
    }

    setBusy(true);
    const result = await api<{ ok: true }>(`/admin/users/${userId}/roles`, {
      body: {
        role,
        ...(needs === "warehouse" ? { warehouseId: Number(scopeId) } : {}),
        ...(needs === "importer" ? { importerId: Number(scopeId) } : {}),
      },
    });
    setBusy(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success(`${role.replace(/_/g, " ").toLowerCase()} granted.`);
    setScopeId("");
    router.refresh();
  }

  async function revoke(assignment: Assignment) {
    if (reason.trim().length < 5) {
      toast.error("Give a reason for revoking.");
      return;
    }
    setBusy(true);
    const result = await api<{ ok: true }>(`/admin/users/${userId}/roles`, {
      method: "DELETE",
      body: { assignmentId: assignment.id, reason: reason.trim() },
    });
    setBusy(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success(`${assignment.role.replace(/_/g, " ").toLowerCase()} revoked.`);
    setRevokingId(null);
    setReason("");
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:items-start">
      <Card>
        <div className="border-b border-verdigris-300/10 px-5 py-4">
          <h2 className="text-sm font-semibold text-verdigris-50">Roles held</h2>
        </div>

        {assignments.length === 0 ? (
          <Empty
            title="No roles."
            hint="This account can sign in but every screen will be empty until a role is granted."
          />
        ) : (
          <Table head={["Role", "Scope", "Since", ""]}>
            {assignments.map((a) => (
              <Row key={a.id}>
                <Cell className="font-mono text-[0.78rem] uppercase tracking-[0.1em] text-verdigris-300">
                  {a.role}
                </Cell>
                <Cell className="text-verdigris-200/60">
                  {a.warehouseName ?? a.importerName ?? "platform-wide"}
                </Cell>
                <Cell className="whitespace-nowrap text-xs text-verdigris-200/50">
                  {new Date(a.assignedAt).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </Cell>
                <Cell className="text-right">
                  {a.isImmutable ? (
                    <span
                      className="text-[0.78rem] text-verdigris-200/40"
                      title="An immutable role is bound to the account for its lifetime. Suspend the account instead."
                    >
                      permanent
                    </span>
                  ) : !manageable ? null : revokingId === a.id ? (
                    <span className="inline-flex items-center gap-2">
                      <input
                        type="text"
                        autoFocus
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Reason"
                        aria-label="Reason for revoking"
                        className="w-36 rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-2.5 py-1.5 text-xs text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40"
                      />
                      <button
                        type="button"
                        onClick={() => revoke(a)}
                        disabled={busy}
                        className="rounded-lg bg-rose-500/85 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-55"
                      >
                        {busy ? <Spinner className="h-3 w-3" /> : "Confirm"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRevokingId(null);
                          setReason("");
                        }}
                        className="text-xs text-verdigris-200/50 hover:text-verdigris-100"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRevokingId(a.id)}
                      className="rounded-lg border border-verdigris-300/15 px-3 py-1.5 text-xs text-verdigris-200/80 transition-colors hover:border-rose-400/40 hover:text-rose-200"
                    >
                      Revoke
                    </button>
                  )}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      {!manageable && lockedReason ? (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-verdigris-50">Roles are read-only here</h2>
          <p className="mt-1.5 text-xs leading-5 text-verdigris-200/60">{lockedReason}</p>
        </Card>
      ) : grantable.length > 0 ? (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-verdigris-50">Grant a role</h2>
          <p className="mt-1 text-xs text-verdigris-200/50">
            Only the roles your own role is permitted to grant are listed.
          </p>

          <label htmlFor="role" className="mt-5 block text-[0.9rem] font-medium text-verdigris-100">
            Role
          </label>
          <select
            id="role"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setScopeId("");
            }}
            className="mt-1.5 w-full rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-4 py-3 text-[15px] text-verdigris-50 focus:outline-none focus:ring-2 focus:ring-patina/40"
          >
            {grantable.map((g) => (
              <option key={g.role} value={g.role} className="bg-ink-850">
                {g.role.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </select>

          {needs !== "none" ? (
            <>
              <label
                htmlFor="scope"
                className="mt-4 block text-[0.9rem] font-medium text-verdigris-100"
              >
                {needs === "warehouse" ? "Warehouse" : "Importer"}
              </label>
              <select
                id="scope"
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-4 py-3 text-[15px] text-verdigris-50 focus:outline-none focus:ring-2 focus:ring-patina/40"
              >
                <option value="" className="bg-ink-850">
                  {options.length === 0 ? `No ${needs}s yet` : `Choose a ${needs}`}
                </option>
                {options.map((o) => (
                  <option key={o.id} value={o.id} className="bg-ink-850">
                    {o.label}
                  </option>
                ))}
              </select>
              {options.length === 0 ? (
                <p className="mt-1.5 text-xs text-amber-300">
                  A {needs} has to exist before this role can be granted.
                </p>
              ) : null}
            </>
          ) : null}

          <button
            type="button"
            onClick={assign}
            disabled={busy || !role || (needs !== "none" && !scopeId)}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-verdigris-400 px-6 py-3 text-sm font-semibold text-ink-900 transition-all hover:bg-patina disabled:cursor-not-allowed disabled:opacity-55"
          >
            {busy ? <Spinner className="h-4 w-4" /> : null}
            {busy ? "Granting…" : "Grant"}
          </button>
        </Card>
      ) : null}
    </div>
  );
}
