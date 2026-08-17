"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";

import { Card } from "./ui";

/**
 * Adding cities, in bulk, because the table starts empty.
 *
 * The textarea is the whole point. A state has dozens of cities worth
 * having and they are almost always pasted from a list someone already
 * has — a spreadsheet column, a page of the GST portal. A form with one
 * input and a save button turns a two-minute job into forty clicks, and
 * a job that takes forty clicks gets abandoned at fifteen.
 *
 * The list itself is the registry-driven master table above this; this
 * component is only the paste box.
 */

export type StateRow = { id: number; name: string; code: string };

export default function CityBulkAdd({ states }: { states: StateRow[] }) {
  const router = useRouter();
  const toast = useToast();

  const [stateId, setStateId] = useState<number>(states[0]?.id ?? 0);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const names = useMemo(
    () =>
      text
        // One per line, or comma separated — people paste both.
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    [text],
  );

  async function add() {
    if (names.length === 0) {
      toast.error("Enter at least one city.");
      return;
    }
    setSaving(true);
    const result = await api<{ created: number; skipped: string[] }>("/admin/cities", {
      body: { stateId, names },
    });
    setSaving(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    const { created, skipped } = result.data;
    if (created === 0) {
      toast.info("Nothing added — all of those already exist in this state.");
    } else if (skipped.length > 0) {
      toast.success(
        `Added ${created}. Skipped ${skipped.length} already there: ${skipped.slice(0, 3).join(", ")}${skipped.length > 3 ? "…" : ""}`,
      );
    } else {
      toast.success(`Added ${created} ${created === 1 ? "city" : "cities"}.`);
    }
    setText("");
    router.refresh();
  }

  return (
    <div className="lg:max-w-xl">
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-verdigris-50">Add cities</h2>
        <p className="mt-1 text-xs text-verdigris-200/50">
          One per line, or comma separated. Paste a whole column if you have one.
        </p>

        <label
          htmlFor="state"
          className="mt-5 block text-[13px] font-medium text-verdigris-100"
        >
          State
        </label>
        <select
          id="state"
          value={stateId}
          onChange={(e) => setStateId(Number(e.target.value))}
          className="mt-1.5 w-full rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-4 py-3 text-[15px] text-verdigris-50 focus:outline-none focus:ring-2 focus:ring-patina/40"
        >
          {states.map((s) => (
            <option key={s.id} value={s.id} className="bg-ink-850">
              {s.name} ({s.code})
            </option>
          ))}
        </select>

        <label
          htmlFor="names"
          className="mt-4 block text-[13px] font-medium text-verdigris-100"
        >
          Cities
        </label>
        <textarea
          id="names"
          rows={9}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Mumbai\nThane\nNavi Mumbai\nPune"}
          className="mt-1.5 w-full rounded-xl border border-verdigris-300/15 bg-ink-900/60 px-4 py-3 text-[15px] text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40"
        />

        <p className="mt-2 text-xs text-verdigris-200/45" aria-live="polite">
          {names.length === 0
            ? "Nothing to add yet."
            : `${names.length} ${names.length === 1 ? "name" : "names"} ready.`}
        </p>

        <button
          type="button"
          onClick={add}
          disabled={saving || names.length === 0 || stateId === 0}
          className="group mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-verdigris-400 px-6 py-3 text-sm font-semibold text-ink-900 transition-all hover:bg-patina disabled:cursor-not-allowed disabled:opacity-55"
        >
          {saving ? <Spinner className="h-4 w-4" /> : null}
          {saving ? "Adding…" : "Add to this state"}
        </button>
      </Card>
    </div>
  );
}
