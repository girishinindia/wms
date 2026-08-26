/**
 * Where the business can be reached.
 *
 * ── EDIT THIS FILE TO CHANGE THE DETAILS ON /contact ──
 *
 * These are constants rather than rows in a table, and that is a
 * deliberate limitation worth stating plainly: changing an address here
 * needs a code edit and a deploy, not an admin screen.
 *
 * The alternative is a settings table and a Master screen to edit it —
 * a reasonable thing to want, and a bigger piece of work than the
 * contact page itself. It was left out rather than half-built, because
 * a half-built settings table is the kind of thing that gets one row,
 * no validation and no audit trail, and then quietly becomes where
 * everything else gets dumped.
 *
 * Nothing here is secret. It is on a public page by design, so it does
 * not belong in the environment either — env vars would only move the
 * same redeploy somewhere less visible.
 */

export type ContactChannel = {
  label: string;
  /** What the visitor reads. */
  value: string;
  /** Where clicking it goes. Absent for things that are not clickable. */
  href?: string;
  /** One line under the value, when the value alone is ambiguous. */
  note?: string;
};

export const COMPANY_NAME = "Genius ITens";

export const CONTACT_ADDRESS = {
  label: "Address",
  lines: [
    "Genius ITens",
    "Warehouse & Logistics Division",
    "Bhiwandi, Thane",
    "Maharashtra 421302",
    "India",
  ],
} as const;

/**
 * `tel:` carries the country code because a phone dialling it may not
 * be in India; the displayed value keeps the spacing a person reads.
 */
export const CONTACT_CHANNELS: ContactChannel[] = [
  {
    label: "Mobile",
    value: "+91 98200 11122",
    href: "tel:+919820011122",
    note: "Monday to Saturday",
  },
  {
    label: "Email",
    value: "support@geniusitens.com",
    href: "mailto:support@geniusitens.com",
    note: "We reply within one working day",
  },
  {
    label: "Office hours",
    value: "9:30 am – 6:30 pm IST",
    note: "Closed on Sundays and public holidays",
  },
];
