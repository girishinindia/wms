import type { Metadata } from "next";
import PageShell from "@/components/PageShell";

export const metadata: Metadata = {
  title: "Talk to us",
  description: "Tell us what you import and how much of it. We will map it to a warehouse and a rate card.",
};

export default function Page() {
  return (
    <PageShell
      eyebrow="Contact"
      title="Talk to us"
      intro="Tell us what you import and how much of it. We will map it to a warehouse and a rate card."
    />
  );
}
