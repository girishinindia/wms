import type { Metadata } from "next";

import AuthShell from "@/components/AuthShell";
import ForgotPasswordForm from "@/components/forms/ForgotPasswordForm";
import { authLink } from "@/components/authStyles";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Request a password reset for your WMS account.",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      panelTitle="Two codes, two channels, both required."
      panelIntro="A password reset needs the email address and the mobile number on the account. Each receives its own code, and both must be entered."
      panelItems={[
        {
          title: "Valid for 10 minutes",
          body: "Each code is single-use. Resend after 60 seconds, up to three times in 30 minutes.",
        },
        {
          title: "Five attempts, then a pause",
          body: "After five wrong entries the code is invalidated and the account is locked for 30 minutes.",
        },
        {
          title: "Details must match",
          body: "Both the email and the mobile have to be the ones registered on the account — updating either needs the same dual verification.",
        },
      ]}
      panelFootnote={
        <>
          No longer have access to the registered mobile or email? Contact your
          administrator — for agents, that is the importer who created your
          account.
        </>
      }
      title="Reset your password"
      subtitle="Enter the email address and mobile number on your account."
      footer={
        <>
          Remembered it?{" "}
          <a href="/sign-in" className={authLink}>
            Back to sign in
          </a>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
