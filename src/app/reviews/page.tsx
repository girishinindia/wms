import type { Metadata } from "next";
import PageShell from "@/components/PageShell";

export const metadata: Metadata = {
  title: "What importers say",
  description: "Feedback from the brands whose stock we store, pick, pack and dispatch every day.",
};

export default function Page() {
  return (
    <PageShell
      eyebrow="Reviews"
      title="What importers say"
      intro="Feedback from the brands whose stock we store, pick, pack and dispatch every day."
    />
  );
}
