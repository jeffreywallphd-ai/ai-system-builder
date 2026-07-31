import type { PairedDeviceCredentialRecord } from "../../../contracts/security";

export interface DeviceCredentialStorePort {
  saveDeviceCredential(record: PairedDeviceCredentialRecord): Promise<void>;
  findActiveDeviceCredentialByTokenHash(request: { tokenHash: string; now: Date }): Promise<PairedDeviceCredentialRecord | undefined>;
  findDeviceCredentialByTokenHash(request: { tokenHash: string }): Promise<PairedDeviceCredentialRecord | undefined>;
  revokeDevice(request: { deviceId: string; revokedAt: Date }): Promise<boolean>;
  countActiveDevices(request: { now: Date }): Promise<number>;
}
