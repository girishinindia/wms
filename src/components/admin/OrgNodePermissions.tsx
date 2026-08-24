"use client";

import { useEffect, useState } from "react";

import Spinner from "@/components/Spinner";
import { api } from "@/lib/api/client";

/**
 * What one person can actually do, opened.
 *
 * Fetched here rather than shipped with the tree: a super admin holds
 * 156 permissions, and 22 people expanded at once is several thousand
 * nodes rendered so that somebody can read two of them.
 *
 * Grouped module → resource → verbs, which is the shape of the question
 * people ask ("can they delete an expense?") rather than the shape of
 * the table.
 */

type Group = {
  module: string;
  rows: { resource: string; verbs: string[]; scope: string; fromRole: boolean }[];
};

const pretty = (s: string) =>
  s.replace(/^master\./, "").replace(/[_.]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function OrgNodePermissions({ userId }: { userId: number }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await api<{ groups: Group[] }>(`/admin/org/user/${userId}/permissions`, {
        method: "GET",
      });
      if (!alive) return;
      if (result.ok) setGroups(result.data.groups);
      else setFailed(result.error.message);
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  if (failed) return <p className="py-1.5 text-xs text-rose-300">{failed}</p>;

  if (groups === null) {
    return (
      <p className="flex items-center gap-2 py-1.5 text-xs text-verdigris-200/60">
        <Spinner className="h-3 w-3" /> Reading permissions…
      </p>
    );
  }

  if (groups.length === 0) {
    return (
      <p className="py-1.5 text-xs text-verdigris-200/60">
        This account holds no permissions at all.
      </p>
    );
  }

  return (
    <ul className="space-y-2 py-1">
      {groups.map((g) => (
        <li key={g.module}>
          <p className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-verdigris-200/70">
            {g.module.replace(/_/g, " ").toLowerCase()}
          </p>
          <ul className="mt-1 space-y-0.5">
            {g.rows.map((r) => (
              <li
                key={r.resource}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs"
              >
                <span className="min-w-[9rem] text-verdigris-100">{pretty(r.resource)}</span>
                <span className="text-verdigris-200/75">{r.verbs.join(" · ")}</span>
                <span className="text-[0.68rem] text-verdigris-200/45">@{r.scope.toLowerCase()}</span>
                {/*
                  Held by exception rather than by any role. Worth its own
                  mark on a page about who can do what: it is the one
                  line that will not be explained by the role above it.
                */}
                {r.fromRole ? null : (
                  <span className="rounded-full border border-amber-400/40 px-1.5 text-[0.64rem] uppercase tracking-wide text-amber-200">
                    exception
                  </span>
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
