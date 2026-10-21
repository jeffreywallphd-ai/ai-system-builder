import { ANONYMOUS_AUTH_CONTEXT, AUTH_METHODS, createSecurityError, type AuthContext } from "../../../contracts/security";
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
    // A verifier is a port, not authority to relax the authentication invariant.
    // Validate its runtime result before using identity or recording success.
    if (!isAuthenticatedContext(context)) {
      await this.options.audit?.recordSecurityEvent({
        eventId: `evt-${input.now.getTime()}-invalid`, kind: "auth.failed",
        occurredAt: input.now.toISOString(), operation: input.operation,
        outcome: "failure", details: { reason: "invalid_verifier_context" },
      });
      throw createSecurityError("security.unauthenticated", "Authentication required.");
    }
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

function isAuthenticatedContext(context: AuthContext | undefined): context is AuthContext {
  const principal = context?.principal;
  return context?.authenticated === true &&
    AUTH_METHODS.includes(context.authMethod) && context.authMethod !== "none" &&
    !!principal && ["device", "user", "service"].includes(principal.kind) &&
    typeof principal.principalId === "string" && !!principal.principalId.trim() &&
    principal.principalId === principal.principalId.trim() && principal.principalId !== "anonymous" &&
    Array.isArray(principal.roles) && principal.roles.every((r) => typeof r === "string") &&
    Array.isArray(principal.scopes) && principal.scopes.every((s) => typeof s === "string");
}
