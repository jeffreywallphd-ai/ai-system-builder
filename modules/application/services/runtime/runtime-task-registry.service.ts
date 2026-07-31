import type {
  CancelRuntimeTaskResult,
  RuntimeTaskRecord,
  RuntimeTaskStatusRecord,
  RuntimeTaskStatus,
  StartRuntimeTaskRequest,
  StartRuntimeTaskResult,
  TaskType,
} from "../../../contracts/runtime";
import type { RuntimeTaskRegistryPort } from "../../ports/runtime";
import type { TaskPowerLifecyclePort } from "./task-power-lifecycle.service";

const TERMINAL_STATUSES: ReadonlySet<RuntimeTaskStatus> = new Set(["succeeded", "failed", "cancelled", "unknown"]);

function isRuntimeTaskRecord(record: RuntimeTaskStatusRecord): record is RuntimeTaskRecord {
  return !("recordType" in record);
}

export interface RuntimeTaskRegistryLifecycleHooks {
  onStarted?: (requestId: string, taskType: TaskType) => Promise<void>;
  onTerminal?: (record: RuntimeTaskRecord) => Promise<void>;
}

export class RuntimeTaskRegistryService {
  public constructor(
    private readonly taskRegistry: RuntimeTaskRegistryPort,
    private readonly taskPowerLifecycle?: TaskPowerLifecyclePort,
  ) {}
  // This service owns task power lifecycle only for flows migrated to RuntimeTaskRegistryService.
  // Use cases not yet migrated must continue direct lifecycle handling and must not double-call this helper.

  public async startAndAttachLifecycle(
    request: StartRuntimeTaskRequest,
    hooks?: RuntimeTaskRegistryLifecycleHooks,
  ): Promise<StartRuntimeTaskResult> {
    const result = await this.taskRegistry.startTask(request);

    try {
      await this.taskPowerLifecycle?.startTask(result.requestId, request.taskType);
    } catch {
      // Power blocker startup failures must not fail task start.
    }

    try {
      await hooks?.onStarted?.(result.requestId, request.taskType);
    } catch {
      // Hook failures must not fail task start.
    }

    return result;
  }

  public async safeCancel(requestId: string): Promise<CancelRuntimeTaskResult | undefined> {
    try {
      const result = await this.taskRegistry.cancelTask(requestId);
      if (TERMINAL_STATUSES.has(result.status)) {
        await this.completeLifecycle(requestId, result.status);
      }
      return result;
    } catch {
      return undefined;
    }
  }

  public async readTaskAndCompleteLifecycleIfTerminal(
    requestId: string,
    hooks?: RuntimeTaskRegistryLifecycleHooks,
  ): Promise<RuntimeTaskStatusRecord> {
    const record = await this.taskRegistry.getTaskStatus(requestId);
    if (TERMINAL_STATUSES.has(record.status)) {
      await this.completeLifecycle(requestId, record.status);
      try {
        if (isRuntimeTaskRecord(record)) {
          await hooks?.onTerminal?.(record);
        }
      } catch {
        // Hook failures must not fail terminal reads.
      }
    }
    return record;
  }

  private async completeLifecycle(requestId: string, status: RuntimeTaskStatus): Promise<void> {
    try {
      await this.taskPowerLifecycle?.completeTask(requestId, status);
    } catch {
      // Power blocker cleanup failures must not fail lifecycle operations.
    }
  }
}
