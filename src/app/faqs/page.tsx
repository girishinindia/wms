import type { Metadata } from "next";
import PageShell from "@/components/PageShell";

export const metadata: Metadata = {
  title: "Questions, answered",
  description: "Storage terms, billing, dispatch approval, delivery timelines and how onboarding works.",
};

export default function Page() {
  return (
    <PageShell
      eyebrow="FAQs"
      title="Questions, answered"
      intro="Storage terms, billing, dispatch approval, delivery timelines and how onboarding works."
    />
  );
}
