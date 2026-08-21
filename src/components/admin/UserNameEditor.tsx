"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { PencilIcon } from "@/components/icons";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";

import { IconButton } from "./ui";

/**
 * A super admin fixing somebody's name — a typo in "Chudhary" should not
 * need the owner to do anything. Only the NAME: email, mobile and
 * password change exclusively through the owner's own verified flows.
 */
export default function UserNameEditor({
  userId,
  firstName,
  lastName,
}: {
  userId: number;
  firstName: string;
  lastName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState(firstName);
  const [last, setLast] = useState(lastName);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setErrors({});
    const result = await api<{ ok: true }>(`/admin/users/${userId}/profile`, {
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
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <IconButton label="Edit name" onClick={() => setOpen(true)} icon={<PencilIcon className="h-4 w-4" />} />
    );
  }

  const input =
    "w-36 rounded-lg border bg-ink-900/60 px-3 py-1.5 text-sm text-verdigris-50 focus:outline-none focus:ring-2 focus:ring-patina/40";
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void save(); }}
      className="flex flex-wrap items-center gap-2"
    >
      <input aria-label="First name" value={first} onChange={(e) => setFirst(e.target.value)}
        className={`${input} ${errors.firstName ? "border-rose-400/50" : "border-verdigris-300/15"}`} />
      <input aria-label="Last name" value={last} onChange={(e) => setLast(e.target.value)}
        className={`${input} ${errors.lastName ? "border-rose-400/50" : "border-verdigris-300/15"}`} />
      <button type="submit" disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-verdigris-400 px-3 py-1.5 text-sm font-semibold text-ink-900 hover:bg-patina disabled:opacity-50">
        {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
        Save
      </button>
      <button type="button" onClick={() => setOpen(false)}
        className="rounded-lg border border-verdigris-300/20 px-3 py-1.5 text-sm text-verdigris-100 hover:border-verdigris-300/45">
        Cancel
      </button>
    </form>
  );
}
