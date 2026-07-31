import crypto from "node:crypto";

import type { TokenVerifierPort } from "../../../application/ports/security";
import {
  createExternalSubjectIdentity,
  createSecurityApplicationError,
  type AuthContext,
  type OidcBearerConfig,
  type SecurityScope,
} from "../../../contracts/security";

/** OIDC proves identity only. Managed capabilities come from trusted organization membership. */
export const MANAGED_IDENTITY_SCOPES: readonly SecurityScope[] = [];

interface VerifiedJwtPayload {
  readonly iss?: string;
  readonly sub?: string;
  readonly iat?: number;
  readonly exp?: number;
}

export interface OidcJwtVerifier {
  verify(input: {
    token: string;
    issuer: string;
    audience: string;
    jwksUri: string;
    algorithms: readonly string[];
  }): Promise<VerifiedJwtPayload>;
}

export function createOidcBearerTokenVerifierAdapter(input: {
  config: OidcBearerConfig;
  jwtVerifier?: OidcJwtVerifier;
  applicationScopes?: readonly SecurityScope[];
}): TokenVerifierPort {
  const verifier = input.jwtVerifier ?? createJoseRemoteJwksVerifier();
  const scopes = [...(input.applicationScopes ?? MANAGED_IDENTITY_SCOPES)];
  return {
    async verifyToken({ token }): Promise<AuthContext> {
      try {
        const payload = await verifier.verify({
          token,
          issuer: input.config.issuer,
          audience: input.config.audience,
          jwksUri: input.config.jwksUri,
          algorithms: input.config.algorithms,
        });
        const identity = createExternalSubjectIdentity({
          issuer: payload.iss ?? "",
          subject: payload.sub ?? "",
        });
        return {
          authenticated: true,
          authMethod: "oidc-bearer",
          principal: {
            principalId: createInternalPrincipalId(identity),
            kind: "user",
            externalIdentity: identity,
            roles: [],
            scopes,
          },
          issuedAt: payload.iat === undefined
            ? undefined
            : new Date(payload.iat * 1000).toISOString(),
          expiresAt: payload.exp === undefined
            ? undefined
            : new Date(payload.exp * 1000).toISOString(),
        };
      } catch {
        throw createSecurityApplicationError(
          "security.invalid-token",
          "Invalid bearer token.",
        );
      }
    },
  };
}

export function createInternalPrincipalId(identity: {
  issuer: string;
  subject: string;
}): string {
  return `principal-${crypto.createHash("sha256")
    .update(identity.issuer)
    .update("\0")
    .update(identity.subject)
    .digest("hex")}`;
}

function createJoseRemoteJwksVerifier(): OidcJwtVerifier {
  const remoteJwksByUri = new Map<string, ReturnType<
    typeof import("jose")["createRemoteJWKSet"]
  >>();
  return {
    async verify(input) {
      const jose = await import("jose");
      let keySet = remoteJwksByUri.get(input.jwksUri);
      if (!keySet) {
        keySet = jose.createRemoteJWKSet(new URL(input.jwksUri));
        remoteJwksByUri.set(input.jwksUri, keySet);
      }
      const result = await jose.jwtVerify(input.token, keySet, {
        issuer: input.issuer,
        audience: input.audience,
        algorithms: [...input.algorithms],
      });
      return result.payload;
    },
  };
}
