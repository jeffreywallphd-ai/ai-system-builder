import type { AuthorizationResource } from "./authorization-decision";
import type { OrganizationId, OrganizationRole } from "../organization";

export const SECURITY_EVENT_KINDS = [
  "auth.succeeded",
  "auth.failed",
  "authz.denied",
  "authz.allowed",
  "organization.selected",
  "organization.membership.changed",
  "tenant.placement.denied",
  "resource.accessed",
  "pairing.completed",
  "token.revoked",
  "security.config.resolved",
] as const;

export type SecurityEventKind = (typeof SECURITY_EVENT_KINDS)[number];

export interface SecurityEvent {
  eventId: string;
  kind: SecurityEventKind;
  occurredAt: string;
  principalId?: string;
  organizationId?: OrganizationId;
  organizationRole?: OrganizationRole;
  requestId?: string;
  correlationId?: string;
  operation?: string;
  resource?: AuthorizationResource;
  outcome: "allowed" | "denied" | "success" | "failure";
  details?: Record<string, unknown>;
}
