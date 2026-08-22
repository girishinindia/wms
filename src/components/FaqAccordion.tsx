import type { PublicFaq } from "@/lib/faq/public";

/**
 * One category's questions, as a list of native disclosures.
 *
 * `<details>` rather than a client component with state: it opens and
 * closes with no JavaScript, a crawler reads the answer whether or not
 * it is open, and Ctrl+F finds text inside a closed one in most
 * browsers. There is nothing here a `useState` would buy.
 */
export default function FaqAccordion({ faqs }: { faqs: PublicFaq[] }) {
  return (
    <div className="divide-y divide-verdigris-300/10 overflow-hidden rounded-2xl border border-verdigris-300/10 bg-ink-850">
      {faqs.map((faq) => (
        <details key={faq.id} className="group">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-6 px-6 py-5 text-[15px] font-medium text-verdigris-50 transition-colors hover:bg-ink-800/60 [&::-webkit-details-marker]:hidden">
            {faq.question}
            <span
              aria-hidden
              className="mt-0.5 shrink-0 text-verdigris-300 transition-transform duration-200 group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <div className="px-6 pb-6 pt-0">
            {/**
             * Split on blank lines and render each run as its own
             * paragraph. The text is interpolated, never
             * `dangerouslySetInnerHTML` — the answer is written by a
             * person we trust into a field that lasts forever, and a
             * field that renders markup on a public page is a stored
             * XSS hole waiting for the day somebody pastes something in
             * from elsewhere.
             */}
            {faq.answer
              .split(/\n\s*\n/)
              .map((para) => para.trim())
              .filter(Boolean)
              .map((para, i) => (
                <p
                  key={i}
                  className="whitespace-pre-line text-[15px] leading-relaxed text-verdigris-200/75 [&:not(:first-child)]:mt-4"
                >
                  {para}
                </p>
              ))}
          </div>
        </details>
      ))}
    </div>
  );
}
