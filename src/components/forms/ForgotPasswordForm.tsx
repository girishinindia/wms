"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import Field from "@/components/Field";
import { normalizeMobile } from "@/lib/normalize";
import { ArrowIcon } from "@/components/icons";
import { formNote, formSuccess, submitButton } from "@/components/authStyles";
import {
  forgotPasswordSchema,
  type ForgotPasswordValues,
} from "@/lib/validation/auth";

export default function ForgotPasswordForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isSubmitSuccessful },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: "onTouched",
    defaultValues: { email: "", mobile: "" },
  });

  const mobileField = register("mobile");

  const onSubmit = async (values: ForgotPasswordValues) => {
    // Phase 1: issue the two challenges. The response must be identical
    // whether or not the account exists — otherwise this endpoint turns
    // into a way to enumerate registered importers.
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.info("[forgot-password] validated payload", values);
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

      {isSubmitSuccessful && (
        <p className={formSuccess}>
          Validation passed. Reset codes are sent once authentication is
          connected.
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className={`${submitButton} mt-2`}
      >
        {isSubmitting ? "Sending codes…" : "Send reset codes"}
        {!isSubmitting && (
          <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        )}
      </button>

      <p className={formNote}>
        Front-end only — authentication is wired up in Phase 1.
      </p>
    </form>
  );
}
