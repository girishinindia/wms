"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ChevronIcon } from "@/components/icons";

import OrgNodePermissions from "./OrgNodePermissions";

/**
 * The hierarchy, as a tree.
 *
 * Three decisions worth stating, because each one is a thing that goes
 * wrong in tree views:
 *
 *   1. **Counts on collapsed nodes.** A branch that says nothing until
 *      you open it makes you open all of them. Every node carries its
 *      own summary — "8 people · 5 roles", "level 40 · 14 permissions"
 *      — so a fully collapsed tree is still an answer.
 *
 *   2. **Search expands to matches.** Filtering a tree by hiding rows
 *      leaves a parent whose label does not match looking empty. A match
 *      anywhere keeps its whole ancestry and opens it.
 *
 *   3. **Permissions load on expand.** A super admin holds 156 of them;
 *      shipping every list with the page would be thousands of nodes to
 *      render the two somebody opens.
 */

export type OrgNode = {
  id: string;
  label: string;
  sub?: string | null;
  meta?: string | null;
  kind: "site" | "role" | "user" | "importer" | "group";
  userId?: number;
  permissions?: number;
  warn?: boolean;
  children?: OrgNode[];
};

/** A dot per kind, so the level is readable without counting indents. */
const DOT: Record<OrgNode["kind"], string> = {
  site: "bg-verdigris-400",
  role: "bg-patina",
  user: "bg-verdigris-200/70",
  importer: "bg-amber-300/80",
  group: "bg-verdigris-300/40",
};

function matches(node: OrgNode, needle: string): boolean {
  const own = `${node.label} ${node.sub ?? ""} ${node.meta ?? ""}`.toLowerCase().includes(needle);
  return own || (node.children ?? []).some((c) => matches(c, needle));
}

function Branch({
  node,
  depth,
  needle,
  openAll,
}: {
  node: OrgNode;
  depth: number;
  needle: string;
  /** True while searching: a matched subtree opens itself. */
  openAll: boolean;
}) {
  const kids = node.children ?? [];
  /** A user node has an empty `children` from the server and gains its
   *  permissions leaf here — so "can this open?" is not just kids.length. */
  const expandable = kids.length > 0 || node.userId !== undefined;

  /**
   * Top-level branches open themselves, whatever kind they are.
   *
   * This used to read `depth === 0 && node.kind !== "user"`, which was
   * fine for the site and role views — their roots are sites and roles —
   * and left the REPORTING-LINE view showing four collapsed names and
   * nothing else, because every root there is a person.
   */
  const [open, setOpen] = useState(depth === 0);
  /**
   * Whether anybody has actually clicked this node.
   *
   * The permissions leaf hangs off `touched`, not `open`, and that is the
   * whole reason it exists: with the rule above, four people are open on
   * arrival in the line view, and hanging the leaf off `open` would fire
   * four permission fetches nobody asked for — which is the thing the
   * lazy leaf was built to avoid.
   */
  const [touched, setTouched] = useState(false);
  const shown = openAll ? true : open;

  const visible = needle ? kids.filter((c) => matches(c, needle)) : kids;

  return (
    <li>
      <div
        className="flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-verdigris-100/[0.04]"
        style={{ paddingLeft: `${depth * 1.1 + 0.5}rem` }}
      >
        {expandable ? (
          <button
            type="button"
            onClick={() => {
              setTouched(true);
              setOpen((o) => !o);
            }}
            aria-expanded={shown}
            aria-label={shown ? `Collapse ${node.label}` : `Expand ${node.label}`}
            className="mt-0.5 shrink-0 rounded p-0.5 text-verdigris-200/70 hover:text-verdigris-50"
          >
            <ChevronIcon
              aria-hidden
              className={`h-3.5 w-3.5 transition-transform ${shown ? "" : "-rotate-90"}`}
            />
          </button>
        ) : (
          <span className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        )}

        <span
          aria-hidden
          className={`mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full ${
            node.warn ? "bg-amber-400" : DOT[node.kind]
          }`}
        />

        <span className="min-w-0 flex-1">
          <span
            className={`block text-sm ${
              node.kind === "user" ? "text-verdigris-100" : "font-medium text-verdigris-50"
            }`}
          >
            {/* A person is a link out to their own page — the tree
                answers "who and what", their page answers "change it". */}
            {node.userId !== undefined ? (
              <Link
                href={`/admin/users/${node.userId}`}
                className="underline-offset-2 hover:text-verdigris-50 hover:underline"
              >
                {node.label}
              </Link>
            ) : (
              node.label
            )}
          </span>
          {node.sub ? (
            <span className="block font-mono text-[0.7rem] text-verdigris-200/60">{node.sub}</span>
          ) : null}
        </span>

        {node.meta ? (
          <span
            className={`shrink-0 whitespace-nowrap text-[0.72rem] ${
              node.warn ? "text-amber-200/90" : "text-verdigris-200/60"
            }`}
          >
            {node.meta}
          </span>
        ) : null}
      </div>

      {shown && expandable ? (
        <>
          {visible.length > 0 ? (
            <ul className="border-l border-verdigris-300/10" style={{ marginLeft: `${depth * 1.1 + 1.1}rem` }}>
              {visible.map((c) => (
                <Branch key={c.id} node={c} depth={depth + 1} needle={needle} openAll={openAll} />
              ))}
            </ul>
          ) : null}

          {node.userId !== undefined && (node.permissions ?? 0) > 0 && (touched || openAll) ? (
            <div
              className="border-l border-verdigris-300/10 pl-3 pr-2"
              style={{ marginLeft: `${depth * 1.1 + 1.1}rem` }}
            >
              <OrgNodePermissions userId={node.userId} />
            </div>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

export default function OrgTree({ nodes }: { nodes: OrgNode[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();

  const roots = useMemo(
    () => (needle ? nodes.filter((n) => matches(n, needle)) : nodes),
    [nodes, needle],
  );

  return (
    <div>
      <div className="border-b border-verdigris-300/10 px-5 py-4">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a person, a role, a site…"
          aria-label="Search the hierarchy"
          className="w-full rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-1.5 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40"
        />
        {needle ? (
          <p className="mt-2 text-xs text-verdigris-200/60">
            {roots.length === 0
              ? "Nothing matches."
              : `${roots.length} branch${roots.length === 1 ? "" : "es"} contain a match — opened to show it.`}
          </p>
        ) : null}
      </div>

      {roots.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-verdigris-200/60">
          {needle ? "Nothing matches that." : "Nothing to show in this view."}
        </p>
      ) : (
        <ul className="py-2 pr-3">
          {roots.map((n) => (
            <Branch key={n.id} node={n} depth={0} needle={needle} openAll={Boolean(needle)} />
          ))}
        </ul>
      )}
    </div>
  );
}
