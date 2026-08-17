"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import Field from "@/components/Field";
import { normalizeMobile } from "@/lib/normalize";
import { ArrowIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";
import { formNote, submitButton } from "@/components/authStyles";
import {
  forgotPasswordSchema,
  type ForgotPasswordValues,
} from "@/lib/validation/auth";

export default function ForgotPasswordForm() {
  const router = useRouter();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: "onTouched",
    defaultValues: { email: "", mobile: "" },
  });

  const mobileField = register("mobile");

  const onSubmit = async (values: ForgotPasswordValues) => {
    setFormError(null);

    // The email and the mobile must belong to the SAME account. The
    // server answers `ok: true` either way and in the same time, so this
    // screen cannot be used to discover who is registered — which is why
    // it moves on to the code step regardless.
    const result = await api<{ ok: true }>("/auth/password/forgot", {
      body: { email: values.email, mobile: values.mobile },
    });

    if (!result.ok) {
      setFormError(result.error.message);
      toast.error(result.error.message);
      return;
    }

    // Deliberately does not say "we found your account" — the endpoint
    // answers the same either way, and so must this.
    toast.success("If those details match an account, both codes are on their way.");

    const query = new URLSearchParams({
      purpose: "passwordRecovery",
      identifier: values.email,
      mobile: values.mobile,
    });
    router.push(`/verify?${query.toString()}`);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <Field
        id="email"
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@company.com"
        required
        error={errors.email?.message}
        {...register("email")}
      />

      <Field
        id="mobile"
        label="Mobile"
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        prefix="+91"
        placeholder="9876543210"
        required
        error={errors.mobile?.message}
        {...mobileField}
        onChange={(event) => {
          event.target.value = normalizeMobile(event.target.value);
          void mobileField.onChange(event);
        }}
      />

      {formError && (
        <p
          role="alert"
          className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className={`${submitButton} mt-2`}
      >
        {isSubmitting && <Spinner />}
        {isSubmitting ? "Sending codes…" : "Send reset codes"}
        {!isSubmitting && (
          <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        )}
      </button>

      <p className={formNote}>
        Both must match the same account. We send a code to each.
      </p>
    </form>
  );
}
