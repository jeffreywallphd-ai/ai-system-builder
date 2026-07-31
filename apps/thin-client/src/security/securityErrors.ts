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

export function toSecurityGuidance(error: ThinClientSecurityError | undefined): string | undefined {
  if (!error) return undefined;
  if (error.status === 403 && error.code === "security.forbidden") return FORBIDDEN_GUIDANCE;
  if (error.status === 401 && ["security.unauthenticated", "security.invalid-token", "security.expired-token", "security.revoked-token"].includes(error.code ?? "")) {
    return UNPAIRED_GUIDANCE;
  }
  if (error.message.toLowerCase().includes("failed to fetch") || error.message.toLowerCase().includes("network")) {
    return CONNECTION_GUIDANCE;
  }
  return undefined;
}
