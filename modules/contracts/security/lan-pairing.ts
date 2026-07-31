import type { SecurityScope } from "./auth-scope";

export interface CompleteLanPairingRequest {
  pairingCode: string;
  deviceName?: string;
  requestedScopes?: SecurityScope[];
}

export interface CompleteLanPairingResult {
  deviceId: string;
  deviceName: string;
  bearerToken: string;
  expiresAt?: string;
  grantedScopes: SecurityScope[];
}

export interface RevokeDeviceTokenRequest {
  deviceId: string;
}

export interface RevokeDeviceTokenResult {
  revoked: boolean;
  deviceId: string;
}
