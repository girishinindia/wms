/**
 * Reduce anything a user might paste into a bare 10-digit mobile number.
 *
 * People paste "+91 98765 43210", "091-9876543210", "(+91) 9876543210".
 * Stripping non-digits alone is not enough — the country code survives
 * and you end up validating 12 digits against a 10-digit rule, which
 * reads to the user as "my correct number was rejected".
 */
export function normalizeMobile(raw: string): string {
  let digits = raw.replace(/\D/g, "");

  // Drop a leading 0 (STD-style entry) or a 91 country code, but only
  // when doing so leaves a plausible 10-digit number behind.
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 13 && digits.startsWith("091")) digits = digits.slice(3);

  return digits.slice(0, 10);
}
