import type { Metadata } from "next";
import Link from "next/link";

import AuthShell from "@/components/AuthShell";
import ResetPasswordForm from "@/components/forms/ResetPasswordForm";
import { authLink } from "@/components/authStyles";

export const metadata: Metadata = {
  title: "Set a new password",
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return (
    <AuthShell
      panelTitle="New password"
      panelIntro="Both codes checked out. Choose a new password to finish."
      panelItems={[
        { n: "1", title: "Identify", body: "Email and mobile, together. Done." },
        { n: "2", title: "Verify", body: "Both codes entered. Done." },
        {
          n: "3",
          title: "New password",
          body: "At least 8 characters. Length beats punctuation.",
        },
        {
          n: "4",
          title: "Everything else signs out",
          body: "Any other session is revoked, including one somebody else was using.",
        },
      ]}
      title="Set a new password"
      subtitle="This link works once and expires in a few minutes."
      footer={
        <>
          Changed your mind?{" "}
          <Link href="/sign-in" className={authLink}>
            Back to sign in
          </Link>
        </>
      }
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
