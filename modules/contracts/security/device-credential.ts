import type { SecurityScope } from "./auth-scope";

export type TokenHashAlgorithm = "sha256" | "hmac-sha256";

export interface PairedDeviceCredentialRecord {
  deviceId: string;
  deviceName: string;
  tokenHash: string;
  tokenHashAlgorithm: TokenHashAlgorithm;
  scopes: SecurityScope[];
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
}
