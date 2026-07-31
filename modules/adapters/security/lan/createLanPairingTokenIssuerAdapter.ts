import type { TokenIssuerPort } from "../../../application/ports/security";
import { hashToken } from "../shared/hashToken";
import { secureRandomBase64Url } from "../shared/secureRandom";

export function createLanPairingTokenIssuerAdapter(tokenHashSecret: string): TokenIssuerPort {
  return {
    async issueDeviceToken() {
      const token = secureRandomBase64Url(32);
      return { token, tokenHash: hashToken(token, tokenHashSecret), tokenHashAlgorithm: "sha256" };
    },
  };
}
