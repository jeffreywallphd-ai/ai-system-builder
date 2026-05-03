import type {
  PowerSuspensionBlockerContext,
  PowerSuspensionBlockerPort,
  PowerSuspensionBlockerRecord,
} from "../../../application/ports/desktop";

interface ElectronPowerSaveBlockerLike {
  start: (type: "prevent-app-suspension") => number;
  stop: (id: number) => void;
  isStarted: (id: number) => boolean;
}

export interface CreateElectronPowerSuspensionBlockerOptions {
  powerSaveBlocker?: ElectronPowerSaveBlockerLike;
  createBlockerId?: () => string;
}

interface StoredBlocker {
  blockerId: string;
  reason: string;
  requestId?: string;
  taskType?: string;
  electronBlockerId: number;
}

export function createElectronPowerSuspensionBlocker(
  options: CreateElectronPowerSuspensionBlockerOptions = {},
): PowerSuspensionBlockerPort {
  const powerSaveBlocker = options.powerSaveBlocker;
  const createBlockerId = options.createBlockerId ?? (() => `psb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const blockers = new Map<string, StoredBlocker>();

  const requirePowerSaveBlocker = (): ElectronPowerSaveBlockerLike => {
    if (powerSaveBlocker) {
      return powerSaveBlocker;
    }

    throw new Error("Electron powerSaveBlocker is unavailable in this host.");
  };

  const toRecord = (blocker: StoredBlocker): PowerSuspensionBlockerRecord => ({
    blockerId: blocker.blockerId,
    reason: blocker.reason,
    requestId: blocker.requestId,
    taskType: blocker.taskType,
    active: requirePowerSaveBlocker().isStarted(blocker.electronBlockerId),
  });

  return {
    async startBlocker(reason, context) {
      const blockerApi = requirePowerSaveBlocker();
      const blockerId = createBlockerId();
      const electronBlockerId = blockerApi.start("prevent-app-suspension");
      const record: StoredBlocker = {
        blockerId,
        reason,
        electronBlockerId,
        requestId: context?.requestId,
        taskType: context?.taskType,
      };
      blockers.set(blockerId, record);

      return {
        blockerId,
        active: blockerApi.isStarted(electronBlockerId),
      };
    },

    async stopBlocker(blockerId) {
      const blockerApi = requirePowerSaveBlocker();
      const blocker = blockers.get(blockerId);
      if (!blocker) {
        return { blockerId, active: false };
      }

      const isActive = blockerApi.isStarted(blocker.electronBlockerId);
      if (isActive) {
        blockerApi.stop(blocker.electronBlockerId);
      }
      blockers.delete(blockerId);

      return { blockerId, active: false };
    },

    async listBlockers() {
      const records: PowerSuspensionBlockerRecord[] = [];
      for (const blocker of blockers.values()) {
        const record = toRecord(blocker);
        if (record.active) {
          records.push(record);
        }
      }
      return records;
    },
  };
}
