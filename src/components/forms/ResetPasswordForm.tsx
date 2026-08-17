"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import Field from "@/components/Field";
import { ArrowIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api, applyFieldErrors } from "@/lib/api/client";
import { formNote, submitButton } from "@/components/authStyles";

const schema = z
  .object({
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type Values = z.infer<typeof schema>;

function Inner() {
  const router = useRouter();
  const toast = useToast();
  const token = useSearchParams().get("token") ?? "";
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const onSubmit = async (values: Values) => {
    setFormError(null);
    // confirmPassword goes to the server too. The browser check is a
    // convenience; a client that never renders the second field would
    // otherwise skip it entirely.
    const result = await api<{ sessionsRevoked: number }>("/auth/password/reset", {
      body: {
        resetToken: token,
        newPassword: values.newPassword,
        confirmPassword: values.confirmPassword,
      },
    });

    if (!result.ok) {
      if (applyFieldErrors(result.error.fields, setError)) {
        toast.error("Please fix the highlighted fields.");
        return;
      }
      setFormError(result.error.message);
      toast.error(result.error.message);
      return;
    }

    toast.success(
      result.data.sessionsRevoked > 0
        ? `Password changed. ${result.data.sessionsRevoked} other session${result.data.sessionsRevoked === 1 ? "" : "s"} signed out.`
        : "Password changed. Sign in with your new password.",
    );
    router.push("/sign-in?reset=1");
  };

  if (!token) {
    return (
      <p
        role="alert"
        className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
      >
        This page needs a reset link from the verification step. Start again
        from &ldquo;Forgot password&rdquo;.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <Field
        id="newPassword"
        label="New password"
        type="password"
        autoComplete="new-password"
        placeholder="••••••••"
        hint="At least 8 characters."
        required
        error={errors.newPassword?.message}
        {...register("newPassword")}
      />
      <Field
        id="confirmPassword"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        placeholder="••••••••"
        required
        error={errors.confirmPassword?.message}
        {...register("confirmPassword")}
      />

      {formError && (
        <p
          role="alert"
          className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          {formError}
        </p>
      )}

      <button type="submit" disabled={isSubmitting} className={`${submitButton} mt-2`}>
        {isSubmitting && <Spinner />}
        {isSubmitting ? "Saving…" : "Set new password"}
        {!isSubmitting && (
          <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        )}
      </button>

      <p className={formNote}>
        Every other session is signed out — including anyone who already had
        your old password.
      </p>
    </form>
  );
}

export default function ResetPasswordForm() {
  return (
    <Suspense fallback={<div className="h-56" aria-hidden />}>
      <Inner />
    </Suspense>
  );
}
