import type { SecurityScope } from "./auth-scope";
import type { ExternalSubjectIdentity } from "./external-subject-identity";

export const AUTH_PRINCIPAL_KINDS = ["anonymous", "device", "user", "service"] as const;
export type AuthPrincipalKind = (typeof AUTH_PRINCIPAL_KINDS)[number];

export interface AuthPrincipal {
  principalId: string;
  kind: AuthPrincipalKind;
  displayName?: string;
  externalIdentity?: ExternalSubjectIdentity;
  roles: string[];
  scopes: SecurityScope[];
}
