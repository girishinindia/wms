import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The company profile lives on the importer's dashboard now. Old links land there. */
export default function CompanyPage() {
  redirect("/admin");
}
