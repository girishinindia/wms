import MasterPage from "@/components/admin/MasterPage";

export const dynamic = "force-dynamic";

/** Everything about this screen is data in `master-registry.ts`. */
export default function Page() {
  return <MasterPage slug="countries" />;
}
