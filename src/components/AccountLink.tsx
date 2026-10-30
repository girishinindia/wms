"use client";

import { useEffect, useState } from "react";

/**
 * The public site's "Sign in" button — or "Dashboard" once signed in.
 *
 * The public pages are cached and rendered without the visitor's
 * session, so the server cannot know who is reading them. The session
 * cookie is httpOnly, so the browser cannot read it either; it asks
 * `/api/v1/auth/session` instead (401 when signed out) and swaps the
 * label after the page has loaded. Signed out, nothing changes.
 */
export default function AccountLink({
  className,
  signedOutLabel = "Sign in",
}: {
  className: string;
  signedOutLabel?: string;
}) {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/v1/auth/session", { credentials: "same-origin", cache: "no-store" })
      .then((r) => {
        if (alive && r.ok) setSignedIn(true);
      })
      .catch(() => {
        /* offline: keep "Sign in" */
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <a href={signedIn ? "/admin" : "/sign-in"} className={className}>
      {signedIn ? "Dashboard" : signedOutLabel}
    </a>
  );
}
