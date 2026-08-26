import { z } from "zod";

import { email, mobile } from "./auth";

/**
 * Indian mobile numbers begin 6, 7, 8 or 9.
 *
 * The shared `mobile` rule from auth.ts asks only for ten digits,
 * because `users.mobile` has no shape constraint behind it and
 * tightening the rule there would start refusing numbers the table is
 * perfectly happy to store. `wms.enquiry` DOES carry that CHECK, so the
 * form has to know it: without this, "5820011133" passed validation,
 * reached the insert, and came back as a 500 with a Postgres message in
 * it — a valid-looking number answered with what reads as a broken
 * site.
 *
 * Stated here rather than in auth.ts on purpose. Two tables, two rules,
 * and the stricter one belongs next to the table that enforces it.
 */
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/**
 * The contact form, in one place.
 *
 * The client renders errors from this schema and the server refuses on
 * the same one. That is not belt-and-braces: the browser copy is a
 * convenience anybody can skip with two lines of `fetch`, and the
 * server copy is the actual gate. Sharing the definition is what stops
 * them drifting into disagreeing about what is valid.
 *
 * The limits match the CHECK constraints on `wms.enquiry` exactly, so a
 * value the form accepts cannot then be refused by the table with a
 * 500 that reads as a bug in the site.
 */

/**
 * A whole name typed by a stranger, which is not the same field as a
 * first name.
 *
 * `personName` in auth.ts is letters only with no spaces, because it
 * feeds `users.first_name`. Applying it here would reject "Ravi Kumar",
 * "D'Souza" and "Patel-Shah" — real names, on the one form whose whole
 * job is to let somebody reach the business.
 */
const NAME_SHAPE = /^[\p{L}][\p{L}\s.'-]*$/u;

export const enquirySchema = z.object({
  name: z
    .string({ required_error: "Name is required" })
    .trim()
    .min(1, "Name is required")
    .min(2, "Name must be at least 2 characters")
    .max(60, "Name must be at most 60 characters")
    .regex(NAME_SHAPE, "Name should be letters, spaces, hyphens and apostrophes"),
  email,
  mobile: mobile.regex(INDIAN_MOBILE, "Enter a valid Indian mobile number"),
  subject: z
    .string({ required_error: "Subject is required" })
    .trim()
    .min(1, "Subject is required")
    .min(3, "Subject must be at least 3 characters")
    .max(120, "Subject must be at most 120 characters"),
  message: z
    .string({ required_error: "Message is required" })
    .trim()
    .min(1, "Message is required")
    .min(10, "Tell us a little more — at least 10 characters")
    .max(2000, "Message must be at most 2000 characters"),
});

export type EnquiryValues = z.infer<typeof enquirySchema>;

/**
 * What the route accepts, which is the form plus the captcha token the
 * browser attaches. Optional: the token is absent when reCAPTCHA is not
 * configured, and the route decides what to do about that rather than
 * failing validation over a key the operator has not set yet.
 */
export const enquiryRequestSchema = enquirySchema.extend({
  captchaToken: z.string().trim().max(4096).optional(),
});
