import { FormSkeleton } from "@/components/admin/Skeleton";

/** The gala banner, the scan box and the waiting list. */
export default function Loading() {
  return <FormSkeleton fields={3} />;
}
