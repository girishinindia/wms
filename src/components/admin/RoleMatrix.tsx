"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";

import StickyTableBox from "./StickyTableBox";
import { Card, ConfirmDialog } from "./ui";

/**
 * What a role is allowed to do, as a grid.
 *
 * 156 permissions across 29 resources, so the shape is module →
 * resource → the four verbs. That is also the shape of the question
 * people actually ask: "let them add, but not delete".
 *
 * Three things this component is careful about:
 *
 *   1. It sends a DIFF. Two people saving a minute apart must not undo
 *      each other's untouched rows.
 *   2. A box the server said is beyond the caller is DISABLED, not
 *      hidden — seeing that `expense.delete` exists and is out of reach
 *      is information; a grid with holes is a puzzle.
 *   3. Nothing saves without a reason and a look at the diff. This is
 *      the one screen where a mis-click changes what forty people can do
 *      and tells nobody.
 */

export type PermissionRow = {
  key: string;
  resource: string;
  action: string;
  module: string;
  isDangerous: boolean;
  description: string | null;
  scope: string | null;
  grantable: boolean;
  maxScope: string | null;
};

export type Matrix = {
  key: string;
  name: string;
  domain: string;
  level: number;
  holders: number;
  editable: boolean;
  permissions: PermissionRow[];
};

/**
 * Every action the permission table allows, in the order people think
 * about them: look, add, change, remove, then the two that are not part
 * of the usual four.
 *
 * It must stay in step with `permission_action_check`. Listing only
 * read/create/update/delete here would silently drop 40 of the 156
 * permissions — every `approve`, every `export`, and `role.assign` —
 * from the only screen that can grant them.
 */
const VERBS = ["read", "create", "update", "delete", "approve", "export", "assign"] as const;
const SCOPES = ["OWN", "WAREHOUSE", "ALL"] as const;

const naturalScope = (domain: string) =>
  domain === "WAREHOUSE" ? "WAREHOUSE" : domain === "IMPORTER" ? "OWN" : "ALL";

const rank = (s: string | null) => (s === "ALL" ? 3 : s === "WAREHOUSE" ? 2 : s === "OWN" ? 1 : 0);

