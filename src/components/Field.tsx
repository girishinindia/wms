import { forwardRef, type InputHTMLAttributes } from "react";

type FieldProps = {
  id: string;
  label: string;
  hint?: string;
  /** Validation message. Presence switches the field to its error state. */
  error?: string;
  /** Renders a fixed +91 prefix inside the control. */
  prefix?: string;
  wrapperClassName?: string;
} & InputHTMLAttributes<HTMLInputElement>;

const base =
  "w-full rounded-xl border bg-ink-900/60 px-4 py-3 text-[15px] text-verdigris-50 placeholder:text-verdigris-200/35 transition-colors focus:outline-none focus:ring-2";

const ok =
  "border-verdigris-300/15 hover:border-verdigris-300/25 focus:border-patina/60 focus:ring-patina/25";

const bad =
  "border-rose-400/55 hover:border-rose-400/70 focus:border-rose-400/80 focus:ring-rose-400/20";

/**
 * Presentational input. Forwards its ref so react-hook-form's
 * `register()` can attach to the DOM node directly (uncontrolled),
 * which is what keeps these forms from re-rendering on every keystroke.
 */
const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { id, label, hint, error, prefix, wrapperClassName, ...rest },
  ref
) {
  const describedBy =
    [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  const input = (
    <input
      id={id}
      ref={ref}
      {...rest}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      className={`${base} ${error ? bad : ok} ${prefix ? "rounded-l-none" : ""}`}
    />
  );

  return (
    <div className={wrapperClassName}>
      <label
        htmlFor={id}
        className="mb-2 block text-sm font-medium text-verdigris-100"
      >
        {label}
        {rest.required && (
          <span aria-hidden className="ml-1 text-verdigris-400">
            *
          </span>
        )}
      </label>

      {prefix ? (
        <div className="flex items-stretch">
          <span
            aria-hidden
            className={`inline-flex select-none items-center rounded-l-xl border border-r-0 bg-ink-800 px-3.5 font-mono text-sm text-verdigris-200/70 ${
              error ? "border-rose-400/55" : "border-verdigris-300/15"
            }`}
          >
            {prefix}
          </span>
          {input}
        </div>
      ) : (
        input
      )}

      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-2 text-xs text-rose-300">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-2 text-xs text-verdigris-200/55">
            {hint}
          </p>
        )
      )}
    </div>
  );
});

export default Field;
