export const SECURITY_SCOPES = [
  "artifact:read",
  "artifact:write",
  "asset:read",
  "asset:write",
  "workspace:read",
  "workspace:write",
  "model:read",
  "model:write",
  "image-generation:read",
  "image-generation:write",
  "runtime:read",
  "runtime:admin",
  "settings:read",
  "settings:write",
  "provider-credential:read",
  "provider-credential:use",
  "provider-credential:write",
  "provider-repository:create",
  "security:admin",
] as const;

export type SecurityScope = (typeof SECURITY_SCOPES)[number];

export function hasSecurityScope(scopes: readonly SecurityScope[], requiredScope: SecurityScope): boolean {
  return scopes.includes(requiredScope);
}

export function hasAllSecurityScopes(scopes: readonly SecurityScope[], requiredScopes: readonly SecurityScope[]): boolean {
  return requiredScopes.every((scope) => scopes.includes(scope));
}

export function missingSecurityScopes(
  scopes: readonly SecurityScope[],
  requiredScopes: readonly SecurityScope[],
): SecurityScope[] {
  return requiredScopes.filter((scope) => !scopes.includes(scope));
}
