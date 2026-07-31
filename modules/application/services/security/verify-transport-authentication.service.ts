import { ANONYMOUS_AUTH_CONTEXT, createSecurityError, type AuthContext } from "../../../contracts/security";
import type { SecurityAuditLogPort, TokenVerifierPort } from "../../ports/security";

export class VerifyTransportAuthenticationService {
  public constructor(
    private readonly tokens: TokenVerifierPort,
    private readonly options: { authRequired: boolean; audit?: SecurityAuditLogPort },
  ) {}

  public async execute(input: { bearerToken?: string; now: Date; operation?: string }): Promise<AuthContext> {
    if (!input.bearerToken) {
      if (this.options.authRequired) {
        await this.options.audit?.recordSecurityEvent({
          eventId: `evt-${input.now.getTime()}`,
          kind: "auth.failed",
          occurredAt: input.now.toISOString(),
          operation: input.operation,
          outcome: "failure",
          details: { reason: "missing_token" },
        });
        throw createSecurityError("security.unauthenticated", "Authentication required.");
      }
      return ANONYMOUS_AUTH_CONTEXT;
    }

    const context = await this.tokens.verifyToken({ token: input.bearerToken, now: input.now });
    await this.options.audit?.recordSecurityEvent({
      eventId: `evt-${input.now.getTime()}-ok`,
      kind: "auth.succeeded",
      occurredAt: input.now.toISOString(),
      principalId: context.principal.principalId,
      operation: input.operation,
      outcome: "success",
    });
    return context;
  }
}
