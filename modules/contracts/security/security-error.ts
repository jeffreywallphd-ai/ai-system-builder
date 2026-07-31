export const SECURITY_ERROR_CODES = [
  "security.disabled",
  "security.https-required",
  "security.unauthenticated",
  "security.invalid-token",
  "security.expired-token",
  "security.revoked-token",
  "security.forbidden",
  "security.organization-required",
  "security.organization-invalid",
  "security.tenant-placement-denied",
  "security.route-policy-missing",
  "security.pairing-disabled",
  "security.pairing-code-invalid",
  "security.pairing-code-expired",
  "security.rate-limited",
  "security.internal",
] as const;

export type SecurityErrorCode = (typeof SECURITY_ERROR_CODES)[number];

export interface SecurityError {
  code: SecurityErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export class SecurityApplicationError extends Error {
  public readonly code: SecurityErrorCode;
  public readonly details?: Record<string, unknown>;

  public constructor(code: SecurityErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SecurityApplicationError";
    this.code = code;
    this.details = details;
  }
}

export function createSecurityError(code: SecurityErrorCode, message: string, details?: Record<string, unknown>): SecurityError {
  return { code, message, details };
}

export function createSecurityApplicationError(code: SecurityErrorCode, message: string, details?: Record<string, unknown>): SecurityApplicationError {
  return new SecurityApplicationError(code, message, details);
}
