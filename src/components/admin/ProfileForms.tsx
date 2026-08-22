"use client";

import { useState } from "react";

import { EyeIcon, EyeOffIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";

/**
 * The three self-service flows on /admin/profile: name, password, and
 * the verified email / mobile changes. Password and contact changes end
 * with every session revoked, so each finishes by sending the browser
 * back to sign-in — that is the design, not a bug: the credential that
 * just changed must be re-proved.
 */

const input =
  "mt-1 w-full rounded-lg border bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40";
const label = "block text-xs font-medium text-verdigris-200/80";
const button =
  "inline-flex items-center gap-2 rounded-lg bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-patina disabled:opacity-50";
const tone = (err?: string) => (err ? "border-rose-400/50" : "border-verdigris-300/15");
const Err = ({ msg }: { msg?: string }) =>
  msg ? <span className="mt-1 block text-xs text-rose-300">{msg}</span> : null;

/**
 * A password box with an eye, matching the one on the sign-in page.
 *
 * These three boxes are hand-rolled rather than built on
 * `components/Field`, which is where the public forms get theirs — so
 * the reveal is repeated here rather than shared. Worth it: the
 * alternative is reworking the whole profile screen onto a different
 * input component to add one button.
 */
function PasswordBox({
  value,
  onChange,
  autoComplete,
  error,
  label: text,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  error?: string;
  label: string;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <label className={label}>
      {text}
      <span className="relative mt-1 block">
        <input
          type={revealed ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className={`${input} mt-0 pr-11 ${tone(error)}`}
        />
        {/* type="button": this sits in a form, and the default would
            submit the password change. */}
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          aria-label={revealed ? `Hide ${text.toLowerCase()}` : `Show ${text.toLowerCase()}`}
          aria-pressed={revealed}
          title={revealed ? "Hide" : "Show"}
          className="absolute inset-y-px right-px grid w-10 place-items-center rounded-r-lg text-verdigris-200/55 transition-colors hover:text-verdigris-50 focus:outline-none focus-visible:text-verdigris-50 focus-visible:ring-2 focus-visible:ring-patina/40"
        >
          {revealed ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
        </button>
      </span>
      <Err msg={error} />
    </label>
  );
}

export function NameForm({ firstName, lastName }: { firstName: string; lastName: string }) {
  const toast = useToast();
  const [first, setFirst] = useState(firstName);
  const [last, setLast] = useState(lastName);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setErrors({});
    const result = await api<{ ok: true }>("/profile", {
      method: "PATCH",
      body: { firstName: first.trim(), lastName: last.trim() },
    });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      toast.error(result.error.message);
      return;
    }
    toast.success("Name updated.");
    window.location.reload();
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="grid gap-4 sm:grid-cols-2">
      <label className={label}>
        First name
        <input value={first} onChange={(e) => setFirst(e.target.value)} className={`${input} ${tone(errors.firstName)}`} />
        <Err msg={errors.firstName} />
      </label>
      <label className={label}>
        Last name
        <input value={last} onChange={(e) => setLast(e.target.value)} className={`${input} ${tone(errors.lastName)}`} />
        <Err msg={errors.lastName} />
      </label>
      <div className="sm:col-span-2">
        <button type="submit" disabled={busy || (first === firstName && last === lastName)} className={button}>
          {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
          Save name
        </button>
      </div>
    </form>
  );
}

export function PasswordForm({ forced = false }: { forced?: boolean }) {
  const toast = useToast();
  const [old, setOld] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setErrors({});
    const result = await api<{ ok: true }>("/profile/password", {
      body: { ...(forced ? {} : { oldPassword: old }), newPassword: next, confirmPassword: confirm },
    });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      toast.error(result.error.message);
      return;
    }
    toast.success("Password changed. Sign in again with the new one.");
    window.setTimeout(() => window.location.assign("/sign-in?reason=password-changed"), 900);
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="grid max-w-md gap-4">
      {!forced ? (
        <PasswordBox
          label="Current password"
          value={old}
          onChange={setOld}
          autoComplete="current-password"
          error={errors.oldPassword}
        />
      ) : null}
      <PasswordBox
        label="New password"
        value={next}
        onChange={setNext}
        autoComplete="new-password"
        error={errors.newPassword}
      />
      <PasswordBox
        label="Confirm new password"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        error={errors.confirmPassword}
      />
      <p className="text-xs text-verdigris-200/55">
        After the change you are signed out everywhere and sign in with the new password.
      </p>
      <div>
        <button type="submit" disabled={busy || !next || !confirm || (!forced && !old)} className={button}>
          {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
          {forced ? "Set my password" : "Change password"}
        </button>
      </div>
    </form>
  );
}

export function ContactChangeForm({ kind, current }: { kind: "email" | "mobile"; current: string }) {
  const toast = useToast();
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"edit" | "verify">("edit");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const field = kind === "email" ? "newEmail" : "newMobile";
  const noun = kind === "email" ? "email address" : "mobile number";

  async function start() {
    setBusy(true);
    setErrors({});
    const result = await api<{ sent: true }>(`/profile/${kind}`, { body: { [field]: value.trim() } });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      toast.error(result.error.message);
      return;
    }
    setStage("verify");
    toast.success(`Code sent to the new ${noun}.`);
  }

  async function verify() {
    setBusy(true);
    setErrors({});
    const result = await api<{ ok: true }>(`/profile/${kind}/verify`, { body: { code: code.trim() } });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      toast.error(result.error.message);
      return;
    }
    toast.success(`Your ${noun} is updated. Sign in again.`);
    window.setTimeout(() => window.location.assign("/sign-in?reason=contact-changed"), 900);
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void (stage === "edit" ? start() : verify()); }}
      className="grid max-w-md gap-4"
    >
      <label className={label}>
        Current {noun}
        <input value={current} disabled className={`${input} border-verdigris-300/15 opacity-70`} />
      </label>
      {stage === "edit" ? (
        <>
          <label className={label}>
            New {noun}
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode={kind === "mobile" ? "numeric" : undefined}
              className={`${input} ${tone(errors[field])}`}
            />
            <Err msg={errors[field]} />
          </label>
          <p className="text-xs text-verdigris-200/55">
            A one-time code goes to the new {noun}; nothing changes until it is entered. After the
            change you are signed out everywhere.
          </p>
          <div>
            <button type="submit" disabled={busy || !value.trim()} className={button}>
              {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
              Send code
            </button>
          </div>
        </>
      ) : (
        <>
          <label className={label}>
            Code sent to {value}
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              className={`${input} ${tone(errors.code)} font-mono tracking-[0.3em]`}
            />
            <Err msg={errors.code} />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !code.trim()} className={button}>
              {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
              Verify and update
            </button>
            <button
              type="button"
              onClick={() => { setStage("edit"); setCode(""); }}
              className="rounded-lg border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45"
            >
              Back
            </button>
          </div>
        </>
      )}
    </form>
  );
}

/** Full-screen "set your password" gate for must_change_password. */
export function ForceChangePassword({ name }: { name: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-ink-900 px-6 py-16">
      <div className="w-full max-w-md rounded-2xl border border-verdigris-300/10 bg-ink-850 p-8 card-shadow">
        <h1 className="text-lg font-semibold text-verdigris-50">Set your password</h1>
        <p className="mt-2 text-sm text-verdigris-200/70">
          Welcome{name ? `, ${name}` : ""}. You signed in with a temporary password — choose your
          own before using the portal.
        </p>
        <div className="mt-6">
          <PasswordForm forced />
        </div>
      </div>
    </div>
  );
}
