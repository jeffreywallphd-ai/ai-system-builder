import type { SecurityScope } from "../../../contracts/security";

export type PairingCodeStatus = "valid" | "invalid" | "expired" | "disabled" | "already-used";

export interface ConsumePairingCodeResult {
  status: PairingCodeStatus;
  defaultDeviceName?: string;
  defaultScopes?: SecurityScope[];
  expiresAt?: string;
}

export interface PairingCodeStorePort {
  consumePairingCode(request: { pairingCode: string; now: Date }): Promise<ConsumePairingCodeResult>;
}
