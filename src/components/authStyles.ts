/**
 * Shared class strings for the auth screens.
 *
 * Kept in their own module (not in AuthShell) so the client-side form
 * components can import them without dragging the whole server-rendered
 * shell into the browser bundle.
 */

export const submitButton =
  "group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-verdigris-400 px-6 py-3.5 text-sm font-semibold text-ink-900 transition-all hover:bg-patina disabled:cursor-not-allowed disabled:opacity-55";

export const authLink =
  "font-medium text-verdigris-300 transition-colors hover:text-patina";

export const formNote = "mt-4 text-center text-xs text-verdigris-200/45";

export const formSuccess =
  "rounded-xl border border-patina/30 bg-patina/10 p-4 text-center text-[13px] leading-relaxed text-verdigris-100";
