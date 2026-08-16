"use client";

import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import Field from "@/components/Field";
import { normalizeMobile } from "@/lib/normalize";
import { ArrowIcon } from "@/components/icons";
import {
  authLink,
  formNote,
  formSuccess,
  submitButton,
} from "@/components/authStyles";
import { signUpSchema, type SignUpValues } from "@/lib/validation/auth";

export default function SignUpForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isSubmitSuccessful },
  } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    mode: "onTouched",
    defaultValues: {
      firstName: "",
      lastName: "",
      companyName: "",
      email: "",
      mobile: "",
      password: "",
      confirmPassword: "",
      terms: undefined,
    },
  });

  const mobileField = register("mobile");

  const onSubmit = async (values: SignUpValues) => {
    // Phase 1: POST to the registration action. It MUST re-validate with
    // signUpSchema AND hardcode role = IMPORTER — never trust a
    // client-supplied role, especially with RLS off.
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.info("[sign-up] validated payload", values);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="firstName"
          label="First name"
          type="text"
          autoComplete="given-name"
          placeholder="Girish"
          maxLength={20}
          required
          error={errors.firstName?.message}
          {...register("firstName")}
        />
        <Field
          id="lastName"
          label="Last name"
          type="text"
          autoComplete="family-name"
          placeholder="Patel"
          maxLength={20}
          required
          error={errors.lastName?.message}
          {...register("lastName")}
        />
      </div>

      <Field
        id="companyName"
        label="Company name"
        type="text"
        autoComplete="organization"
        placeholder="Registered legal name"
        maxLength={60}
        required
        error={errors.companyName?.message}
        {...register("companyName")}
      />

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
        // Normalise as typed or pasted, so "+91 98765 43210" becomes
        // 9876543210 rather than a rejected 12-digit value.
        onChange={(event) => {
          event.target.value = normalizeMobile(event.target.value);
          void mobileField.onChange(event);
        }}
      />

      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        placeholder="••••••••"
        hint="At least 8 characters."
        required
        error={errors.password?.message}
        {...register("password")}
      />

      <Field
        id="confirmPassword"
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        placeholder="••••••••"
        required
        error={errors.confirmPassword?.message}
        {...register("confirmPassword")}
      />

      <div className="pt-1">
        <label
          htmlFor="terms"
          className="flex cursor-pointer items-start gap-3"
        >
          <input
            id="terms"
            type="checkbox"
            aria-invalid={errors.terms ? true : undefined}
            aria-describedby={errors.terms ? "terms-error" : undefined}
            className={`mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded bg-ink-900 accent-verdigris-400 focus:outline-none focus:ring-2 focus:ring-patina/30 ${
              errors.terms ? "border-rose-400/60" : "border-verdigris-300/30"
            }`}
            {...register("terms")}
          />
          <span className="text-sm leading-relaxed text-verdigris-200/70">
            I accept the{" "}
            <Link href="/terms" className={authLink}>
              terms and conditions
            </Link>{" "}
            and the{" "}
            <Link href="/privacy" className={authLink}>
              privacy policy
            </Link>
            .
          </span>
        </label>
        {errors.terms && (
          <p id="terms-error" role="alert" className="mt-2 text-xs text-rose-300">
            {errors.terms.message}
          </p>
        )}
      </div>

      {isSubmitSuccessful && (
        <p className={formSuccess}>
          Validation passed. Your account is created once registration is
          connected.
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className={`${submitButton} mt-2`}
      >
        {isSubmitting ? "Creating account…" : "Create account"}
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
