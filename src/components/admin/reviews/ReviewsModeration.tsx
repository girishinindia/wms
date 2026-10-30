"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";
import { fmtDateTime } from "@/lib/format/datetime";
import type { AdminReview, ReviewCounts } from "@/lib/reviews/ops";
import type { ReviewStatus } from "@/lib/reviews/validation";

import { Card, ConfirmDialog, Empty } from "../ui";
import Stars from "./Stars";

const TABS: { key: ReviewStatus | "ALL"; label: string }[] = [
  { key: "PENDING", label: "Waiting" },
  { key: "APPROVED", label: "On the website" },
  { key: "REJECTED", label: "Rejected" },
  { key: "HIDDEN", label: "Hidden" },
  { key: "ALL", label: "All" },
];

const STATUS_LABEL: Record<ReviewStatus, string> = {
  PENDING: "Waiting",
  APPROVED: "On the website",
  REJECTED: "Rejected",
  HIDDEN: "Hidden",
};

const STATUS_TONE: Record<ReviewStatus, string> = {
  PENDING: "border-amber-400/40 text-amber-200",
  APPROVED: "border-verdigris-400/40 text-verdigris-300",
  REJECTED: "border-rose-400/40 text-rose-200",
  HIDDEN: "border-verdigris-300/20 text-verdigris-200/60",
};

const btn = "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-55";

type Ask = { review: AdminReview; decision: "REJECT" | "HIDE" | "DELETE" } | null;

/**
 * One card per review rather than a table: the text IS the thing being
 * judged, and a table cell either truncates it or ruins the row height.
 */
