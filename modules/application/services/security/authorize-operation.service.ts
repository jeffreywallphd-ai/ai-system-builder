import { createSecurityError, type AuthorizationRequest } from "../../../contracts/security";
import type { AuthorizationPolicyPort, SecurityAuditLogPort } from "../../ports/security";

export class AuthorizeOperationService {
  public constructor(
    private readonly policy: AuthorizationPolicyPort,
    private readonly options?: {
      audit?: SecurityAuditLogPort;
      createEventId?: () => string;
      now?: () => string;
    },
  ) {}

  public async execute(request: AuthorizationRequest): Promise<void> {
    const decision = await this.policy.authorize(request);
    await this.options?.audit?.recordSecurityEvent({
      eventId: this.options.createEventId?.() ?? "authorization-event",
      kind: decision.allowed ? "authz.allowed" : "authz.denied",
      occurredAt: this.options.now?.() ?? new Date().toISOString(),
      principalId: request.authContext.principal.principalId,
      organizationId: request.organizationId,
      organizationRole: decision.organizationRole,
      requestId: request.requestId,
      correlationId: request.correlationId,
      operation: request.operation,
      resource: request.resource,
      outcome: decision.allowed ? "allowed" : "denied",
      details: decision.reasonCode ? { reasonCode: decision.reasonCode } : undefined,
    });
    if (!decision.allowed) {
      throw createSecurityError("security.forbidden", decision.reason ?? "Forbidden", {
        operation: request.operation,
        reasonCode: decision.reasonCode,
        missingScopes: decision.missingScopes,
      });
    }
  }
}
