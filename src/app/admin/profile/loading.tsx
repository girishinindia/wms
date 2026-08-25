import { FormSkeleton } from "@/components/admin/Skeleton";

/** My profile is a stack of fields, not a table. A table skeleton here
 *  would rearrange itself the moment the real page arrived. */
export default function Loading() {
  return <FormSkeleton fields={6} />;
}
