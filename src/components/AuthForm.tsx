"use client";

/**
 * Thin client wrapper so the form is real markup — labels, autofill and
 * browser validation all work — without a live submit target.
 *
 * A plain <form> with no action would GET back to the same URL and put
 * the password in the query string and browser history. This blocks that
 * until the server action is wired in Phase 1: replace the onSubmit with
 * `action={signInAction}` and delete this component.
 */
export default function AuthForm({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <form
      noValidate={false}
      onSubmit={(e) => e.preventDefault()}
      className={className}
    >
      {children}
    </form>
  );
}
