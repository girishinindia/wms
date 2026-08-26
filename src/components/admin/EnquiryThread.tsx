"use client";

import { useEffect, useState } from "react";

import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";
import { fmtDateTime } from "@/lib/format/datetime";

type ReplyStatus = "SENT" | "FAILED" | "SUPPRESSED";

type Reply = {
  id: number;
  body: string;
  sentAt: string;
  sentByName: string;
  status: ReplyStatus;
  error: string | null;
};

/**
 * The conversation, and the box to add to it.
 *
 * Replying used to be a `mailto:` link that handed the job to whatever
 * mail client the machine had. Everything after that click happened
 * somewhere this system could not see: no record that anybody answered,
 * no way for a second super admin to know it was handled, and nothing
 * to show when the customer says they never heard back.
 *
 * Fetched on open rather than shipped with the list. The enquiries
 * screen already carries 300 rows; adding every reply body to that
 * payload would grow it for the handful somebody actually opens — the
 * same reasoning as the audit drawer.
 */
export default function EnquiryThread({
  enquiryId,
  onSent,
}: {
  enquiryId: number;
  /** So the drawer's parent can refresh the list's "replied" state. */
  onSent?: () => void;
}) {
  const toast = useToast();
  const [replies, setReplies] = useState<Reply[] | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api<{ replies: Reply[] }>(`/admin/enquiries/${enquiryId}/replies`, { method: "GET" }).then(
      (result) => {
        if (!alive) return;
        // A thread that cannot be read is shown as empty rather than as
        // an error: the reply box below still works, and the failure is
        // not something the reader can act on.
        setReplies(result.ok ? result.data.replies : []);
      },
    );
    return () => {
      alive = false;
    };
  }, [enquiryId]);

  async function send() {
    if (sending || body.trim().length < 2) return;
    setSending(true);
    setError(null);

    const result = await api<{ id: number; status: ReplyStatus; error: string | null }>(
      `/admin/enquiries/${enquiryId}/replies`,
      { body: { body } },
    );
    setSending(false);

    if (!result.ok) {
      setError(result.error.fields?.body ?? result.error.message);
      toast.error(result.error.message);
      return;
    }

    /**
     * The reply is kept whatever the provider did, so the box empties
     * either way — the words are safe. What changes is what the row
     * says about itself.
     */
    setReplies((current) => [
      ...(current ?? []),
      {
        id: result.data.id,
        body: body.trim(),
        sentAt: new Date().toISOString(),
        sentByName: "You",
        status: result.data.status,
        error: result.data.error,
      },
    ]);
    setBody("");

    if (result.data.status === "SENT") {
      toast.success("Reply sent.");
      onSent?.();
    } else if (result.data.status === "SUPPRESSED") {
      toast.info("Saved, but not sent — email is switched off for this environment.");
    } else {
      toast.error("Saved, but the email did not go out.");
    }
  }

  return (
    <div className="mt-8 border-t border-verdigris-300/10 pt-6">
      <p className="text-[0.84rem] font-medium text-verdigris-200/70">Replies</p>

      {replies === null ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-verdigris-200/55">
          <Spinner className="h-3.5 w-3.5" />
          Loading the thread…
        </p>
      ) : replies.length === 0 ? (
        <p className="mt-3 text-sm text-verdigris-200/55">
          Nobody has answered this yet.
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {replies.map((reply) => (
            <li
              key={reply.id}
              className="rounded-xl border border-verdigris-300/10 bg-ink-900/40 p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-[0.82rem] font-medium text-verdigris-100">
                  {reply.sentByName}
                </span>
                <span className="text-[0.72rem] text-verdigris-200/55">
                  {fmtDateTime(reply.sentAt)}
                </span>
              </div>

              {/*
                Rendered as TEXT with its line breaks kept, never as
                markup — and `break-words`, because a pasted URL with no
                spaces would otherwise push the drawer sideways.
              */}
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-verdigris-50">
                {reply.body}
              </p>

              {/*
                What actually happened to it.

                A reply the provider refused must not look like one that
                went — that would be the same silence the mailto had,
                only now with a tick beside it.
              */}
              {reply.status === "SENT" ? (
                <p className="mt-2 text-[0.72rem] text-emerald-300/80">Sent</p>
              ) : (
                <p className="mt-2 text-[0.72rem] text-amber-300/80">
                  {reply.status === "SUPPRESSED" ? "Saved, not sent" : "Failed to send"}
                  {reply.error ? ` — ${reply.error}` : null}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5">
        <label htmlFor="enquiry-reply" className="sr-only">
          Write a reply
        </label>
        <textarea
          id="enquiry-reply"
          rows={5}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={sending}
          maxLength={5000}
          placeholder="Write your reply…"
          aria-invalid={error ? true : undefined}
          className={`w-full resize-y rounded-xl border bg-ink-900/60 px-3 py-2.5 text-sm leading-relaxed text-verdigris-50 placeholder:text-verdigris-200/35 transition-colors focus:outline-none focus:ring-2 disabled:opacity-60 ${
            error
              ? "border-rose-400/55 focus:border-rose-400/80 focus:ring-rose-400/20"
              : "border-verdigris-300/15 focus:border-patina/60 focus:ring-patina/25"
          }`}
        />
        {error ? <p className="mt-1.5 text-xs text-rose-300">{error}</p> : null}
        <p className="mt-1.5 text-[0.72rem] text-verdigris-200/45">
          Their original message is quoted underneath automatically.
        </p>
      </div>

      <button
        type="button"
        onClick={send}
        disabled={sending || body.trim().length < 2}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina disabled:cursor-not-allowed disabled:opacity-55"
      >
        {sending ? <Spinner className="h-4 w-4" /> : null}
        {sending ? "Sending…" : "Send reply"}
      </button>
    </div>
  );
}
