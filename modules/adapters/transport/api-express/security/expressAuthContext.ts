import type { Request } from "express";
import type { AuthContext } from "../../../../contracts/security";

const AUTH_CONTEXT_KEY = Symbol.for("asb.express.authContext");

type RequestWithAuthContext = Request & { [AUTH_CONTEXT_KEY]?: AuthContext };

export function setExpressAuthContext(request: Request, authContext: AuthContext): void {
  (request as RequestWithAuthContext)[AUTH_CONTEXT_KEY] = authContext;
}

export function getExpressAuthContext(request: Request): AuthContext | undefined {
  return (request as RequestWithAuthContext)[AUTH_CONTEXT_KEY];
}

export function requireExpressAuthenticatedPrincipalId(request: Request): string {
  const authContext = getExpressAuthContext(request);
  const principalId = authContext?.principal.principalId.trim();
  if (!authContext?.authenticated || !principalId) {
    throw new Error("Authenticated principal context is required.");
  }
  return principalId;
}
