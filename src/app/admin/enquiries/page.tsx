import { sql } from "drizzle-orm";

import EnquiriesTable, { type EnquiryRow } from "@/components/admin/EnquiriesTable";
import { Denied, PageHeader } from "@/components/admin/ui";
import { getDb } from "@/db";
import { pageGuard } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * /admin/enquiries — messages sent from the public contact form.
 *
 * Platform level only, and that is a decision about the DATA rather
 * than about seniority. An enquiry belongs to no warehouse and no
 * importer: a stranger who has not chosen a site yet is exactly who
 * writes in. So there is nothing for a WAREHOUSE or OWN grant to
 * narrow BY, and the choice is between showing a branch manager every
 * lead the business has — names, emails and mobile numbers — or showing
 * them none. None is the honest answer, and it is the same reasoning
 * that keeps the audit log at ALL.
 *
 * 27_enquiry.sql grants `enquiry.read` to SUPER_ADMIN alone, so in
 * practice this check and that grant say the same thing twice. Both
 * stay: the grant can be widened from a console at any time, and this
 * is what makes widening it insufficient on its own.
 */
export default async function EnquiriesPage() {
  const guard = await pageGuard("enquiry.read");
  if (!guard.ok) return <Denied what="enquiries" />;
  if (guard.grant.scope !== "ALL") return <Denied what="enquiries" />;

  const rows = await getDb().execute<{
    id: number;
    name: string;
    email: string;
    mobile: string;
    subject: string;
    message: string;
    created_at: string;
    read_at: string | null;
    replied_at: string | null;
  }>(sql`
    select id, name, email::text as email, mobile, subject, message,
           created_at::text as created_at, read_at::text as read_at,
           replied_at::text as replied_at
      from wms.enquiry
     where deleted_at is null
     order by created_at desc
     limit 300
  `);

  const items: EnquiryRow[] = rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    email: r.email,
    mobile: r.mobile,
    subject: r.subject,
    message: r.message,
    createdAt: r.created_at,
    readAt: r.read_at,
    repliedAt: r.replied_at,
  }));
  const unread = items.filter((i) => i.readAt === null).length;

  return (
    <>
      <PageHeader
        title="Enquiry"
        subtitle={
          items.length === 0
            ? "Nothing has come through the contact form yet."
            : `${items.length} kept · ${unread} unread`
        }
      />
      <EnquiriesTable rows={items} unread={unread} />
    </>
  );
}
