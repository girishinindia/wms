import { HeaderSkeleton, TableSkeleton } from "@/components/admin/Skeleton";

/** The list's shape at once, while the requests are read. */
export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <TableSkeleton rows={8} columns={7} />
    </>
  );
}
