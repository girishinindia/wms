import { z } from "zod";

/**
 * What a review may contain — shared by the web form, the API and the
 * tests, so the three cannot disagree. The CHECKs in 44_site_content.sql
 * say the same thing again at the database.
 *
 * Plain text only: a review is printed on a page anyone can read, so
 * angle brackets are refused here rather than escaped and hoped about.
 */
const plainText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, `At least ${min} characters`)
    .max(max, `At most ${max} characters`)
    .refine((v) => !/[<>]/.test(v), "Angle brackets are not allowed")
    .refine((v) => /[A-Za-z]/.test(v), "Needs at least one letter");

export const REVIEW_BODY_MIN = 20;
export const REVIEW_BODY_MAX = 1000;

export const reviewInputSchema = z.object({
  rating: z.coerce
    .number({ invalid_type_error: "Pick a star rating" })
    .int("Pick a star rating")
    .min(1, "Pick a star rating")
    .max(5, "Pick a star rating"),
  body: plainText(REVIEW_BODY_MIN, REVIEW_BODY_MAX),
  /** false: shown as "A verified importer" — the city still shows. */
  showName: z.boolean().default(true),
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;

export const REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED", "HIDDEN"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/**
 * A moderation decision. A rejection must say why — the author sees the
 * note on their own review and has to know what to change. Approving or
 * hiding may leave it empty.
 */
export const decisionSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT", "HIDE"]),
    note: z
      .string()
      .trim()
      .max(300, "At most 300 characters")
      .refine((v) => !/[<>]/.test(v), "Angle brackets are not allowed")
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .superRefine((v, ctx) => {
    if (v.decision === "REJECT" && (!v.note || v.note.length < 3)) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "Say why, so the writer knows what to change" });
    }
  });
export type DecisionInput = z.infer<typeof decisionSchema>;

export const STATUS_OF_DECISION: Record<DecisionInput["decision"], ReviewStatus> = {
  APPROVE: "APPROVED",
  REJECT: "REJECTED",
  HIDE: "HIDDEN",
};

/**
 * How a writer appears on the public page. "Ravi S." — first name and
 * the initial of the last — never the full name, and never the email.
 */
export function publicDisplayName(firstName: string, lastName: string): string {
  const first = firstName.trim();
  const initial = lastName.trim().charAt(0);
  if (!first) return "A verified importer";
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}
