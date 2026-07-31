import type {
  RuntimeCapabilityId,
  RuntimeCapabilityStatus,
  RuntimeReadinessSnapshot,
} from "../../../contracts/runtime";

export interface RuntimeReadinessPort {
  getReadinessSnapshot(): Promise<RuntimeReadinessSnapshot>;
  getCapabilityStatus(capabilityId: RuntimeCapabilityId): Promise<RuntimeCapabilityStatus>;
}
