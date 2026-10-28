export interface ThinClientSecurityError {
  status?: number;
  code?: string;
  message: string;
  details?: unknown;
  endpoint?: string;
}

export const UNPAIRED_GUIDANCE = "This device is not paired with the server. Pair this device to continue.";
export const FORBIDDEN_GUIDANCE = "This paired device does not have permission for this action.";
export const CONNECTION_GUIDANCE = "Unable to reach the secure server. Verify HTTPS certificate trust, URL, and server availability.";
export const STATUS_FAILURE = "Could not read security status. Refresh status to try again.";

// The fallback is fixed caller-owned copy. Never retain unknown message/details.
export function normalizeSecurityError(error: unknown, fallback: string): ThinClientSecurityError {
  try {
    const value = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
    const status = typeof value.status === "number" && Number.isInteger(value.status) && value.status >= 400 && value.status <= 599 ? value.status : undefined;
    const code = typeof value.code === "string" && SECURITY_ERROR_CODES.includes(value.code as SecurityErrorCode) ? value.code : undefined;
    return { ...(status === undefined ? {} : { status }), ...(code === undefined ? {} : { code }), message: fallback };
  } catch { return { message: fallback }; }
}

export function toSecurityGuidance(error: ThinClientSecurityError | undefined): string | undefined {
  if (!error) return undefined;
  if (error.status === 403 && error.code === "security.forbidden") return FORBIDDEN_GUIDANCE;
  if (error.status === 401 && ["security.unauthenticated", "security.invalid-token", "security.expired-token", "security.revoked-token"].includes(error.code ?? "")) {
    return UNPAIRED_GUIDANCE;
  }
  if (typeof error.message === "string" && (error.message.toLowerCase().includes("failed to fetch") || error.message.toLowerCase().includes("network"))) {
    return CONNECTION_GUIDANCE;
  }
  return undefined;
}
import { SECURITY_ERROR_CODES, type SecurityErrorCode } from "../../../../modules/contracts/security";
