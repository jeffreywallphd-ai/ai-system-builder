import type { AuthPrincipal } from "./auth-principal";

export const AUTH_METHODS = ["none", "lan-pairing-token", "oidc-bearer", "api-key", "bearer-token", "mtls", "external"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

export interface AuthContext {
  authenticated: boolean;
  principal: AuthPrincipal;
  authMethod: AuthMethod;
  issuedAt?: string;
  expiresAt?: string;
}

export const ANONYMOUS_AUTH_CONTEXT: AuthContext = {
  authenticated: false,
  principal: {
    principalId: "anonymous",
    kind: "anonymous",
    displayName: "Anonymous",
    roles: [],
    scopes: [],
  },
  authMethod: "none",
};

export function createAnonymousAuthContext(): AuthContext {
  return {
    ...ANONYMOUS_AUTH_CONTEXT,
    principal: { ...ANONYMOUS_AUTH_CONTEXT.principal, roles: [], scopes: [] },
  };
}
