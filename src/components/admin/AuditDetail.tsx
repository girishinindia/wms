"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { XIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { api } from "@/lib/api/client";
import { fmtDay, fmtTime } from "@/lib/format/datetime";

/**
 * One audit entry, opened.
 *
 * Everything the list deliberately leaves out lives here: the before
 * and after payloads, the IP, the user agent, the request id. That
 * split is the point — those payloads carry contact details, GSTIN and
 * PAN, so they are fetched for one row when somebody asks for it rather
 * than sprayed across every page of a list.
 *
 * Fetched on open, not passed down with the page. A list of 100 rows
 * would otherwise ship 100 payloads to the browser to render four of
 * them.
 */

export type Detail = {
  id: string;
  occurredAt: string;
  actorName: string | null;
  actorEmail: string | null;
  actorRoles: string[];
  action: string;
  operation: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  result: string;
  reason: string | null;
  errorCode: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  correlationId: string | null;
  source: string;
  durationMs: number | null;
  changedKeys: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

/** JSON that reads as a value, not as a blob. */
function show(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value === "" ? "(empty)" : value;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

/** Day and clock to the second — an audit entry is often opened to
 *  settle exactly when something happened. */
const when = (iso: string) => `${fmtDay(iso)}, ${fmtTime(iso)}`;

export default function AuditDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await api<Detail>(`/admin/audit/${id}`, { method: "GET" });
      if (!alive) return;
      if (result.ok) setDetail(result.data);
      else setFailed(result.error.message);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // Escape closes, like every other panel in the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * The union of both sides' keys, so a field that was only ADDED (absent
   * from `before`) or only REMOVED (absent from `after`) still gets a
   * row. Iterating one side alone silently hides exactly the changes
   * most worth seeing.
   */
  const keys = detail
    ? [...new Set([...Object.keys(detail.before ?? {}), ...Object.keys(detail.after ?? {})])].sort()
    : [];

  const fact = (label: string, value: string | null) =>
    value ? (
      <div className="flex gap-3 py-1.5">
        <dt className="w-32 shrink-0 text-xs text-verdigris-200/60">{label}</dt>
        <dd className="min-w-0 flex-1 break-words text-xs text-verdigris-100">{value}</dd>
      </div>
    ) : null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink-900/70"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Audit entry"
        className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-verdigris-300/15 bg-ink-850 card-shadow-lg"
      >
        <header className="flex items-start gap-3 border-b border-verdigris-300/10 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-mono text-sm font-semibold text-verdigris-50">
              {detail?.action ?? "Audit entry"}
            </h2>
            <p className="mt-0.5 text-xs text-verdigris-200/70">
              {detail ? when(detail.occurredAt) : `#${id}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg border border-verdigris-300/15 p-1.5 text-verdigris-200 hover:border-verdigris-300/40 hover:text-verdigris-50"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </header>

        {failed ? (
          <p className="px-5 py-8 text-sm text-rose-300">{failed}</p>
        ) : !detail ? (
          <p className="flex items-center gap-2 px-5 py-8 text-sm text-verdigris-200/70">
            <Spinner className="h-4 w-4" /> Loading…
          </p>
        ) : (
          <div className="px-5 py-4">
            <dl className="divide-y divide-verdigris-300/[0.06]">
              {fact(
                "Who",
                detail.actorName || detail.actorEmail
                  ? `${detail.actorName ?? ""}${detail.actorEmail ? ` · ${detail.actorEmail}` : ""}`.trim()
                  : "not signed in",
              )}
              {fact("Roles", detail.actorRoles.length ? detail.actorRoles.join(", ") : null)}
              {fact("Operation", detail.operation)}
              {fact(
                "On",
                `${detail.entityType} #${detail.entityId}${
                  detail.entityLabel ? ` · ${detail.entityLabel}` : ""
                }`,
              )}
              {fact("Result", detail.result)}
              {fact("Reason", detail.reason)}
              {fact("Error", detail.errorCode)}
              {fact("Source", detail.source)}
              {fact("From", detail.ip)}
              {fact("Took", detail.durationMs === null ? null : `${detail.durationMs} ms`)}
              {fact("Request", detail.requestId)}
              {fact("Correlation", detail.correlationId)}
              {fact("Agent", detail.userAgent)}
            </dl>

            {keys.length > 0 ? (
              <>
                <h3 className="mt-6 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-verdigris-200/80">
                  What changed
                </h3>
                <table className="mt-2 w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-verdigris-300/10">
                      <th className="py-1.5 pr-2 font-medium text-verdigris-200/75">Field</th>
                      <th className="py-1.5 pr-2 font-medium text-verdigris-200/75">Before</th>
                      <th className="py-1.5 font-medium text-verdigris-200/75">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((key) => {
                      const from = show(detail.before?.[key]);
                      const to = show(detail.after?.[key]);
                      /**
                       * `changed_keys` is what the writer decided moved.
                       * Falling back to comparing the rendered strings
                       * covers the rows written before that column was
                       * filled in — of which there are plenty.
                       */
                      const moved = detail.changedKeys.length
                        ? detail.changedKeys.includes(key)
                        : from !== to;
                      return (
                        <tr
                          key={key}
                          className={`border-b border-verdigris-300/[0.06] last:border-0 ${
                            moved ? "bg-patina/[0.06]" : ""
                          }`}
                        >
                          <td className="py-1.5 pr-2 align-top font-mono text-[0.72rem] text-verdigris-200/80">
                            {key}
                          </td>
                          <td className="py-1.5 pr-2 align-top break-words text-verdigris-200/70">
                            {from}
                          </td>
                          <td
                            className={`py-1.5 align-top break-words ${
                              moved ? "text-verdigris-50" : "text-verdigris-200/70"
                            }`}
                          >
                            {to}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="mt-6 text-xs text-verdigris-200/60">
                This entry records that it happened, not what it contained.
              </p>
            )}
          </div>
        )}
      </aside>
    </div>,
    document.body,
  );
}
