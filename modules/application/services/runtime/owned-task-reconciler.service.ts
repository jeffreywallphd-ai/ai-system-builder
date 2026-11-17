/** Internal host ownership only; callbacks cannot discover or start tasks. */
export interface OwnedTaskLease {
  start(reconcile: () => Promise<boolean>, cancel: () => Promise<unknown>, afterRuntimeStopped?: () => Promise<void>): void;
  release(): void;
}
interface OwnedTask {
  runtime: "python" | "image";
  reconcile?: () => Promise<boolean>; cancel?: () => Promise<unknown>; afterRuntimeStopped?: () => Promise<void>;
  timer?: ReturnType<typeof setTimeout>; operation?: Promise<void>; failures: number;
}
export class OwnedTaskReconcilerService {
  private readonly tasks = new Set<OwnedTask>();
  private accepting = true;
  private observing = true;
  private readonly stoppedRuntimes = new Set<OwnedTask["runtime"]>();
  public constructor(private readonly options: {
    bind?: <T extends (...args: any[]) => any>(callback: T) => T;
    setTimeout?: typeof setTimeout; clearTimeout?: typeof clearTimeout;
  } = {}) {}

  /** Reserve before dispatch; capacity/shutdown denial never follows task start. */
  public reserve(runtime: OwnedTask["runtime"] = "python"): OwnedTaskLease {
    this.assertAccepting();
    if (this.tasks.size >= 256) throw new Error("Background task lifecycle is unavailable.");
    const task: OwnedTask = { runtime, failures: 0 }; this.tasks.add(task);
    return {
      start: (reconcile, cancel, afterRuntimeStopped) => {
        if (!this.tasks.has(task) || task.reconcile) throw new Error("Background task lease is unavailable.");
        task.reconcile = this.options.bind?.(reconcile) ?? reconcile;
        task.cancel = this.options.bind?.(cancel) ?? cancel;
        task.afterRuntimeStopped = afterRuntimeStopped ? this.options.bind?.(afterRuntimeStopped) ?? afterRuntimeStopped : undefined;
        if (this.stoppedRuntimes.has(runtime)) void this.reconcile(task);
        else if (this.accepting) this.schedule(task);
        else void this.cancelTask(task);
      },
      release: () => this.release(task),
    };
  }
  public stopAccepting(): void { this.accepting = false; }
  public async withLease<T>(runtime: OwnedTask["runtime"], operation: (lease: OwnedTaskLease) => Promise<T>): Promise<T> {
    const lease = this.reserve(runtime); let started = false;
    try { return await operation({ release: () => lease.release(), start: (...callbacks) => { lease.start(...callbacks); started = true; } }); }
    finally { if (!started) lease.release(); }
  }
  public assertAccepting(): void { if (!this.accepting) throw new Error("Background task lifecycle is unavailable."); }
  public stopObservation(): void {
    this.observing = false;
    for (const task of this.tasks) (this.options.clearTimeout ?? clearTimeout)(task.timer);
  }
  public async reconcileNow(): Promise<void> {
    // Bounded batches; each request also has one shared in-flight operation.
    const tasks = [...this.tasks];
    for (let at = 0; at < tasks.length; at += 8) await Promise.all(tasks.slice(at, at + 8).map((task) => this.reconcile(task)));
  }
  public async cancelAndReconcile(): Promise<{ pending: number; retrying: number }> {
    this.stopAccepting();
    const tasks = [...this.tasks];
    for (let at = 0; at < tasks.length; at += 8) await Promise.all(tasks.slice(at, at + 8).map((task) => this.cancelTask(task)));
    return this.status;
  }
  /** Host supplies only workers whose stop has actually succeeded. */
  public async settleAfterRuntimeStop(runtimes: readonly OwnedTask["runtime"][] = ["python", "image"]): Promise<void> {
    this.stopAccepting();
    for (const runtime of runtimes) this.stoppedRuntimes.add(runtime);
    for (const task of [...this.tasks]) {
      if (!this.stoppedRuntimes.has(task.runtime) || !task.afterRuntimeStopped) continue;
      await task.operation;
      if (!this.tasks.has(task)) continue;
      await this.reconcile(task);
    }
  }
  public get status(): { pending: number; retrying: number } { return { pending: this.tasks.size, retrying: [...this.tasks].filter((task) => task.failures > 0).length }; }
  private release(task: OwnedTask): void {
    (this.options.clearTimeout ?? clearTimeout)(task.timer);
    this.tasks.delete(task);
  }
  private schedule(task: OwnedTask): void {
    if (!this.observing || !this.tasks.has(task) || !task.reconcile) return;
    (this.options.clearTimeout ?? clearTimeout)(task.timer);
    task.timer = (this.options.setTimeout ?? setTimeout)(() => void this.reconcile(task), Math.min(15_000, 1000 * 2 ** Math.min(task.failures, 4)));
    task.timer.unref?.();
  }
  private async reconcile(task: OwnedTask): Promise<void> {
    if (!this.tasks.has(task) || !task.reconcile) return;
    if (task.operation) return task.operation;
    task.operation = (async () => {
      try {
        if (this.stoppedRuntimes.has(task.runtime) && task.afterRuntimeStopped) {
          await task.afterRuntimeStopped(); this.release(task);
        } else if (await task.reconcile!()) this.release(task);
        else task.failures = 0;
      } catch { task.failures++; }
    })();
    try { await task.operation; }
    finally { task.operation = undefined; this.schedule(task); }
  }
  private async cancelTask(task: OwnedTask): Promise<void> {
    try { await task.cancel?.(); } catch { task.failures++; }
    await this.reconcile(task);
  }
}
