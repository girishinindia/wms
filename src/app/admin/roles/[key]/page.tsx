import Link from "next/link";
import { notFound } from "next/navigation";

import RoleMatrix from "@/components/admin/RoleMatrix";
import { Card, Denied, PageHeader } from "@/components/admin/ui";
import { pageGuard } from "@/lib/auth/guard";
import { readMatrix } from "@/lib/roles/matrix";

export const dynamic = "force-dynamic";

/**
 * One role's permission matrix.
 *
 * Every box the caller could not grant is disabled on the server, not
 * hidden: seeing that `expense.delete` exists and is beyond you is
 * information; a matrix with holes in it is a puzzle.
 */
export default async function RolePage({ params }: { params: Promise<{ key: string }> }) {
  const guard = await pageGuard("role.read");
  if (!guard.ok) return <Denied what="roles" />;

  const { key } = await params;
  const matrix = await readMatrix(guard.actor, key);
  if (!matrix) notFound();

  return (
    <>
      <Link
        href="/admin/roles"
        className="mb-4 inline-block text-xs font-medium text-verdigris-300 transition-colors hover:text-patina"
      >
        ← All roles
      </Link>

      <PageHeader
        title={matrix.name}
        subtitle={
          matrix.description ??
          `${matrix.domain.toLowerCase()} · level ${matrix.level} · held by ${matrix.holders} ${
            matrix.holders === 1 ? "person" : "people"
          }`
        }
      />

      {matrix.lockedReason ? (
        <Card className="mb-6 p-5">
          <h2 className="text-sm font-semibold text-verdigris-50">Read-only</h2>
          <p className="mt-1.5 text-xs leading-5 text-verdigris-200/60">{matrix.lockedReason}</p>
        </Card>
      ) : null}

      <RoleMatrix matrix={matrix} />
    </>
  );
}
