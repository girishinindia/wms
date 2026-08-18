import CompanyProfileForm from "@/components/admin/CompanyProfileForm";
import { Denied, PageHeader } from "@/components/admin/ui";
import { loadGeoOptions } from "@/lib/admin/geo";
import { importerIdOf, pageGuard } from "@/lib/auth/guard";
import { loadImporterProfile } from "@/lib/importer/profile";

export const dynamic = "force-dynamic";

/**
 * /admin/company — the importer's own company profile.
 *
 * The one screen an unverified importer can reach. They fill it in,
 * submit it, and a super admin verifies. After verification the same
 * screen stays as their profile, with the identity fields locked.
 */
export default async function CompanyPage() {
  const guard = await pageGuard("importer.update");
  if (!guard.ok) return <Denied what="your company profile" />;
  const importerId = importerIdOf(guard.actor);
  if (importerId === null) return <Denied what="your company profile" />;

  const profile = await loadImporterProfile(importerId);
  if (!profile) return <Denied what="your company profile" />;
  const geo = await loadGeoOptions();

  return (
    <>
      <PageHeader
        title="My company"
        subtitle={`${profile.code} · ${profile.profile.companyName}`}
      />
      <CompanyProfileForm initial={profile} geo={geo} />
    </>
  );
}
