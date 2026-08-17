import "server-only";

/**
 * What a provider hands back.
 *
 * The shape is deliberately the same for email and SMS, because the
 * caller's job — write a `wms.notification_delivery` row and decide
 * whether to schedule a retry — is the same for both. A provider-shaped
 * return type would push that decision into every call site.
 *
 * `retryable` is the field that matters. It is the provider module's
 * judgement, made where the error codes are actually understood, rather
 * than a caller guessing from an HTTP status. Retrying an out-of-credits
 * or template-mismatch failure cannot succeed; retrying a timeout
 * usually can.
 */
export type SendOutcome = {
  /** Maps onto wms.delivery_status. */
  status: "SENT" | "FAILED" | "SUPPRESSED";
  retryable: boolean;
  provider: "brevo" | "smsgatewayhub" | "fcm";
  /** The address actually used, after normalisation. */
  address?: string;
  /** Provider id: Brevo messageId, SmsGatewayHub JobId, FCM name. */
  providerMessageId?: string;
  /** Provider code, or a synthetic one (NETWORK, INVALID_MOBILE, ...). */
  errorCode?: string;
  /** Human-readable, safe to put in a log. Never contains a secret. */
  error?: string;
  /** The parsed provider body, stored for forensics. */
  response?: unknown;
};
