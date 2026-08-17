"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import Spinner from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/api/client";

import { Card, Cell, Empty, Row, StatusBadge, Table } from "./ui";

/**
 * Adding cities, in bulk, because the table starts empty.
 *
 * The textarea is the whole point. A state has dozens of cities worth
 * having and they are almost always pasted from a list someone already
 * has — a spreadsheet column, a page of the GST portal. A form with one
 * input and a save button turns a two-minute job into forty clicks, and
 * a job that takes forty clicks gets abandoned at fifteen.
 */

export type StateRow = { id: number; name: string; code: string };
export type CityRow = {
  id: number;
  name: string;
  isActive: boolean;
  stateId: number;
  stateName: string;
};

export default function CityManager({
  states,
  cities,
  canCreate,
  canUpdate,
}: {
  states: StateRow[];
  cities: CityRow[];
  canCreate: boolean;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [stateId, setStateId] = useState<number>(states[0]?.id ?? 0);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [filter, setFilter] = useState("");

  const names = useMemo(
    () =>
      text
        // One per line, or comma separated — people paste both.
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    [text],
  );

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return cities;
    return cities.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) || c.stateName.toLowerCase().includes(needle),
    );
  }, [cities, filter]);

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

  async function toggle(city: CityRow) {
    setBusyId(city.id);
    const result = await api<{ ok: true }>(`/admin/cities/${city.id}`, {
      method: "PATCH",
      body: { isActive: !city.isActive },
    });
    setBusyId(null);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success(city.isActive ? `${city.name} retired.` : `${city.name} back in use.`);
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
      {canCreate ? (
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
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-verdigris-300/10 px-5 py-4">
          <h2 className="text-sm font-semibold text-verdigris-50">
            {cities.length} {cities.length === 1 ? "city" : "cities"}
          </h2>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter"
            aria-label="Filter cities"
            className="w-44 rounded-lg border border-verdigris-300/15 bg-ink-900/60 px-3 py-1.5 text-sm text-verdigris-50 placeholder:text-verdigris-200/30 focus:outline-none focus:ring-2 focus:ring-patina/40"
          />
        </div>

        {shown.length === 0 ? (
          <Empty
            title={cities.length === 0 ? "No cities yet." : "Nothing matches that filter."}
            hint={
              cities.length === 0
                ? "Importer approval and warehouse creation both need a city, so this is the first master table to fill in."
                : undefined
            }
          />
        ) : (
          <Table head={["City", "State", "Status", ""]}>
            {shown.map((city) => (
              <Row key={city.id}>
                <Cell className="font-medium">{city.name}</Cell>
                <Cell className="text-verdigris-200/60">{city.stateName}</Cell>
                <Cell>
                  <StatusBadge value={city.isActive ? "ACTIVE" : "CLOSED"} />
                </Cell>
                <Cell className="text-right">
                  {canUpdate ? (
                    <button
                      type="button"
                      onClick={() => toggle(city)}
                      disabled={busyId === city.id}
                      className="inline-flex items-center gap-2 rounded-lg border border-verdigris-300/15 px-3 py-1.5 text-xs text-verdigris-200/80 transition-colors hover:border-verdigris-300/35 hover:text-verdigris-100 disabled:opacity-55"
                    >
                      {busyId === city.id ? <Spinner className="h-3 w-3" /> : null}
                      {city.isActive ? "Retire" : "Restore"}
                    </button>
                  ) : null}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
