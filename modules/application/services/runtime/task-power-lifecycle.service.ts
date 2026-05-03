import type { RuntimeTaskStatus, TaskType } from "../../../contracts/runtime";
import type { PowerSuspensionBlockerPort } from "../../ports/desktop";

const TERMINAL_STATUSES: ReadonlySet<RuntimeTaskStatus> = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
]);

export interface TaskPowerLifecyclePort {
  startTask(requestId: string, taskType: TaskType, reason?: string): Promise<void>;
  completeTask(requestId: string, status: RuntimeTaskStatus): Promise<void>;
}

export class TaskPowerLifecycleService implements TaskPowerLifecyclePort {
  private readonly blockerIdsByRequestId = new Map<string, string>();

  public constructor(private readonly powerSuspension: PowerSuspensionBlockerPort) {}

  public async startTask(requestId: string, taskType: TaskType, reason: string = taskType): Promise<void> {
    if (!requestId) {
      return;
    }

    await this.completeTask(requestId, "unknown");

    try {
      const blocker = await this.powerSuspension.startBlocker(reason, { requestId, taskType });
      this.blockerIdsByRequestId.set(requestId, blocker.blockerId);
    } catch {
      // Blocker startup failures must not fail tasks.
    }
  }

  public async completeTask(requestId: string, status: RuntimeTaskStatus): Promise<void> {
    if (!requestId || !TERMINAL_STATUSES.has(status)) {
      return;
    }

    const blockerId = this.blockerIdsByRequestId.get(requestId);
    this.blockerIdsByRequestId.delete(requestId);
    if (!blockerId) {
      return;
    }

    try {
      await this.powerSuspension.stopBlocker(blockerId);
    } catch {
      // Blocker teardown failures must not fail lifecycle cleanup.
    }

    // TODO: Add push/event-driven completion hooks so blocker cleanup never depends on polling paths.
  }
}
