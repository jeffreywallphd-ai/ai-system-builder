import type { AuthPrincipal, PairedDeviceCredentialRecord } from "../../contracts/security";

export function isDeviceCredentialActive(record: PairedDeviceCredentialRecord, now: Date): boolean {
  if (record.revokedAt) {
    return false;
  }

  if (record.expiresAt && new Date(record.expiresAt).getTime() <= now.getTime()) {
    return false;
  }

  return true;
}

export function revokeDeviceCredential(
  record: PairedDeviceCredentialRecord,
  revokedAt: Date,
): PairedDeviceCredentialRecord {
  return {
    ...record,
    revokedAt: revokedAt.toISOString(),
  };
}

export function createDevicePrincipal(record: PairedDeviceCredentialRecord): AuthPrincipal {
  return {
    principalId: record.deviceId,
    kind: "device",
    displayName: record.deviceName,
    roles: [],
    scopes: [...record.scopes],
  };
}
