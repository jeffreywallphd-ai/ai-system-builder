import type { SecurityEvent } from "../../../contracts/security";

export interface SecurityAuditLogPort {
  recordSecurityEvent(event: SecurityEvent): Promise<void>;
}
