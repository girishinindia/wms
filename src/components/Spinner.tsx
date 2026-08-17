/**
 * The in-button progress indicator.
 *
 * `aria-hidden` because the button's own label already changes to
 * "Signing in…" — announcing a spinner as well says the same thing
 * twice to a screen reader.
 *
 * `motion-safe:` on the spin: a permanently rotating element is a
 * migraine trigger for some people, and prefers-reduced-motion is how
 * they say so.
 */
export default function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={`${className} motion-safe:animate-spin`}
      fill="none"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
