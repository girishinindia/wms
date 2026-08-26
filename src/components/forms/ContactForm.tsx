"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import Field from "@/components/Field";
import Spinner from "@/components/Spinner";
import { ArrowIcon } from "@/components/icons";
import { useToast } from "@/components/Toast";
import { submitButton } from "@/components/authStyles";
import { api, applyFieldErrors } from "@/lib/api/client";
import { normalizeMobile } from "@/lib/normalize";
import { enquirySchema, type EnquiryValues } from "@/lib/validation/contact";

/**
 * The contact form.
 *
 * Same bones as the sign-up form — react-hook-form, the shared zod
 * schema, `Field`, `applyFieldErrors` — so a message the server sends
 * back lands on the field it is about rather than in a toast that
 * covers the form.
 *
 * `mode: "onTouched"` is the house setting: a field is not marked wrong
 * while it is still being typed for the first time, only once it has
 * been left.
 */
export default function ContactForm() {
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  /**
   * Sent, rather than a redirect.
   *
   * There is nowhere to send a stranger afterwards — they have no
   * account and no next step — so the form swaps itself for its own
   * receipt, which also stops a double submit by removing the button.
   */
  const [sent, setSent] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<EnquiryValues>({
    resolver: zodResolver(enquirySchema),
    mode: "onTouched",
    defaultValues: { name: "", email: "", mobile: "", subject: "", message: "" },
  });

  const mobileField = register("mobile");
  const message = watch("message") ?? "";

  const onSubmit = async (values: EnquiryValues) => {
    setFormError(null);
    const result = await api<{ id: number }>("/contact", { body: values });

    if (!result.ok) {
      if (applyFieldErrors(result.error.fields, setError)) {
        // The messages are already on the fields; a toast repeating
        // "check the form" would say what the form is already saying.
        toast.error("Please fix the highlighted fields.");
        return;
      }
      setFormError(result.error.message);
      toast.error(result.error.message);
      return;
    }

    setSent(true);
    toast.success("Thanks — we have your message.");
  };

  if (sent) {
    return (
      <div
        role="status"
        className="rounded-2xl border border-patina/30 bg-patina/10 p-8 text-center"
      >
        <h2 className="text-lg font-semibold text-verdigris-50">Message sent</h2>
        <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-verdigris-200/75">
          Thanks for getting in touch. Someone will read this and reply to the
          address you gave us, usually within one working day.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="contact-name"
          label="Your name"
          autoComplete="name"
          placeholder="Ravi Kumar"
          error={errors.name?.message}
          {...register("name")}
        />
        <Field
          id="contact-email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@company.com"
          error={errors.email?.message}
          {...register("email")}
        />
      </div>

      <Field
        id="contact-mobile"
        label="Mobile"
        type="tel"
        inputMode="numeric"
        autoComplete="tel"
        prefix="+91"
        placeholder="98200 11122"
        /*
         * No maxLength, deliberately — the sign-up form has none either.
         *
         * A cap here counts the characters BEFORE `normalizeMobile` sees
         * them, so pasting "+91 98200 11122" (15 characters) was
         * truncated to "+91 98200 1112" and normalised to the wrong ten
         * digits. The normaliser already caps the result at ten; letting
         * it do that is what makes a pasted number with a country code,
         * spaces or a leading zero come out right.
         */
        error={errors.mobile?.message}
        {...mobileField}
        // Normalised as typed or pasted, so "+91 98765 43210" becomes
        // the ten digits the schema and the column both expect. Same
        // handler the sign-up form uses.
        onChange={(event) => {
          event.target.value = normalizeMobile(event.target.value);
          void mobileField.onChange(event);
        }}
      />

      <Field
        id="contact-subject"
        label="Subject"
        placeholder="Storage for imported goods"
        error={errors.subject?.message}
        {...register("subject")}
      />

      {/*
        A textarea, written out rather than pushed into `Field`.

        `Field` is an <input> with a password eye bolted on; widening it
        to render either element would complicate every form in the
        product for the benefit of this one box. The classes are copied
        from it deliberately, so the two look like the same control.
      */}
      <div>
        <label
          htmlFor="contact-message"
          className="block text-sm font-medium text-verdigris-100"
        >
          Message
        </label>
        <textarea
          id="contact-message"
          rows={6}
          placeholder="Tell us what you import, roughly how much, and where it needs to go."
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={
            [errors.message ? "contact-message-error" : null, "contact-message-count"]
              .filter(Boolean)
              .join(" ")
          }
          className={`mt-2 w-full resize-y rounded-xl border bg-ink-900/60 px-4 py-3 text-[15px] leading-relaxed text-verdigris-50 placeholder:text-verdigris-200/35 transition-colors focus:outline-none focus:ring-2 ${
            errors.message
              ? "border-rose-400/55 hover:border-rose-400/70 focus:border-rose-400/80 focus:ring-rose-400/20"
              : "border-verdigris-300/15 hover:border-verdigris-300/25 focus:border-patina/60 focus:ring-patina/25"
          }`}
          {...register("message")}
        />
        <div className="mt-1.5 flex items-start justify-between gap-4">
          {errors.message ? (
            <p id="contact-message-error" className="text-xs text-rose-300">
              {errors.message.message}
            </p>
          ) : (
            <span />
          )}
          {/*
            The count only appears once it is close to mattering. A
            counter sitting at 0/2000 under an empty box reads as a
            requirement rather than a limit.
          */}
          <p
            id="contact-message-count"
            className={`shrink-0 text-xs tabular-nums ${
              message.length > 1900 ? "text-amber-300" : "text-verdigris-200/45"
            }`}
          >
            {message.length > 1500 ? `${message.length} / 2000` : ""}
          </p>
        </div>
      </div>

      {formError ? (
        <p role="alert" className="text-sm text-rose-300">
          {formError}
        </p>
      ) : null}

      <button type="submit" disabled={isSubmitting} className={submitButton}>
        {isSubmitting ? <Spinner className="h-4 w-4" /> : null}
        {isSubmitting ? "Sending…" : "Send message"}
        {isSubmitting ? null : (
          <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        )}
      </button>

      <p className="text-center text-xs text-verdigris-200/45">
        We use these details to reply to you and nothing else.
      </p>
    </form>
  );
}
