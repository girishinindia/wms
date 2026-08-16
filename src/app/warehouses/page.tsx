import type { Metadata } from "next";
import PageShell from "@/components/PageShell";

export const metadata: Metadata = {
  title: "Where your stock lives",
  description: "Locations, capacity, storage systems and handling capability across our facilities.",
};

export default function Page() {
  return (
    <PageShell
      eyebrow="Warehouses"
      title="Where your stock lives"
      intro="Locations, capacity, storage systems and handling capability across our facilities."
    />
  );
}
