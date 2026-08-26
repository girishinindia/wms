import type { Metadata } from "next";

import ContactForm from "@/components/forms/ContactForm";
import PageShell from "@/components/PageShell";
import { CONTACT_ADDRESS, CONTACT_CHANNELS } from "@/lib/site/contact";

export const metadata: Metadata = {
  title: "Talk to us",
  description:
    "Tell us what you import and how much of it. We will map it to a warehouse and a rate card.",
};

/**
 * /contact — the form, and where to find us for anybody who did not
 * want a form.
 *
 * Deliberately no map. An embed is a third-party script, a consent
 * problem and a layout that jumps when it loads, traded for a picture
 * of a pin. The address is written out, which is the part somebody
 * actually copies.
 *
 * A server component; only the form itself ships JavaScript.
 */
export default function ContactPage() {
  return (
    <PageShell
      eyebrow="Contact"
      title="Talk to us"
      intro="Tell us what you import and how much of it. We will map it to a warehouse and a rate card."
    >
      {/*
        The form comes first in the SOURCE as well as on screen. These
        columns stack on a phone, and the thing the page exists for
        should not sit under an address the visitor has to scroll past.
      */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-12">
        <section
          aria-labelledby="send-heading"
          className="card-shadow rounded-2xl border border-verdigris-300/10 bg-ink-850 p-8 sm:p-10"
        >
          <h2 id="send-heading" className="text-xl font-semibold text-verdigris-50">
            Send us a message
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-verdigris-200/70">
            The more you can tell us about the goods and the volumes, the more
            useful our first reply will be.
          </p>
          <div className="mt-8">
            <ContactForm />
          </div>
        </section>

        <aside
          aria-labelledby="reach-heading"
          className="card-shadow h-fit rounded-2xl border border-verdigris-300/10 bg-ink-850 p-8 sm:p-10"
        >
          <h2 id="reach-heading" className="text-xl font-semibold text-verdigris-50">
            Where to find us
          </h2>

          <div className="mt-7">
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-verdigris-400">
              {CONTACT_ADDRESS.label}
            </p>
            {/*
              An `<address>` element, which is what this is — and
              `not-italic`, because the browser's default styling for it
              is italic and nothing else on the page is.
            */}
            <address className="mt-3 not-italic text-[15px] leading-relaxed text-verdigris-200/75">
              {CONTACT_ADDRESS.lines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
          </div>

          <dl className="mt-8 space-y-6">
            {CONTACT_CHANNELS.map((channel) => (
              <div key={channel.label}>
                <dt className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-verdigris-400">
                  {channel.label}
                </dt>
                <dd className="mt-2 text-[15px] text-verdigris-100">
                  {channel.href ? (
                    <a href={channel.href} className="transition-colors hover:text-patina">
                      {channel.value}
                    </a>
                  ) : (
                    channel.value
                  )}
                  {channel.note ? (
                    <span className="mt-1 block text-[13px] text-verdigris-200/55">
                      {channel.note}
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </PageShell>
  );
}
