import { FormSkeleton } from "@/components/admin/Skeleton";

/** One scan box and a progress panel. */
export default function Loading() {
  return <FormSkeleton fields={3} />;
}
