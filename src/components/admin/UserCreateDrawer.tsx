"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { XIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";

/**
 * "Add user" — a login for a member of staff.
 *
 * The role list is not a constant in this file. It arrives from the
 * server, computed from `role_creation_rule` against the roles the
 * person clicking actually holds, so a warehouse admin is never offered
 * "Warehouse Admin" or "Super Admin" and never sees a site that is not
 * theirs. A dropdown that offers what the API will refuse teaches people
 * to distrust the screen.
 *
 * The password is created on the server, shown here once, and emailed.
 * It is never stored anywhere a person can read it back — which is why
 * this component has a panel that appears after the drawer closes, and
 * says so plainly.
 */

export type CreatableRoleOption = {
  role: string;
  label: string;
  /** PLATFORM roles take no warehouse; WAREHOUSE roles require one. */
  domain: string;
};

export type WarehouseOption = { id: number; label: string };

type Created = {
  name: string;
  email: string;
  roleLabel: string;
  warehouseLabel: string | null;
  temporaryPassword: string;
  emailed: boolean;
};

export default function UserCreateDrawer({
  roles,
  warehouses,
}: {
  roles: CreatableRoleOption[];
  warehouses: WarehouseOption[];
}) {
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [role, setRole] = useState(roles[0]?.role ?? "");
  // One site, and it is the only one they could pick — so pick it.
  const [warehouseId, setWarehouseId] = useState(
    warehouses.length === 1 ? String(warehouses[0]!.id) : "",
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  const selected = useMemo(() => roles.find((r) => r.role === role) ?? null, [roles, role]);
  const needsWarehouse = selected?.domain === "WAREHOUSE";

  const set = (k: string, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setErrors((e) => {
      if (!e[k]) return e;
      const rest = { ...e };
      delete rest[k];
      return rest;
    });
  };

  function reset() {
    setDraft({});
    setErrors({});
    setRole(roles[0]?.role ?? "");
    setWarehouseId(warehouses.length === 1 ? String(warehouses[0]!.id) : "");
  }

  async function save() {
    if (needsWarehouse && !warehouseId) {
      setErrors({ warehouseId: "Choose a warehouse" });
      return;
    }
    setBusy(true);
    setErrors({});

    const result = await api<{
      id: number;
      email: string;
      name: string;
      roleLabel: string;
      warehouseLabel: string | null;
      temporaryPassword: string;
      emailed: boolean;
    }>("/admin/users", {
      body: {
        firstName: (draft.firstName ?? "").trim(),
        lastName: (draft.lastName ?? "").trim(),
        email: (draft.email ?? "").trim(),
        mobile: (draft.mobile ?? "").trim(),
        role,
        ...(needsWarehouse ? { warehouseId: Number(warehouseId) } : {}),
        ...((draft.note ?? "").trim() ? { note: draft.note!.trim() } : {}),
      },
    });
    setBusy(false);

    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      toast.error(result.error.message);
      return;
    }

    toast.success(`${result.data.name} added as ${result.data.roleLabel}.`);
    setCreated({
      name: result.data.name,
      email: result.data.email,
      roleLabel: result.data.roleLabel,
      warehouseLabel: result.data.warehouseLabel,
      temporaryPassword: result.data.temporaryPassword,
      emailed: result.data.emailed,
    });
    setOpen(false);
    reset();
    router.refresh();
  }

  const input =
    "mt-1.5 w-full min-w-0 rounded-lg border bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40 disabled:opacity-50";
  const label = "block text-xs font-medium leading-5 text-verdigris-200/80";
  const tone = (k: string) => (errors[k] ? "border-rose-400/50" : "border-verdigris-300/15");
  const err = (k: string) =>
    errors[k] ? <span className="mt-1 block text-xs text-rose-300">{errors[k]}</span> : null;

  const text = (
    k: string,
    lbl: string,
    opts: { type?: string; placeholder?: string; span?: boolean } = {},
  ) => (
    <label className={`${label} ${opts.span ? "@lg:col-span-2" : ""}`}>
      {lbl}
      <span className="text-amber-300"> *</span>
      <input
        type={opts.type ?? "text"}
        value={draft[k] ?? ""}
        onChange={(e) => set(k, e.target.value)}
        placeholder={opts.placeholder}
        className={`${input} ${tone(k)}`}
      />
      {err(k)}
    </label>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-verdigris-400 px-4 py-1.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina"
      >
        Add user
      </button>

      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 flex justify-end text-left">
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="flex-1 bg-ink-900/70"
              />
              <aside
                role="dialog"
                aria-modal="true"
                aria-label="Add user"
                className="@container flex h-full w-full min-w-0 max-w-[min(34rem,100vw)] flex-col border-l border-verdigris-300/10 bg-ink-850 shadow-2xl"
              >
                <header className="flex items-center justify-between border-b border-verdigris-300/10 px-6 py-4">
                  <div>
                    <h2 className="text-base font-semibold text-verdigris-50">Add user</h2>
                    <p className="mt-0.5 text-xs text-verdigris-200/55">
                      A temporary password is created, emailed, and shown to you once.
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={() => setOpen(false)}
                    className="inline-grid h-8 w-8 place-items-center rounded-lg border border-verdigris-300/15 text-verdigris-200/75 hover:border-verdigris-300/40 hover:text-verdigris-50"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                </header>

                <div className="flex-1 overflow-y-auto px-6 py-5">
                  <form
                    id="user-create-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void save();
                    }}
                    className="space-y-5"
                  >
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">
                        Person
                      </p>
                      <div className="mt-3 grid gap-x-5 gap-y-4 @lg:grid-cols-2">
                        {text("firstName", "First name")}
                        {text("lastName", "Last name")}
                        {text("email", "Email", { type: "email", span: true })}
                        {text("mobile", "Mobile", { placeholder: "9876543210" })}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">
                        Role
                      </p>
                      <div className="mt-3 grid gap-x-5 gap-y-4 @lg:grid-cols-2">
                        <label className={label}>
                          Role<span className="text-amber-300"> *</span>
                          <select
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            className={`${input} pr-8 ${tone("role")}`}
                          >
                            {roles.map((r) => (
                              <option key={r.role} value={r.role} className="bg-ink-850">
                                {r.label}
                              </option>
                            ))}
                          </select>
                          {err("role")}
                        </label>

                        {needsWarehouse ? (
                          <label className={label}>
                            Warehouse<span className="text-amber-300"> *</span>
                            <select
                              value={warehouseId}
                              onChange={(e) => {
                                setWarehouseId(e.target.value);
                                setErrors((x) => {
                                  const rest = { ...x };
                                  delete rest.warehouseId;
                                  return rest;
                                });
                              }}
                              className={`${input} pr-8 ${tone("warehouseId")}`}
                            >
                              <option value="" className="bg-ink-850">
                                {warehouses.length === 0 ? "No warehouses" : "Choose…"}
                              </option>
                              {warehouses.map((w) => (
                                <option key={w.id} value={w.id} className="bg-ink-850">
                                  {w.label}
                                </option>
                              ))}
                            </select>
                            {err("warehouseId")}
                          </label>
                        ) : (
                          <p className="self-end text-xs text-verdigris-200/50">
                            This role is platform-wide and takes no warehouse.
                          </p>
                        )}
                      </div>
                    </div>

                    <label className={label}>
                      Note
                      <textarea
                        value={draft.note ?? ""}
                        onChange={(e) => set("note", e.target.value)}
                        rows={2}
                        placeholder="Why this account exists — kept on the role assignment."
                        className={`${input} ${tone("note")}`}
                      />
                      {err("note")}
                    </label>

                    <p className="rounded-lg border border-verdigris-300/12 bg-ink-900/40 px-4 py-3 text-xs leading-5 text-verdigris-200/60">
                      They sign in with this email address and the temporary password, and are asked
                      to choose their own before they can go any further. Super admins are notified
                      that the account was created.
                    </p>
                  </form>
                </div>

                <footer className="flex items-center justify-end gap-2 border-t border-verdigris-300/10 px-6 py-4">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={busy}
                    className="rounded-lg border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    form="user-create-form"
                    disabled={busy || !role}
                    className="inline-flex items-center gap-2 rounded-lg bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-patina disabled:opacity-60"
                  >
                    {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
                    Add user
                  </button>
                </footer>
              </aside>
            </div>,
            document.body,
          )
        : null}

      {created ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 text-left">
          <div className="absolute inset-0 bg-ink-900/70" aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="User created"
            className="relative w-full max-w-md rounded-2xl border border-verdigris-300/20 bg-ink-850 p-6 card-shadow"
          >
            <h2 className="text-base font-semibold text-verdigris-50">
              {created.name} added as {created.roleLabel}
              {created.warehouseLabel ? ` at ${created.warehouseLabel}` : ""}
            </h2>
            <p className="mt-2 text-sm text-verdigris-200/75">
              {created.emailed
                ? `The password below was also emailed to ${created.email}.`
                : `The email to ${created.email} did not go out — hand the password over yourself.`}{" "}
              It is shown here <strong className="text-verdigris-50">once</strong> and cannot be read
              back afterwards.
            </p>
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-verdigris-300/20 bg-ink-900/60 px-4 py-3">
              <code className="flex-1 select-all font-mono text-lg tracking-wider text-verdigris-50">
                {created.temporaryPassword}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(created.temporaryPassword)
                    .then(() => toast.success("Copied."));
                }}
                className="rounded-lg border border-verdigris-300/25 px-3 py-1.5 text-xs text-verdigris-100 hover:border-verdigris-300/50"
              >
                Copy
              </button>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setCreated(null)}
                className="rounded-lg bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-patina"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
