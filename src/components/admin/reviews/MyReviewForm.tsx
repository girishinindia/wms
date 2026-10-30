"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";
import { fmtDateTime } from "@/lib/format/datetime";
import type { MyReview } from "@/lib/reviews/ops";
import { REVIEW_BODY_MAX, REVIEW_BODY_MIN, reviewInputSchema, type ReviewStatus } from "@/lib/reviews/validation";

import { Card, ConfirmDialog } from "../ui";

const STATUS_COPY: Record<ReviewStatus, { title: string; text: string; tone: string }> = {
  PENDING: {
    title: "Waiting for approval",
    text: "A super admin will read it soon. It is not on the website yet.",
    tone: "border-amber-400/35 bg-amber-400/5 text-amber-200",
  },
  APPROVED: {
    title: "On the website",
    text: "Your review is on the public Reviews page. If you change it, it goes back for approval.",
    tone: "border-verdigris-400/35 bg-verdigris-400/5 text-verdigris-300",
  },
  REJECTED: {
    title: "Not approved",
    text: "Change it and send it again — the reason is below.",
    tone: "border-rose-400/35 bg-rose-400/5 text-rose-200",
  },
  HIDDEN: {
    title: "Hidden from the website",
    text: "A super admin has taken it off the website. Change it and send it again if you like.",
    tone: "border-verdigris-300/20 bg-ink-900/40 text-verdigris-200/70",
  },
};

const LABELS = ["", "Poor", "Below average", "Good", "Very good", "Excellent"];

export default function MyReviewForm({ initial }: { initial: MyReview | null }) {
  const router = useRouter();
  const toast = useToast();
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState(initial?.body ?? "");
  const [showName, setShowName] = useState(initial?.showName ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [askWithdraw, setAskWithdraw] = useState(false);

  const length = body.trim().length;
  const shown = hover || rating;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = reviewInputSchema.safeParse({ rating, body, showName });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    const result = await api<{ review: MyReview }>("/reviews/mine", { method: "PUT", body: parsed.data });
    setBusy(false);
    if (!result.ok) {
      if (result.error.fields) setErrors(result.error.fields);
      toast.error(result.error.message);
      return;
    }
    toast.success(initial ? "Saved. It has gone back for approval." : "Thank you — sent for approval.");
    router.refresh();
  }

  async function withdraw() {
    setBusy(true);
    const result = await api<{ withdrawn: boolean }>("/reviews/mine", { method: "DELETE" });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setAskWithdraw(false);
    setRating(0);
    setBody("");
    setShowName(true);
    toast.success("Review withdrawn.");
    router.refresh();
  }

  const status = initial ? STATUS_COPY[initial.status] : null;

  return (
    <div className="max-w-2xl space-y-5">
      {initial && status ? (
        <div className={`rounded-2xl border p-4 text-sm ${status.tone}`}>
          <p className="font-semibold">{status.title}</p>
          <p className="mt-1 opacity-90">{status.text}</p>
          {initial.moderationNote ? (
            <p className="mt-2 break-words">
              <span className="font-medium">Note from the warehouse:</span> {initial.moderationNote}
            </p>
          ) : null}
          <p className="mt-2 text-xs opacity-70">Last changed {fmtDateTime(initial.updatedAt)}</p>
        </div>
      ) : null}

      <Card className="p-6">
        <form onSubmit={save} noValidate className="space-y-6">
          <fieldset>
            <legend className="text-sm font-medium text-verdigris-100">Your rating</legend>
            <div className="mt-2 flex items-center gap-3">
              <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${n} star${n === 1 ? "" : "s"}`}
                    aria-pressed={rating === n}
                    onClick={() => setRating(n)}
                    onMouseEnter={() => setHover(n)}
                    className="rounded p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-verdigris-400"
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true" fill="currentColor"
                      className={`h-8 w-8 transition-colors ${n <= shown ? "text-amber-500" : "text-verdigris-300/25"}`}>
                      <path d="M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z" />
                    </svg>
                  </button>
                ))}
              </div>
              <span className="text-sm text-verdigris-200/70">{LABELS[shown] ?? ""}</span>
            </div>
            {errors.rating ? <p className="mt-1.5 text-xs text-rose-200">{errors.rating}</p> : null}
          </fieldset>

          <label className="block">
            <span className="text-sm font-medium text-verdigris-100">Your review</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              maxLength={REVIEW_BODY_MAX}
              placeholder="How has storing, picking and dispatch gone for your company?"
              className="mt-1.5 w-full rounded-xl border border-verdigris-300/20 bg-ink-900 px-3.5 py-2.5 text-sm leading-relaxed text-verdigris-50 outline-none focus:border-verdigris-400/60"
            />
            <span className="mt-1 flex justify-between text-xs">
              <span className={errors.body ? "text-rose-200" : "text-verdigris-200/50"}>
                {errors.body ?? `At least ${REVIEW_BODY_MIN} characters. Plain text — no links or HTML.`}
              </span>
              <span className={`tabular-nums ${length < REVIEW_BODY_MIN ? "text-verdigris-200/50" : "text-verdigris-300"}`}>
                {length}/{REVIEW_BODY_MAX}
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={showName}
              onChange={(e) => setShowName(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-verdigris-400"
            />
            <span>
              <span className="text-verdigris-100">Show my first name and company</span>
              <span className="mt-0.5 block text-xs text-verdigris-200/55">
                Shown as e.g. “Ravi S., your company”. Untick to appear as “A verified importer” — your city still shows.
                Your email and mobile are never shown.
              </span>
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-3 border-t border-verdigris-300/10 pt-5">
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina disabled:opacity-60"
            >
              {busy ? "Sending…" : initial ? "Save and send for approval" : "Send for approval"}
            </button>
            {initial ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setAskWithdraw(true)}
                className="rounded-xl border border-verdigris-300/20 px-4 py-2.5 text-sm text-verdigris-200/75 hover:border-rose-400/50 hover:text-rose-200"
              >
                Withdraw my review
              </button>
            ) : null}
          </div>
        </form>
      </Card>

      {askWithdraw ? (
        <ConfirmDialog
          title="Withdraw your review?"
          message="It is removed from the website and from the queue. You can write a new one any time."
          confirmLabel="Withdraw"
          busy={busy}
          onConfirm={withdraw}
          onCancel={() => setAskWithdraw(false)}
        />
      ) : null}
    </div>
  );
}
