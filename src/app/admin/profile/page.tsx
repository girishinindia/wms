import { sql } from "drizzle-orm";

import Avatar from "@/components/admin/Avatar";
import PhotoCropper from "@/components/admin/PhotoCropper";
import { ContactChangeForm, NameForm, PasswordForm } from "@/components/admin/ProfileForms";
import { Card, Denied, PageHeader } from "@/components/admin/ui";
import { getDb } from "@/db";
import { currentActor } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * /admin/profile — every signed-in user's own account.
 *
 * Name is a plain edit. Password needs the current one. Email and
 * mobile change only after an OTP proves the NEW address — and each of
 * those three ends with a fresh sign-in, because the thing that changed
 * is the thing sessions are built on.
 */
export default async function ProfilePage() {
  const actor = await currentActor();
  if (!actor) return <Denied what="your profile" />;

  const rows = await getDb().execute<{
    first_name: string; last_name: string; email: string; mobile: string; photo_url: string | null;
  }>(sql`
    select first_name, last_name, email::text as email, mobile::text as mobile, photo_url
      from wms.users where id = ${actor.session.userId} and deleted_at is null
  `);
  const me = rows[0];
  if (!me) return <Denied what="your profile" />;

  return (
    <>
      <PageHeader
        title="My profile"
        subtitle={`${me.email} · ${actor.roles.map((r) => r.role).join(" · ") || "no role"}`}
        leading={
          <Avatar
            name={`${me.first_name} ${me.last_name}`}
            photoUrl={me.photo_url}
            size={56}
          />
        }
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-6 xl:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-verdigris-300">Photo</h2>
          <div className="mt-4">
            <PhotoCropper
              name={`${me.first_name} ${me.last_name}`}
              photoUrl={me.photo_url}
              endpoint="/profile/photo"
            />
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-verdigris-300">Name</h2>
          <div className="mt-4">
            <NameForm firstName={me.first_name} lastName={me.last_name} />
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-verdigris-300">Password</h2>
          <div className="mt-4">
            <PasswordForm />
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-verdigris-300">Email address</h2>
          <div className="mt-4">
            <ContactChangeForm kind="email" current={me.email} />
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-verdigris-300">Mobile number</h2>
          <div className="mt-4">
            <ContactChangeForm kind="mobile" current={me.mobile} />
          </div>
        </Card>
      </div>
    </>
  );
}
