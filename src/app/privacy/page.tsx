import type { Metadata } from "next";
import PageShell from "@/components/PageShell";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What personal and business data we collect, why we hold it, how long we keep it, and who processes it.",
};

export default function Page() {
  return (
    <PageShell
      eyebrow="Legal"
      title="Privacy policy"
      intro="What personal and business data we collect, why we hold it, how long we keep it, and who processes it."
    />
  );
}
