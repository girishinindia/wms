import type { Metadata } from "next";
import PageShell from "@/components/PageShell";

export const metadata: Metadata = {
  title: "Who we are",
  description: "The team, the warehouses, and why importers trust us with stock they have not yet sold.",
};

export default function Page() {
  return (
    <PageShell
      eyebrow="About"
      title="Who we are"
      intro="The team, the warehouses, and why importers trust us with stock they have not yet sold."
    />
  );
}
