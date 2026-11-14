import type { SecurityAuditLogPort } from "../../../application/ports/security";

const DENIAL_SAMPLE_INTERVAL_MS = 60_000;

/** Passive checks use the same policy with bounded, content-free denial diagnostics. */
export function createManagedSavedStateAuthorizationAudit(
  sink: SecurityAuditLogPort, clock: () => number = () => performance.now(),
): SecurityAuditLogPort {
  let lastSample = -DENIAL_SAMPLE_INTERVAL_MS;
  let pending = false;
  let denials = 0;
  return {
    async recordSecurityEvent(event) {
      if (event.kind !== "authz.denied") return;
      denials = Math.min(Number.MAX_SAFE_INTEGER, denials + 1);
      const at = clock();
      if (pending || at - lastSample < DENIAL_SAMPLE_INTERVAL_MS) return;
      const count = denials;
      denials = 0;
      pending = true;
      lastSample = at;
      try {
        await sink.recordSecurityEvent({ eventId: event.eventId, occurredAt: event.occurredAt, kind: "authz.denied",
          operation: "headless.saved-state", outcome: "denied", details: { deniedChecks: count } });
      } catch {
        denials = Math.min(Number.MAX_SAFE_INTEGER, denials + count);
      } finally { pending = false; }
    },
  };
}
