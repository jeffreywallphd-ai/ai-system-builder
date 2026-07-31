import type { AuthorizationDecision, AuthContext, SecurityScope } from "../../contracts/security";
import { missingSecurityScopes } from "../../contracts/security";

export function authorizeByScopes(authContext: AuthContext, requiredScopes: readonly SecurityScope[]): AuthorizationDecision {
  if (requiredScopes.length === 0) {
    return { allowed: true };
  }

  if (!authContext.authenticated) {
    return { allowed: false, reason: "Unauthenticated", missingScopes: [...requiredScopes] };
  }

  const missing = missingSecurityScopes(authContext.principal.scopes, requiredScopes);
  if (missing.length > 0) {
    return { allowed: false, reason: "Missing required scopes", missingScopes: missing };
  }

  return { allowed: true };
}
