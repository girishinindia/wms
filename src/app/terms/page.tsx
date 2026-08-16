import type { Metadata } from "next";
import PageShell from "@/components/PageShell";

export const metadata: Metadata = {
  title: "Terms and conditions",
  description: "The terms governing storage, handling, dispatch and billing of goods held at our warehouses.",
};

export default function Page() {
  return (
    <PageShell
      eyebrow="Legal"
      title="Terms and conditions"
      intro="The terms governing storage, handling, dispatch and billing of goods held at our warehouses."
    />
  );
}