const pretty = (s: string) =>
  s.replace(/^master\./, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function RoleMatrix({ matrix }: { matrix: Matrix }) {
  const router = useRouter();
  const toast = useToast();

  /** Only what has been touched. Absent key = unchanged. */
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [q, setQ] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [review, setReview] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const byKey = useMemo(
    () => new Map(matrix.permissions.map((p) => [p.key, p])),
    [matrix.permissions],
  );

  /** Current value: the draft if touched, otherwise what is stored. */
  const valueOf = (key: string): string | null =>
    key in draft ? draft[key]! : (byKey.get(key)?.scope ?? null);

  /** How many the role holds right now, draft included — so the count
   *  in the footer moves as boxes are ticked rather than lagging until
   *  the save lands. */
  const granted = useMemo(
    () => matrix.permissions.filter((p) => valueOf(p.key) !== null).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matrix.permissions, draft, byKey],
  );

  const changes = useMemo(
    () =>
      Object.entries(draft)
        .filter(([key, scope]) => (byKey.get(key)?.scope ?? null) !== scope)
        .map(([permission, scope]) => ({ permission, scope })),
    [draft, byKey],
  );

  /** module → resource → { action: row } */
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = new Map<string, Map<string, Record<string, PermissionRow>>>();
    for (const p of matrix.permissions) {
      if (needle && !`${p.key} ${p.resource} ${p.description ?? ""}`.toLowerCase().includes(needle)) {
        continue;
      }
      if (changedOnly && !changes.some((c) => c.permission === p.key)) continue;
      if (!out.has(p.module)) out.set(p.module, new Map());
      const byResource = out.get(p.module)!;
      if (!byResource.has(p.resource)) byResource.set(p.resource, {});
      byResource.get(p.resource)![p.action] = p;
    }
    return out;
  }, [matrix.permissions, q, changedOnly, changes]);

  /** The scope shown on a resource row: whatever its ticked verbs agree
   *  on, or "mixed" when they do not. */
  const rowScope = (actions: Record<string, PermissionRow>): string | "mixed" | null => {
    const live = Object.values(actions)
      .map((p) => valueOf(p.key))
      .filter((s): s is string => s !== null);
    if (live.length === 0) return null;
    return live.every((s) => s === live[0]) ? live[0]! : "mixed";
  };

  function toggle(p: PermissionRow, actions: Record<string, PermissionRow>) {
    if (!matrix.editable || !p.grantable) return;
    const current = valueOf(p.key);
    if (current !== null) {
      setDraft((d) => ({ ...d, [p.key]: null }));
      return;
    }
    // A newly ticked box inherits the row's scope when the row has one,
    // so ticking "create" beside an existing WAREHOUSE "read" does not
    // quietly hand out ALL.
    const row = rowScope(actions);
    const wanted = row && row !== "mixed" ? row : naturalScope(matrix.domain);
    const capped = rank(wanted) > rank(p.maxScope) ? p.maxScope! : wanted;
    setDraft((d) => ({ ...d, [p.key]: capped }));
  }

  function setRowScope(actions: Record<string, PermissionRow>, scope: string) {
    if (!matrix.editable) return;
    setDraft((d) => {
      const next = { ...d };
      for (const p of Object.values(actions)) {
        if (valueOf(p.key) === null || !p.grantable) continue;
        next[p.key] = rank(scope) > rank(p.maxScope) ? p.maxScope! : scope;
      }
      return next;
    });
  }

  async function save() {
    if (reason.trim().length < 5) {
      toast.error("Say why — it goes on the audit row.");
      return;
    }
    setBusy(true);
    const result = await api<{ added: number; changed: number; removed: number; holders: number }>(
      `/admin/roles/${matrix.key}`,
      { method: "PUT", body: { changes, reason: reason.trim() } },
    );
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    const { added, changed, removed, holders } = result.data;
    toast.success(
      `${added} added, ${changed} changed, ${removed} removed — ${holders} ${
        holders === 1 ? "person" : "people"
      } affected.`,
    );
    setDraft({});
    setReview(false);
    setReason("");
    router.refresh();
  }

  const cell = "px-3 py-2 text-center";

  /**
   * The verb headings over each column.
   *
   * They were `text-verdigris-200/40`, which flattens to #4e665f on the
   * card — 2.86:1, under even the 3:1 floor for large text, and these
   * are 0.72rem. On a dark screen they were simply not there. At /65
   * they land at 5.5:1, past AA for small text, while still sitting a
   * long way under the resource names (15:1) so the grid still reads
   * content-first. The light theme lifts /65 to a solid ink of its own,
   * so both themes move together.
   */
  const colHead =
    "text-[0.74rem] font-medium uppercase tracking-[0.06em] text-verdigris-200/65";

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-verdigris-300/10 px-5 py-4">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search permissions"
            className="min-w-0 flex-1 rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-1.5 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40"
          />
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-verdigris-200/70">
            <input
              type="checkbox"
              checked={changedOnly}
              onChange={(e) => setChangedOnly(e.target.checked)}
              className="h-4 w-4 rounded border-verdigris-300/30 bg-ink-900 accent-verdigris-400"
            />
            Changed only
          </label>
        </div>

        <StickyTableBox>
          <table className="w-full text-sm">
            {/*
              One `<tbody>` per module, and not for tidiness.

              A sticky row sticks only while its CONTAINING BLOCK is in
              view. With every module in one tbody, all ten band rows
              would pin at `top: 0` at once and pile on top of each
              other. A tbody each makes the sticking hand over: the next
              module's band pushes the previous one out as it arrives,
              which is what a section header should do.

              It also gives the array a real key. The `<>` this replaces
              was the element being keyed over, and a fragment cannot
              take one.
            */}
            {[...groups.entries()].map(([module, byResource]) => (
              <tbody key={module}>
                  {/*
                    The band is NOT sticky, and that was a deliberate
                    retreat.

                    Chrome does not confine a sticky table row to its
                    row group — measured: at scrollTop 1100, six module
                    bands were all pinned at `top: 0` simultaneously,
                    stacked. It LOOKS right most of the way down,
                    because same-z-index elements paint in DOM order and
                    the last stuck band is usually the module you are
                    in. It stops being right at the bottom of the list:
                    at maximum scroll the visible band read "package"
                    while the rows under it were "storage". A section
                    header that names the wrong section is worse than
                    one that scrolls away.
                  */}
                  <tr className="bg-verdigris-100/[0.03]">
                    <td
                      colSpan={VERBS.length + 2}
                      // verdigris-200 rather than -300: a module heading
                      // should not be quieter than the verbs beneath it.
                      className="px-5 py-2 font-mono text-[0.76rem] font-semibold uppercase tracking-[0.12em] text-verdigris-200"
                    >
                      {module.replace(/_/g, " ").toLowerCase()}
                    </td>
                  </tr>
                  {/*
                    The verb row IS sticky, and the pile-up that sank
                    the bands is harmless here: every module's verb row
                    carries the same seven words, so whichever one wins
                    the paint order is indistinguishable from the one
                    you wanted. It answers the only question this grid
                    is asked while scrolling — "which column is delete?"
                  */}
                  <tr>
                    <td className={`sticky top-0 z-10 bg-ink-850 px-5 py-1.5 ${colHead}`}>&nbsp;</td>
                    {VERBS.map((v) => (
                      <td
                        key={v}
                        className={`sticky top-0 z-10 bg-ink-850 px-3 py-1.5 text-center ${colHead}`}
                      >
                        {v}
                      </td>
                    ))}
                    <td
                      className={`sticky top-0 z-10 bg-ink-850 px-3 py-1.5 text-right shadow-[inset_0_-1px_0_0_color-mix(in_oklab,var(--color-verdigris-300)_12%,transparent)] ${colHead}`}
                    >
                      scope
                    </td>
                  </tr>

                  {[...byResource.entries()].map(([resource, actions]) => {
                    const scope = rowScope(actions);
                    const touched = Object.values(actions).some((p) =>
                      changes.some((c) => c.permission === p.key),
                    );
                    return (
                      <tr
                        key={resource}
                        className={`border-b border-verdigris-300/[0.06] last:border-0 ${
                          touched ? "bg-patina/[0.06]" : ""
                        }`}
                      >
                        <td className="px-5 py-2 text-verdigris-100">{pretty(resource)}</td>

                        {VERBS.map((verb) => {
                          const p = actions[verb];
                          if (!p) {
                            return (
                              <td key={verb} className={`${cell} text-verdigris-200/20`}>
                                ·
                              </td>
                            );
                          }
                          const on = valueOf(p.key) !== null;
                          const locked = !matrix.editable || !p.grantable;
                          return (
                            <td key={verb} className={cell}>
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={locked}
                                onChange={() => toggle(p, actions)}
                                aria-label={`${p.key}${locked ? " (not yours to give)" : ""}`}
                                title={
                                  !p.grantable
                                    ? `You do not hold ${p.key}, so you cannot give it.`
                                    : (p.description ?? p.key)
                                }
                                className={`h-4 w-4 rounded border-verdigris-300/30 bg-ink-900 disabled:opacity-25 ${
                                  p.isDangerous ? "accent-rose-400" : "accent-verdigris-400"
                                }`}
                              />
                            </td>
                          );
                        })}

                        <td className="px-3 py-2 text-right">
                          {scope === null ? (
                            <span className="text-[0.72rem] text-verdigris-200/25">—</span>
                          ) : (
                            <select
                              value={scope === "mixed" ? "" : scope}
                              disabled={!matrix.editable}
                              onChange={(e) => setRowScope(actions, e.target.value)}
                              className="rounded-md border border-verdigris-300/15 bg-ink-900/60 px-2 py-1 text-[0.72rem] text-verdigris-100 disabled:opacity-40"
                            >
                              {scope === "mixed" ? (
                                <option value="" className="bg-ink-850">
                                  mixed
                                </option>
                              ) : null}
                              {SCOPES.map((s) => (
                                <option key={s} value={s} className="bg-ink-850">
                                  {s.toLowerCase()}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            ))}
          </table>
        </StickyTableBox>

        {/*
          A bar along the bottom, like every list in the panel. There is
          nothing to page through here — it is one role's whole matrix —
          so it carries the count instead. The change bar below is a
          different thing: it appears only once something is ticked, and
          it is an action, not a status line.
        */}
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-verdigris-300/10 bg-ink-850 px-5 py-3">
          <span className="text-xs text-verdigris-200/60">
            {granted} of {matrix.permissions.length} permissions granted
          </span>
          <span className="text-xs text-verdigris-200/45">
            held by {matrix.holders} {matrix.holders === 1 ? "person" : "people"}
          </span>
        </div>
      </Card>

      {matrix.editable && changes.length > 0 ? (
        <div className="sticky bottom-4 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-patina/30 bg-ink-850/95 px-5 py-3 shadow-2xl backdrop-blur">
          <span className="text-sm text-verdigris-100">
            {changes.length} {changes.length === 1 ? "change" : "changes"}
            <span className="ml-2 text-xs text-verdigris-200/50">
              affects {matrix.holders} {matrix.holders === 1 ? "person" : "people"}
            </span>
          </span>
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDraft({})}
              className="rounded-lg border border-verdigris-300/20 px-3 py-1.5 text-sm text-verdigris-100 hover:border-verdigris-300/45"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => setReview(true)}
              className="rounded-lg bg-verdigris-400 px-4 py-1.5 text-sm font-semibold text-ink-900 hover:bg-patina"
            >
              Review…
            </button>
          </span>
        </div>
      ) : null}

      {review ? (
        <ConfirmDialog
          title={`Change what ${matrix.name} means?`}
          message={`${changes.length} ${changes.length === 1 ? "permission" : "permissions"} on ${
            matrix.holders
          } ${matrix.holders === 1 ? "person" : "people"}. They take effect on their very next request.`}
          confirmLabel="Save"
          busy={busy}
          onConfirm={save}
          onCancel={() => setReview(false)}
        >
          <ul className="mt-3 max-h-52 space-y-1 overflow-y-auto rounded-lg border border-verdigris-300/12 bg-ink-900/40 p-3 text-left">
            {changes.map((c) => {
              const was = byKey.get(c.permission)?.scope ?? null;
              return (
                <li key={c.permission} className="font-mono text-[0.72rem] text-verdigris-200/80">
                  {c.scope === null ? (
                    <span className="text-rose-300">− {c.permission}</span>
                  ) : was === null ? (
                    <span className="text-emerald-300">
                      + {c.permission} @ {c.scope.toLowerCase()}
                    </span>
                  ) : (
                    <span className="text-amber-200">
                      ~ {c.permission} {was.toLowerCase()} → {c.scope.toLowerCase()}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <label className="mt-3 block text-left text-[0.84rem] font-medium text-verdigris-200/70">
            Why?
            <input
              type="text"
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Goes on the audit row."
              className="mt-1 w-full rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40"
            />
          </label>
          {busy ? <Spinner className="mt-2 h-4 w-4" /> : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
