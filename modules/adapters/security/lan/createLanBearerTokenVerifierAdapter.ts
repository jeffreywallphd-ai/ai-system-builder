import type { TokenVerifierPort } from "../../../application/ports/security";
import { createSecurityApplicationError } from "../../../contracts/security";
import { hashToken } from "../shared/hashToken";

export function createLanBearerTokenVerifierAdapter(deps: { findCredentialByTokenHash: (request: { tokenHash: string }) => Promise<any>; tokenHashSecret: string }): TokenVerifierPort {
  return {
    async verifyToken({ token, now }) {
      const found = await deps.findCredentialByTokenHash({ tokenHash: hashToken(token, deps.tokenHashSecret) });
      if (!found) throw createSecurityApplicationError("security.invalid-token", "Invalid token.");
      if (found.revokedAt) throw createSecurityApplicationError("security.revoked-token", "Revoked token.");
      if (found.expiresAt && new Date(found.expiresAt) <= now) throw createSecurityApplicationError("security.expired-token", "Expired token.");
      return {
        authenticated: true,
        authMethod: "lan-pairing-token",
        principal: { principalId: found.deviceId, kind: "device", displayName: found.deviceName, roles: ["paired-device"], scopes: found.scopes },
        issuedAt: found.createdAt,
        expiresAt: found.expiresAt,
      };
    },
  };
}
