/**
 * How an About section's ONE plain-text box is read, per layout.
 *
 * The super admin pastes text; the layout decides its shape. Shared by
 * the admin's validation (a wrong shape is refused with the line it is
 * on), the public page and the app's API — so all three read a section
 * the same way. Pure: no server imports, safe in a client bundle.
 *
 *   TEXT            paragraphs, separated by a blank line
 *   CARDS           blocks separated by a blank line; first line = title,
 *   STEPS             the rest = text. Steps are numbered 1, 2, 3 by
 *   CHECKLIST         themselves; a checklist gets a tick per block
 *   NUMBERS         one per line:  value | label
 *   CALL_TO_ACTION  paragraphs, plus the section's button
 */

export const ABOUT_LAYOUTS = ["TEXT", "CARDS", "STEPS", "CHECKLIST", "NUMBERS", "CALL_TO_ACTION"] as const;
export type AboutLayout = (typeof ABOUT_LAYOUTS)[number];

export type AboutItem = { title: string; text: string };
export type AboutStat = { value: string; label: string };

export type AboutContent =
  | { layout: "TEXT" | "CALL_TO_ACTION"; paragraphs: string[] }
  | { layout: "CARDS" | "STEPS" | "CHECKLIST"; items: AboutItem[] }
  | { layout: "NUMBERS"; stats: AboutStat[] };

/** What the format guide under the box says, per layout. */
export const ABOUT_LAYOUT_GUIDE: Record<AboutLayout, string> = {
  TEXT: "Paragraphs. Leave a blank line between paragraphs.\n\nExample:\nGenius ITens runs warehouses for importers.\n\nOur division works from Bhiwandi, Thane.",
  CARDS:
    "One card per block, blocks separated by a blank line. First line = card title, the lines under it = card text. 2 to 12 cards.\n\nExample:\nReceive\nEvery carton gets its own QR sticker at the dock.\n\nStore\nEach carton goes into a numbered gala.",
  STEPS:
    "One step per block, blocks separated by a blank line. First line = step title, the lines under it = step text. Numbered 1, 2, 3 automatically. 2 to 12 steps.\n\nExample:\nTell us what's coming\nRaise an inward request with the packing list.\n\nWe receive it\nEvery carton is stickered and scanned in.",
  CHECKLIST:
    "One point per block, blocks separated by a blank line. First line = the bold point, the lines under it = the explanation. Each gets a green tick. 2 to 12 points.\n\nExample:\nYour stock, live.\nWhat has arrived and what has left — on web and phone.\n\nNothing leaves without you.\nYour agents' delivery notes wait for your approval.",
  NUMBERS:
    "One number per line, written as  value | label. 2 to 8 lines.\n\nExample:\n3 | warehouses\n1,20,000 sqft | of storage\n2016 | in business since",
  CALL_TO_ACTION:
    "A short message, then fill Button label and Button link below. Leave a blank line between paragraphs.\n\nExample:\nStoring imported stock and want to see it live? Talk to us.\n\nMobile: +91 98200 11122 · Email: support@geniusitens.com",
};

export const ABOUT_LAYOUT_LABEL: Record<AboutLayout, string> = {
  TEXT: "Text",
  CARDS: "Cards",
  STEPS: "Steps",
  CHECKLIST: "Checklist",
  NUMBERS: "Numbers",
  CALL_TO_ACTION: "Call to action",
};

const blocks = (body: string) =>
  body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

/** Read a body as its layout says, or say exactly what is wrong. */
export function parseAboutBody(
  layout: AboutLayout,
  body: string,
): { ok: true; content: AboutContent } | { ok: false; message: string } {
  const text = (body ?? "").replace(/\r\n?/g, "\n").trim();
  switch (layout) {
    case "TEXT":
    case "CALL_TO_ACTION":
      return { ok: true, content: { layout, paragraphs: blocks(text) } };

    case "CARDS":
    case "STEPS":
    case "CHECKLIST": {
      const noun = layout === "CARDS" ? "card" : layout === "STEPS" ? "step" : "point";
      const parts = blocks(text);
      if (parts.length < 2) {
        return { ok: false, message: `Add at least 2 ${noun}s, separated by a blank line` };
      }
      if (parts.length > 12) return { ok: false, message: `At most 12 ${noun}s — this has ${parts.length}` };
      const items: AboutItem[] = [];
      for (const [i, part] of parts.entries()) {
        const [first, ...rest] = part.split("\n").map((l) => l.trim());
        const title = first ?? "";
        const body = rest.filter(Boolean).join(" ");
        if (title.length > 80) {
          return { ok: false, message: `${cap(noun)} ${i + 1}: the title (first line) is over 80 characters` };
        }
        if (!body) {
          return { ok: false, message: `${cap(noun)} ${i + 1} (“${title}”) needs text on the line under its title` };
        }
        items.push({ title, text: body });
      }
      return { ok: true, content: { layout, items } };
    }

    case "NUMBERS": {
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) return { ok: false, message: "Add at least 2 lines, each written as  value | label" };
      if (lines.length > 8) return { ok: false, message: `At most 8 numbers — this has ${lines.length}` };
      const stats: AboutStat[] = [];
      for (const [i, line] of lines.entries()) {
        const parts = line.split("|").map((p) => p.trim());
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          return { ok: false, message: `Line ${i + 1} needs  value | label  — for example  3 | warehouses` };
        }
        if (parts[0].length > 20) return { ok: false, message: `Line ${i + 1}: the value is over 20 characters` };
        if (parts[1].length > 40) return { ok: false, message: `Line ${i + 1}: the label is over 40 characters` };
        stats.push({ value: parts[0], label: parts[1] });
      }
      return { ok: true, content: { layout, stats } };
    }
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Mirrors `about_section_button_link_safe` in 45_about_layouts.sql. */
export const ABOUT_BUTTON_LINK = /^(\/[A-Za-z0-9/_#?=&.-]*|mailto:[^\s<>"]+@[^\s<>"]+|tel:\+?[0-9 ]{6,20})$/;
