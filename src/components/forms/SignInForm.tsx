"use client";

import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import Field from "@/components/Field";
import { ArrowIcon } from "@/components/icons";
import {
  authLink,
  formNote,
  formSuccess,
  submitButton,
} from "@/components/authStyles";
import { signInSchema, type SignInValues } from "@/lib/validation/auth";

export default function SignInForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isSubmitSuccessful },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    // Validate once a field has been touched, then live on every change.
    // Validating from the first keystroke shouts at people mid-typing.
    mode: "onTouched",
    defaultValues: { identifier: "", password: "" },
  });

  const onSubmit = async (values: SignInValues) => {
    // Phase 1: replace with the Better Auth server action. It MUST
    // re-validate with signInSchema — client validation is bypassable.
    await new Promise((resolve) => setTimeout(resolve, 400));
    console.info("[sign-in] validated payload", values);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <Field
        id="identifier"
        label="Email or mobile"
        type="text"
        inputMode="email"
        autoComplete="username"
        placeholder="you@company.com or 9876543210"
        required
        error={errors.identifier?.message}
        {...register("identifier")}
      />

      <div>
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
          error={errors.password?.message}
          {...register("password")}
        />
        <div className="mt-2.5 text-right">
          <Link href="/forgot-password" className={`text-sm ${authLink}`}>
            Forgot password?
          </Link>
        </div>
      </div>

      {isSubmitSuccessful && (
        <p className={formSuccess}>
          Validation passed. Credentials are checked once authentication is
          connected.
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className={`${submitButton} mt-2`}
      >
        {isSubmitting ? "Signing in…" : "Sign in"}
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
