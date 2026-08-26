"use client";

import { XIcon } from "@/components/icons";

import { FactList, IconButton } from "./ui";
import type { EnquiryRow } from "./EnquiriesTable";

/**
 * One enquiry, read in full.
 *
 * The list truncates the message to two lines because a table of
 * paragraphs is unreadable; this is where the paragraphs go. Everything
 * shown here is already on the row the list was given, so opening it
 * costs no request — unlike the audit drawer, which fetches, because
 * there the payloads are large and most are never opened.
 */
export default function EnquiryDetail({
  row,
  onClose,
}: {
  row: EnquiryRow;
  onClose: () => void;
}) {
  const received = new Date(row.createdAt).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="flex-1 bg-ink-900/70" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={row.subject}
        className="flex h-full w-full max-w-md flex-col border-l border-verdigris-300/10 bg-ink-850 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-verdigris-300/10 px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-verdigris-50">{row.subject}</h2>
            <p className="mt-0.5 text-[0.78rem] text-verdigris-200/60">{received}</p>
          </div>
          <IconButton label="Close" onClick={onClose} icon={<XIcon className="h-4 w-4" />} />
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <FactList
            items={[
              { label: "Name", value: row.name },
              {
                label: "Email",
                value: (
                  <a href={`mailto:${row.email}`} className="font-mono text-verdigris-100 hover:text-patina">
                    {row.email}
                  </a>
                ),
              },
              {
                label: "Mobile",
                value: (
                  <a href={`tel:+91${row.mobile}`} className="font-mono text-verdigris-100 hover:text-patina">
                    +91 {row.mobile}
                  </a>
                ),
              },
            ]}
          />

          <div className="mt-6">
            <p className="text-[0.84rem] font-medium text-verdigris-200/70">Message</p>
            {/*
              `whitespace-pre-wrap` so the paragraphs somebody typed stay
              paragraphs, and `break-words` because a pasted URL with no
              spaces in it would otherwise push the drawer sideways.
              Rendered as TEXT, never as markup — this is the one field
              in the product a stranger controls.
            */}
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-verdigris-50">
              {row.message}
            </p>
          </div>
        </div>

        <footer className="border-t border-verdigris-300/10 px-6 py-4">
          <a
            href={`mailto:${row.email}?subject=${encodeURIComponent(`Re: ${row.subject}`)}`}
            className="inline-flex w-full items-center justify-center rounded-xl bg-verdigris-400 px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-patina"
          >
            Reply by email
          </a>
        </footer>
      </aside>
    </div>
  );
}
