import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import AuthShell from "@/components/AuthShell";
import { visibleNav } from "@/components/admin/nav";
import SignInForm from "@/components/forms/SignInForm";
import { authLink } from "@/components/authStyles";
import { currentActor } from "@/lib/auth/guard";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your WMS account.",
  robots: { index: false, follow: false },
};

/** Reads the session cookie, so it cannot be prerendered. */
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  /**
   * Somebody already signed in does not need a login form.
   *
   * This is also the only route back into the admin area from the
   * public site. The header's "Sign in" button is the one obvious thing
   * to click, and until now it led to a form the person had already
   * filled in — so an admin who navigated away had no way back except
   * typing the URL. Now it takes an admin to the panel and everyone else
   * home.
   */
  const actor = await currentActor();
  if (actor) {
    redirect(visibleNav(actor.permissions).length > 0 ? "/admin" : "/");
  }

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
          <a href="/sign-up" className={authLink}>
            Register here
          </a>
        </>
      }
    >
      {/* useSearchParams needs a boundary, or the whole route opts out
          of static rendering and the build fails. */}
      <Suspense fallback={<div className="h-64" aria-hidden />}>
        <SignInForm />
      </Suspense>
    </AuthShell>
  );
}
