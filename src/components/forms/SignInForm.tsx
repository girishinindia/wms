"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import Field from "@/components/Field";
import { ArrowIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";
import {
  authLink,
  formNote,
  
  submitButton,
} from "@/components/authStyles";
import { visibleNav } from "@/components/admin/nav";
import { signInSchema, type SignInValues } from "@/lib/validation/auth";

/**
 * Only a path on this site, never a URL.
 *
 * `?next=` arrives in the address bar, so it is attacker-controlled.
 * Pushing it unchecked is the textbook open redirect: a link to our own
 * sign-in page, with our own domain in it, that lands the user on
 * somebody else's login form once they have proved they trust us.
 *
 * A leading `//` is the case people miss — the browser reads
 * `//evil.example` as protocol-relative and leaves the site.
 */
function safeNext(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

type Permission = { permission: string; scope: "OWN" | "WAREHOUSE" | "ALL" };

/**
 * Where to land.
 *
 * `next` wins, because the person was already going somewhere when the
 * guard interrupted them. Failing that, look at what this account can
 * actually see: an admin dropped on the marketing page has to know to
 * type /admin, which nobody does. The permission set comes back in the
 * login response itself and is fed to the same `visibleNav` the sidebar
 * uses — one answer to "does this person belong in the admin area", not
 * two that can disagree.
 *
 * Synchronous, and that is the fix for "signed in on another computer
 * and it did not go anywhere". This used to make a second request to
 * `/auth/session` for the permission list, with a six-second cutoff and
 * a fallback to the home page. On a server that was slow for reasons of
 * its own, the cutoff fired and the fallback won: a correct sign-in that
 * landed on the marketing page, which reads as "sign-in is broken". The
 * login response now carries the list, so there is nothing left to wait
 * for and nothing left to fall back from.
 */
function destination(next: string | null, permissions: Permission[]): string {
  const wanted = safeNext(next);
  if (wanted) return wanted;
  return visibleNav(permissions).length > 0 ? "/admin" : "/";
}

export default function SignInForm() {
  const toast = useToast();
  const params = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  /** True from a successful sign-in until the navigation lands. Never
   *  cleared — see the note in onSubmit. */
  const [redirecting, setRedirecting] = useState(false);

  // One-shot toasts for the states other screens redirect in with. The
  // ref stops React 18's double-invoked effects from showing each twice
  // in development.
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current) return;
    announced.current = true;
    if (params.get("registered")) {
      const code = params.get("code");
      toast.success(
        code
          ? `Account verified. Your importer code is ${code}. Sign in to continue.`
          : "Account verified. Sign in to continue.",
      );
    } else if (params.get("reset")) {
      toast.success("Password changed. Sign in with your new password.");
    }
  }, [params, toast]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    // Validate once a field has been touched, then live on every change.
    // Validating from the first keystroke shouts at people mid-typing.
    mode: "onTouched",
    defaultValues: { identifier: "", password: "" },
  });

  const onSubmit = async (values: SignInValues) => {
    setFormError(null);

    const result = await api<{
      user: { firstName: string };
      permissions: Permission[];
      expiresAt: string;
    }>(
      "/auth/login",
      {
        body: {
          identifier: values.identifier,
          password: values.password,
          platform: "WEB",
        },
      },
    );

    if (!result.ok) {
      setFormError(result.error.message);
      toast.error(result.error.message);
      return;
    }

    toast.success(`Welcome back, ${result.data.user.firstName}.`);

    /**
     * Stay in the pending state through the navigation, not just the
     * request.
     *
     * This is what made sign-in look broken. `isSubmitting` goes false
     * the moment `onSubmit` returns, so the button flipped back to an
     * enabled "Sign in" while three round trips were still in flight —
     * the login itself, which carries a deliberate 400ms anti-enumeration
     * floor; the session lookup; and then a cold, dynamic /admin. The
     * user saw a success toast, a live button, and a page that had not
     * moved, which reads as a failure and invites a second click.
     *
     * `redirecting` is never cleared. The component is about to be
     * unmounted by the navigation, and the only way out of this state is
     * arriving somewhere.
     */
    setRedirecting(true);

    /**
     * A full page load, deliberately, not `router.replace`.
     *
     * A client navigation here asks the router for the destination's
     * chunks — and if this tab was served by a previous deployment,
     * those filenames are gone. The navigation then fails silently and
     * the button sits on "Taking you in…" forever, which is exactly how
     * this was reported. The sign-in page is outside the admin layout,
     * so the recovery that handles this inside the panel never runs.
     *
     * A hard navigation cannot hit that: the browser asks the server,
     * which answers with the current build. Three other things make it
     * the right call rather than a workaround — a session cookie was
     * just set and every server component needs to re-read it; the
     * destination is `force-dynamic`, so client routing saves no round
     * trip; and the fresh document replaces this tab's stale bundle,
     * which cures the skew for the rest of the session.
     *
     * `assign`, not `replace`, keeps the browser's own history sane
     * while the guard on /sign-in stops Back landing on a filled-in
     * form.
     */
    window.location.assign(destination(params.get("next"), result.data.permissions ?? []));
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
        disabled={isSubmitting || redirecting}
        className={`${submitButton} mt-2`}
      >
        {(isSubmitting || redirecting) && <Spinner />}
        {redirecting ? "Taking you in…" : isSubmitting ? "Signing in…" : "Sign in"}
        {!isSubmitting && !redirecting && (
          <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        )}
      </button>

      <p className={formNote}>
        Sessions last 7 days of inactivity, and 30 days at most.
      </p>
    </form>
  );
}
