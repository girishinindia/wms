import "server-only";

import { appEnv } from "@/lib/env";

/**
 * Turning a stored path into a link somebody can actually click.
 *
 * `wms.notification_template.action_url` holds relative paths — today
 * `/admin/importers/{{importer_id}}`. That is the right thing to store:
 * the row outlives any one hostname, and freezing an origin into the
 * database means every historical notification points at the old domain
 * the day the domain changes.
 *
 * But a relative path is only meaningful to a browser that is already on
 * the site. In an email it is dead: the mail client has no base to
 * resolve it against, and the recipient clicks a link that goes nowhere.
 * So the origin is attached at SEND time, per channel, and never
 * persisted:
 *
 *   IN_APP  — stays relative. The portal routes it internally, and the
 *             stored row survives a domain change.
 *   EMAIL   — absolute, or it does not work at all.
 *   PUSH    — absolute, so the same string works as an Android App Link
 *             and as a web fallback when the app is not installed.
 */

/** The canonical origin, with no trailing slash. */
export function appOrigin(): string {
  return appEnv().appUrl;
}

/** True for anything that already carries its own scheme — including the
 *  `wms://` deep link scheme, which must not be prefixed. */
function hasScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

/**
 * Resolve a stored action URL against the canonical origin.
 *
 * Returns null for an empty or absent value so callers can drop the
 * field rather than send `https://wms.geniusitens.com` on its own, which
 * looks like a link to the home page and is worse than no link.
 */
export function absoluteUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (hasScheme(trimmed)) return trimmed;

  // A protocol-relative `//evil.com` would otherwise inherit our scheme
  // and point somewhere else entirely.
  if (trimmed.startsWith("//")) return null;

  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${appOrigin()}${path}`;
}
