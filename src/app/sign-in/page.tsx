import type { Metadata } from "next";
import Link from "next/link";

import AuthShell from "@/components/AuthShell";
import SignInForm from "@/components/forms/SignInForm";
import { authLink } from "@/components/authStyles";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your WMS account.",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <AuthShell
      panelTitle="Everything about your stock, in one place."
      panelIntro="Importers, sales agents and warehouse staff all sign in here. What you see is scoped to your role."
      panelItems={[
        {
          title: "Live stock visibility",
          body: "What is stored, reserved, confirmed and dispatched — per client, updated as it happens.",
        },
        {
          title: "Confirmation-gated dispatch",
          body: "Orders raised by your agents wait for your approval before anything leaves the warehouse.",
        },
        {
          title: "One account, web and mobile",
          body: "The same login works on the portal and the mobile app, on the same API.",
        },
      ]}
      panelFootnote={
        <>
          Locked out, or never received your credentials? Your importer creates
          agent logins; warehouse staff logins come from your administrator.
        </>
      }
      title="Sign in"
      subtitle="Use the email address or mobile number registered on your account."
      footer={
        <>
          Importer without an account?{" "}
          <Link href="/sign-up" className={authLink}>
            Register here
          </Link>
        </>
      }
    >
      <SignInForm />
    </AuthShell>
  );
}
