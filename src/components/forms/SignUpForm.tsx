"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import Field from "@/components/Field";
import { normalizeMobile } from "@/lib/normalize";
import { ArrowIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api, applyFieldErrors } from "@/lib/api/client";
import {
  authLink,
  formNote,
  submitButton,
} from "@/components/authStyles";
import { signUpSchema, type SignUpValues } from "@/lib/validation/auth";

type RegisterResponse = {
  userId: number;
  channels: Array<"EMAIL" | "SMS">;
  expiresInSeconds: number;
  resendAfterSeconds: number;
};

export default function SignUpForm() {
  const router = useRouter();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
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
    setFormError(null);

    // `confirmPassword` and `terms` are browser concerns — the API does
    // not model them, and a native client never collects them. The
    // server re-validates everything it does model.
    const result = await api<RegisterResponse>("/auth/register", {
      body: {
        firstName: values.firstName,
        lastName: values.lastName,
        companyName: values.companyName,
        email: values.email,
        mobile: values.mobile,
        password: values.password,
      },
    });

    if (!result.ok) {
      if (applyFieldErrors(result.error.fields, setError)) {
        // The messages are already sitting on the fields; a toast on top
        // would say "check the form" while the form is already saying it.
        toast.error("Please fix the highlighted fields.");
        return;
      }
      setFormError(result.error.message);
      toast.error(result.error.message);
      return;
    }

    toast.success("Account created. We have sent a code to your email and your mobile.");

    // Straight to the codes. The identifier travels in the URL so a
    // reload does not lose it; nothing secret is in there, and the
    // endpoint answers the same for an address that does not exist.
    const query = new URLSearchParams({
      purpose: "registration",
      identifier: values.email,
      mobile: values.mobile,
    });
    router.push(`/verify?${query.toString()}`);
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
        {isSubmitting ? "Creating account…" : "Create account"}
        {!isSubmitting && (
          <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        )}
      </button>

      <p className={formNote}>
        We send one code to your email and a different code to your mobile.
        Both are needed.
      </p>
    </form>
  );
}