export default function ReviewsModeration({
  items,
  counts,
  status,
}: {
  items: AdminReview[];
  counts: ReviewCounts;
  status: ReviewStatus | "ALL";
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [note, setNote] = useState("");

  const total = counts.PENDING + counts.APPROVED + counts.REJECTED + counts.HIDDEN;
  const countOf = (k: ReviewStatus | "ALL") => (k === "ALL" ? total : counts[k]);

  async function decide(review: AdminReview, decision: "APPROVE" | "REJECT" | "HIDE", why?: string) {
    setBusy(review.id);
    const result = await api<{ status: ReviewStatus }>(`/admin/reviews/${review.id}/decision`, {
      body: { decision, note: why ?? "" },
    });
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error.fields?.note ?? result.error.message);
      return false;
    }
    toast.success(
      decision === "APPROVE" ? "Approved — it is on the website now." : decision === "REJECT" ? "Rejected." : "Hidden from the website.",
    );
    router.refresh();
    return true;
  }

  async function remove(review: AdminReview) {
    setBusy(review.id);
    const result = await api<{ deleted: boolean }>(`/admin/reviews/${review.id}`, { method: "DELETE" });
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error.message);
      return false;
    }
    toast.success("Review deleted.");
    router.refresh();
    return true;
  }

  async function confirmAsk() {
    if (!ask) return;
    const done = ask.decision === "DELETE" ? await remove(ask.review) : await decide(ask.review, ask.decision, note.trim());
    if (done) {
      setAsk(null);
      setNote("");
    }
  }

  return (
    <>
      <nav aria-label="Review status" className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <a
            key={t.key}
            href={`/admin/website/reviews?status=${t.key}`}
            aria-current={status === t.key ? "page" : undefined}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
              status === t.key
                ? "border-verdigris-400/60 bg-verdigris-400/15 text-verdigris-50"
                : "border-verdigris-300/15 text-verdigris-200/65 hover:border-verdigris-300/35 hover:text-verdigris-100"
            }`}
          >
            {t.label} <span className="ml-1 tabular-nums opacity-70">{countOf(t.key)}</span>
          </a>
        ))}
      </nav>

      {items.length === 0 ? (
        <Card className="p-2">
          <Empty
            title={status === "PENDING" ? "Nothing waiting for a decision" : "No reviews here"}
            hint="Importers and their sales agents write reviews from “My review” after signing in."
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((r) => (
            <Card key={r.id} className="flex min-w-0 flex-col p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Stars rating={r.rating} />
                <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STATUS_TONE[r.status]}`}>
                  {STATUS_LABEL[r.status]}
                </span>
              </div>
              <p className="mt-3 flex-1 whitespace-pre-line break-words text-sm leading-relaxed text-verdigris-100">{r.body}</p>

              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-verdigris-300/10 pt-3 text-xs">
                <dt className="text-verdigris-200/50">Written by</dt>
                <dd className="min-w-0 truncate text-verdigris-100">
                  {r.author.name} <span className="text-verdigris-200/50">· {r.author.role} · {r.author.email}</span>
                </dd>
                <dt className="text-verdigris-200/50">Company</dt>
                <dd className="min-w-0 truncate text-verdigris-100">
                  {r.importer.name} <span className="font-mono text-verdigris-200/50">{r.importer.code}</span>
                  {r.importer.city ? <span className="text-verdigris-200/50"> · {r.importer.city}</span> : null}
                </dd>
                <dt className="text-verdigris-200/50">Shown as</dt>
                <dd className="text-verdigris-100">{r.showName ? "Name and company" : "“A verified importer” (city only)"}</dd>
                <dt className="text-verdigris-200/50">Written</dt>
                <dd className="text-verdigris-100">{fmtDateTime(r.updatedAt)}</dd>
                {r.moderatedAt ? (
                  <>
                    <dt className="text-verdigris-200/50">Decided</dt>
                    <dd className="text-verdigris-100">
                      {fmtDateTime(r.moderatedAt)}
                      {r.moderatedBy ? ` by ${r.moderatedBy}` : ""}
                    </dd>
                  </>
                ) : null}
                {r.moderationNote ? (
                  <>
                    <dt className="text-verdigris-200/50">Note</dt>
                    <dd className="break-words text-verdigris-100">{r.moderationNote}</dd>
                  </>
                ) : null}
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                {r.status !== "APPROVED" ? (
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => decide(r, "APPROVE")}
                    className={`${btn} border-verdigris-400/50 bg-verdigris-400 font-semibold text-ink-900 hover:bg-patina`}
                  >
                    Approve
                  </button>
                ) : null}
                {r.status !== "REJECTED" ? (
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => { setNote(""); setAsk({ review: r, decision: "REJECT" }); }}
                    className={`${btn} border-rose-400/40 text-rose-200 hover:border-rose-400/70`}
                  >
                    Reject
                  </button>
                ) : null}
                {r.status === "APPROVED" ? (
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => { setNote(""); setAsk({ review: r, decision: "HIDE" }); }}
                    className={`${btn} border-verdigris-300/25 text-verdigris-100 hover:border-verdigris-300/50`}
                  >
                    Hide
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy === r.id}
                  onClick={() => setAsk({ review: r, decision: "DELETE" })}
                  className={`${btn} ml-auto border-verdigris-300/15 text-verdigris-200/60 hover:border-rose-400/50 hover:text-rose-200`}
                >
                  Delete
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {ask ? (
        <ConfirmDialog
          title={ask.decision === "REJECT" ? "Reject this review?" : ask.decision === "HIDE" ? "Hide this review?" : "Delete this review?"}
          message={
            ask.decision === "REJECT"
              ? `${ask.review.author.name} will see your reason on their review and can change it and send it again.`
              : ask.decision === "HIDE"
                ? "It comes off the website. The writer can still see it; approve it again any time."
                : "It is removed for good, and the writer can write a new one."
          }
          confirmLabel={ask.decision === "REJECT" ? "Reject" : ask.decision === "HIDE" ? "Hide" : "Delete"}
          tone={ask.decision === "HIDE" ? "warn" : "danger"}
          busy={busy === ask.review.id}
          confirmDisabled={ask.decision === "REJECT" && note.trim().length < 3}
          onConfirm={confirmAsk}
          onCancel={() => { setAsk(null); setNote(""); }}
        >
          {ask.decision !== "DELETE" ? (
            <label className="mt-4 block text-sm">
              <span className="text-verdigris-100">
                {ask.decision === "REJECT" ? "Reason (the writer sees this)" : "Note (optional — the writer sees this)"}
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                rows={3}
                className="mt-1.5 w-full rounded-lg border border-verdigris-300/20 bg-ink-900 px-3 py-2 text-sm text-verdigris-50 outline-none focus:border-verdigris-400/60"
              />
            </label>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
