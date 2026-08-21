"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { XIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";

import PhotoCropper from "./PhotoCropper";

/**
 * What an operator may correct about somebody else: their name, and
 * their picture.
 *
 * Not their email, mobile or password — those change only through the
 * owner's own verified flows, and the drawer says so rather than
 * leaving the absence to be discovered. A photo is not a credential;
 * nobody signs in with it, and an operator taking down an unsuitable one
 * is a normal thing to need.
 *
 * The photo saves on its own, the moment it is framed — it is its own
 * transaction against its own endpoint, and holding it hostage to a
 * "Save changes" that only really carries a name would be pretending
 * they are one operation.
 */
export default function UserEditDrawer({
  userId,
  name,
  email,
  photoUrl,
  trigger,
}: {
  userId: number;
  name: string;
  email: string;
  photoUrl: string | null;
  trigger: (open: () => void) => ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const split = name.trim().split(/\s+/);
  const initialFirst = split[0] ?? "";
  const initialLast = split.slice(1).join(" ");
  const [firstName, setFirstName] = useState(initialFirst);
  const [lastName, setLastName] = useState(initialLast);

  function close() {
    setFirstName(initialFirst);
    setLastName(initialLast);
    setErrors({});
    setOpen(false);
  }

  async function save() {
    const body: Record<string, string> = {};
    if (firstName.trim() !== initialFirst) body.firstName = firstName.trim();
    if (lastName.trim() !== initialLast) body.lastName = lastName.trim();
    if (Object.keys(body).length === 0) {
      toast.error("Nothing has changed yet.");
      return;
    }
    setBusy(true);
    setErrors({});
    const result = await api(`/admin/users/${userId}/profile`, { method: "PATCH", body });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      toast.error(result.error.message);
      return;
    }
    toast.success("Name updated.");
    setOpen(false);
    router.refresh();
  }

  const input =
    "mt-1.5 w-full min-w-0 rounded-lg border bg-ink-900/60 px-3 py-2 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40";
  const label = "block text-xs font-medium leading-5 text-verdigris-200/80";
  const tone = (k: string) => (errors[k] ? "border-rose-400/50" : "border-verdigris-300/15");

  return (
    <>
      {trigger(() => setOpen(true))}

      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 flex justify-end text-left">
              <button type="button" aria-label="Close" onClick={close} className="flex-1 bg-ink-900/70" />
              <aside
                role="dialog"
                aria-modal="true"
                aria-label="Edit user"
                className="@container flex h-full w-full min-w-0 max-w-[min(32rem,100vw)] flex-col border-l border-verdigris-300/10 bg-ink-850 shadow-2xl"
              >
                <header className="flex items-center justify-between border-b border-verdigris-300/10 px-6 py-4">
                  <div>
                    <h2 className="text-base font-semibold text-verdigris-50">Edit {name}</h2>
                    <p className="mt-0.5 text-xs text-verdigris-200/55">{email}</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={close}
                    className="inline-grid h-8 w-8 place-items-center rounded-lg border border-verdigris-300/15 text-verdigris-200/75 hover:border-verdigris-300/40 hover:text-verdigris-50"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                </header>

                <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Photo</p>
                    <div className="mt-3">
                      <PhotoCropper
                        name={name}
                        photoUrl={photoUrl}
                        endpoint={`/admin/users/${userId}/photo`}
                        size={88}
                        onChanged={() => router.refresh()}
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-verdigris-300">Name</p>
                    <form
                      id="user-edit-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void save();
                      }}
                      className="mt-3 grid gap-x-5 gap-y-4 @sm:grid-cols-2"
                    >
                      <label className={label}>
                        First name
                        <input
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          className={`${input} ${tone("firstName")}`}
                        />
                        {errors.firstName ? (
                          <span className="mt-1 block text-xs text-rose-300">{errors.firstName}</span>
                        ) : null}
                      </label>
                      <label className={label}>
                        Last name
                        <input
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          className={`${input} ${tone("lastName")}`}
                        />
                        {errors.lastName ? (
                          <span className="mt-1 block text-xs text-rose-300">{errors.lastName}</span>
                        ) : null}
                      </label>
                    </form>
                  </div>

                  <p className="rounded-lg border border-verdigris-300/15 bg-verdigris-500/[0.06] px-3 py-2 text-xs text-verdigris-200/70">
                    Sign-in email, mobile and password are not editable here. They change only from the
                    owner&rsquo;s own profile — the new address has to prove itself with a code first.
                  </p>
                </div>

                <footer className="flex items-center justify-end gap-2 border-t border-verdigris-300/10 px-6 py-4">
                  <button
                    type="button"
                    onClick={close}
                    disabled={busy}
                    className="rounded-lg border border-verdigris-300/20 px-4 py-2 text-sm text-verdigris-100 hover:border-verdigris-300/45"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    form="user-edit-form"
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-lg bg-verdigris-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-patina disabled:opacity-60"
                  >
                    {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
                    Save name
                  </button>
                </footer>
              </aside>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
