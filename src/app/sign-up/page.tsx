import type { Metadata } from "next";

import AuthShell from "@/components/AuthShell";
import SignUpForm from "@/components/forms/SignUpForm";
import { authLink } from "@/components/authStyles";

export const metadata: Metadata = {
  title: "Create an importer account",
  description:
    "Importer registration for WMS. Sales agents and warehouse staff do not register here.",
  robots: { index: false, follow: false },
};

export default function SignUpPage() {
  return (
    <AuthShell
      panelTitle="Registration"
      panelIntro="Registration is open to importers only. Sales agents are created by their parent importer inside the portal, and warehouse staff logins are issued by the administrator."
      panelItems={[
        {
          n: "1",
          title: "Register",
          body: "Company and contact details. Two minutes, this form.",
        },
        {
          n: "2",
          title: "Verify",
          body: "Separate codes go to your mobile and your email. Both must be entered.",
        },
        {
          n: "3",
          title: "KYC review",
          body: "Upload IEC, GSTIN, PAN and supporting documents. We review and approve.",
        },
        {
          n: "4",
          title: "Go live",
          body: "Sign in, book storage, and start sending stock to the warehouse.",
        },
      ]}
      panelFootnote={
        <>
          Sign-in stays blocked until your account is approved — you will be
          notified by email and SMS the moment it is.
        </>
      }
      title="Create your importer account"
      subtitle="Registration is for importers. Agents and warehouse staff should ask for their login instead."
      footer={
        <>
          Already registered?{" "}
          <a href="/sign-in" className={authLink}>
            Sign in
          </a>
        </>
      }
    >
      <SignUpForm />
    </AuthShell>
  );
}
