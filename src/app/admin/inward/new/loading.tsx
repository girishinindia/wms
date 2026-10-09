import { FormSkeleton } from "@/components/admin/Skeleton";

/** The request form is four cards of fields; a table skeleton would
 *  rearrange itself the moment the real page arrived. */
export default function Loading() {
  return <FormSkeleton fields={8} />;
}
