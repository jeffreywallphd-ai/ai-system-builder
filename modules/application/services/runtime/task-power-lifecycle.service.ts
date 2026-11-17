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

  private readonly cleanup = new Map<string, Promise<void>>();
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly starts = new Map<string, Promise<void>>();
  public constructor(private readonly powerSuspension: PowerSuspensionBlockerPort, private readonly clock: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } = { setTimeout, clearTimeout }) {}

  public async startTask(requestId: string, taskType: TaskType, reason: string = taskType): Promise<void> {
    if (!requestId) return;
    const existing = this.starts.get(requestId);
    if (existing) return existing;
    const operation = this.startOwnedBlocker(requestId, taskType, reason);
    this.starts.set(requestId, operation);
    try { await operation; } finally { this.starts.delete(requestId); }
  }

  private async startOwnedBlocker(requestId: string, taskType: TaskType, reason: string): Promise<void> {
    await this.completeTask(requestId, "unknown");
    if (this.blockerIdsByRequestId.has(requestId) || this.blockerIdsByRequestId.size >= 256) return;

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

    const existing = this.cleanup.get(requestId);
    if (existing) return existing;
    const blockerId = this.blockerIdsByRequestId.get(requestId);
    if (!blockerId) return;
    this.clock.clearTimeout(this.retries.get(requestId)); this.retries.delete(requestId);
    const operation = (async () => {
      try {
        await this.powerSuspension.stopBlocker(blockerId);
        if (this.blockerIdsByRequestId.get(requestId) === blockerId) this.blockerIdsByRequestId.delete(requestId);
      } catch {
        // Keep ownership until the adapter confirms release. Retry independently
        // of renderer/feature reads and never forget an outstanding OS lease.
        const timer = this.clock.setTimeout(() => void this.completeTask(requestId, status), 1000);
        timer.unref?.(); this.retries.set(requestId, timer);
      }
    })();
    this.cleanup.set(requestId, operation);
    try { await operation; } finally { this.cleanup.delete(requestId); }
  }
  public get pendingCleanupCount(): number { return this.retries.size; }
}
