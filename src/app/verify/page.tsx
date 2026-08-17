import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import AuthShell from "@/components/AuthShell";
import VerifyForm from "@/components/forms/VerifyForm";
import { authLink } from "@/components/authStyles";

export const metadata: Metadata = {
  title: "Verify your account",
  description: "Enter the codes sent to your email and mobile number.",
  robots: { index: false, follow: false },
};

export default function VerifyPage() {
  return (
    <AuthShell
      panelTitle="Verification"
      panelIntro="Two codes, two channels. Both have to be entered — proving one address does not prove the other."
      panelItems={[
        { n: "1", title: "Register", body: "Company and contact details. Done." },
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
          Your account is created the moment both codes are accepted. Until
          then it cannot sign in.
        </>
      }
      title="Enter your two codes"
      subtitle="One went to your email, a different one to your mobile."
      footer={
        <>
          Wrong details?{" "}
          <Link href="/sign-up" className={authLink}>
            Start again
          </Link>
        </>
      }
    >
      {/* useSearchParams needs a Suspense boundary, or the whole route
          opts out of static rendering and the build warns. */}
      <Suspense fallback={<div className="h-64" aria-hidden />}>
        <VerifyForm />
      </Suspense>
    </AuthShell>
  );
}
