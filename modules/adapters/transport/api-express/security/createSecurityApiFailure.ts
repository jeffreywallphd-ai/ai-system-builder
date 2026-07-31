import { createApiError, createApiFailureResponse } from "../../../../contracts/api";
import {
  SECURITY_ERROR_CODES,
  SecurityApplicationError,
  type SecurityErrorCode,
} from "../../../../contracts/security";

export function createSecurityApiFailure(error: { code: string; message: string; status: number; details?: Record<string, unknown> }) {
  return createApiFailureResponse(createApiError(error.code as `${Lowercase<string>}.${Lowercase<string>}`, error.status === 403 ? "forbidden" : "unauthorized", error.message, { details: error.details }));
}

export function mapSecurityFailure(error: unknown): { status: number; code: string; message: string } {
  const securityError = readSecurityError(error);
  if (securityError) {
    if (securityError.code === "security.forbidden") {
      return { status: 403, code: securityError.code, message: "Forbidden." };
    }
    if (securityError.code === "security.pairing-code-invalid" || securityError.code === "security.pairing-code-expired" || securityError.code === "security.pairing-disabled") {
      return { status: 400, code: securityError.code, message: securityError.message };
    }
    return { status: 401, code: securityError.code, message: securityError.message };
  }
  return { status: 500, code: "security.internal", message: "Security middleware failed." };
}

function readSecurityError(error: unknown): { code: SecurityErrorCode; message: string } | undefined {
  if (error instanceof SecurityApplicationError) {
    return error;
  }
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const candidate = error as { code?: unknown; message?: unknown };
  if (
    typeof candidate.code !== "string"
    || !SECURITY_ERROR_CODES.includes(candidate.code as SecurityErrorCode)
    || typeof candidate.message !== "string"
  ) {
    return undefined;
  }
  return { code: candidate.code as SecurityErrorCode, message: candidate.message };
}
