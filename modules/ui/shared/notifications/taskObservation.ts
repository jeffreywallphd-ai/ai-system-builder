/** Session-owned observation over existing typed APIs. No data survives unsubscribe. */
export interface TaskObservationScope { workspaceId: string; family: string; requestId?: string }
export interface TaskObservationResult<T> { value: T; activity: "active" | "idle" | "terminal" }
export interface TaskObservationClock {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(timer: unknown): void;
}
interface Entry {
  key: string; family: string; scope: TaskObservationScope;
  read: () => Promise<TaskObservationResult<unknown>>;
  listeners: Set<(result: TaskObservationResult<unknown> | undefined) => void>;
  timer?: unknown; queued: boolean; inFlight: boolean; idle: number; errors: number;
  last?: TaskObservationResult<unknown>;
  readers: Map<(result: TaskObservationResult<unknown> | undefined) => void, () => Promise<TaskObservationResult<unknown>>>;
  owner?: (result: TaskObservationResult<unknown> | undefined) => void; revision: number;
}
export class TaskObservationManager {
  private readonly entries = new Map<string, Entry>();
  private readonly busyFamilies = new Set<string>();
  private readonly queue = new Set<Entry>();
  private readonly pendingReads = new Set<() => void>();
  private visible = true;
  private disposed = false;
  public constructor(private readonly clock: TaskObservationClock = {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
  }) {}

  public subscribe<T>(scope: TaskObservationScope, read: () => Promise<TaskObservationResult<T>>, listener: (result: TaskObservationResult<T> | undefined) => void): () => void {
    if (this.disposed || !scope.workspaceId || !scope.family || Object.values(scope).some((v) => v !== undefined && (typeof v !== "string" || v.length > 512))) throw new Error("Task observation scope is unavailable.");
    const key = JSON.stringify([scope.workspaceId, scope.family, scope.requestId ?? null]);
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= 128) throw new Error("Task observation capacity is unavailable.");
      entry = { key, family: JSON.stringify([scope.workspaceId, scope.family]), scope: { ...scope }, read, listeners: new Set(), readers: new Map(), revision: 0, queued: false, inFlight: false, idle: 0, errors: 0 };
      this.entries.set(key, entry);
    }
    const callback = listener as Entry["listeners"] extends Set<infer L> ? L : never;
    if (entry.listeners.size >= 32) throw new Error("Task subscriber capacity is unavailable.");
    entry.listeners.add(callback);
    entry.readers.set(callback, read);
    entry.owner ??= callback;
    if (entry.last) { try { callback(entry.last); } catch { /* Subscriber failure only. */ } }
    else if (!entry.inFlight && !entry.queued) this.request(entry);
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      entry!.listeners.delete(callback);
      entry!.readers.delete(callback);
      if (entry!.listeners.size) {
        if (entry!.owner === callback) {
          const [owner, nextRead] = entry!.readers.entries().next().value!;
          entry!.owner = owner; entry!.read = nextRead; entry!.revision++; entry!.last = undefined;
          queueMicrotask(() => this.request(entry!));
        }
        return;
      }
      this.clock.clearTimeout(entry!.timer);
      this.queue.delete(entry!);
      if (this.entries.get(key) === entry) this.entries.delete(key);
      // In-flight family ownership remains until its promise settles. Its late
      // result cannot reach a replacement entry or a former workspace subscriber.
    };
  }

  public invalidate(scope: TaskObservationScope): void {
    for (const entry of this.entries.values()) {
      if (entry.scope.workspaceId === scope.workspaceId && entry.scope.family === scope.family && (scope.requestId === undefined || entry.scope.requestId === scope.requestId)) {
        entry.idle = entry.errors = 0;
        this.request(entry);
      }
    }
  }
  /** Page reads share the shell's current flight/snapshot without another loop. */
  public readOnce<T>(scope: TaskObservationScope, read: () => Promise<TaskObservationResult<T>>): Promise<T> {
    if (this.pendingReads.size >= 256) return Promise.reject(new Error("Task observation is busy."));
    return new Promise((resolve, reject) => {
      let stop = () => {}; let finished = false;
      const fail = () => finish(undefined);
      const timer = this.clock.setTimeout(fail, 15_000);
      const finish = (result: TaskObservationResult<T> | undefined) => {
        if (finished) return; finished = true;
        this.clock.clearTimeout(timer); this.pendingReads.delete(fail);
        queueMicrotask(() => stop());
        if (result) resolve(result.value); else reject(new Error("Task progress is temporarily unavailable."));
      };
      this.pendingReads.add(fail);
      try { stop = this.subscribe(scope, read, finish); }
      catch { finish(undefined); }
    });
  }
  public setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    for (const entry of this.entries.values()) {
      this.clock.clearTimeout(entry.timer);
      if (visible) { entry.idle = entry.errors = 0; this.request(entry); }
    }
  }
  public dispose(): void {
    this.disposed = true;
    for (const fail of this.pendingReads) fail();
    for (const entry of this.entries.values()) { this.clock.clearTimeout(entry.timer); entry.listeners.clear(); }
    this.entries.clear(); this.queue.clear();
  }
  public get subscriptionCount(): number { return this.entries.size; }

  private current(entry: Entry): boolean { return !this.disposed && this.entries.get(entry.key) === entry && entry.listeners.size > 0; }
  private request(entry: Entry): void {
    this.clock.clearTimeout(entry.timer);
    if (!this.current(entry)) return;
    entry.queued = true;
    this.queue.add(entry);
    this.pump();
  }
  private pump(): void {
    if (!this.visible || this.disposed) return;
    for (const entry of this.queue) {
      if (!this.current(entry)) { this.queue.delete(entry); continue; }
      if (this.busyFamilies.has(entry.family)) continue;
      this.queue.delete(entry); entry.queued = false; entry.inFlight = true;
      this.busyFamilies.add(entry.family);
      void this.run(entry);
    }
  }
  private async run(entry: Entry): Promise<void> {
    let delay: number | undefined;
    const revision = entry.revision;
    try {
      const result = await entry.read();
      if (!this.current(entry) || entry.revision !== revision) return;
      entry.last = result;
      entry.errors = 0;
      for (const listener of [...entry.listeners]) if (this.current(entry) && entry.listeners.has(listener)) { try { listener(result); } catch { /* A subscriber cannot interrupt another. */ } }
      if (result.activity === "active") { entry.idle = 0; delay = 1000; }
      else if (result.activity === "idle") delay = Math.min(30_000, 1500 * 2 ** Math.min(entry.idle++, 5));
    } catch {
      if (!this.current(entry) || entry.revision !== revision) return;
      delay = Math.min(15_000, 1500 * 2 ** Math.min(entry.errors++, 4));
      for (const listener of [...entry.listeners]) if (this.current(entry) && entry.listeners.has(listener)) { try { listener(undefined); } catch { /* Safe observer failure only. */ } }
    } finally {
      entry.inFlight = false; this.busyFamilies.delete(entry.family);
      if (this.current(entry) && this.visible && !entry.queued && delay !== undefined) entry.timer = this.clock.setTimeout(() => this.request(entry), delay);
      this.pump();
    }
  }
}

export class BoundedTaskIds {
  private readonly ids = new Set<string>();
  public has(id: string): boolean { return this.ids.has(id); }
  public clear(): void { this.ids.clear(); }
  public delete(id: string): void { this.ids.delete(id); }
  public add(id: string): void { this.ids.delete(id); this.ids.add(id); if (this.ids.size > 100) this.ids.delete(this.ids.values().next().value!); }
  public get size(): number { return this.ids.size; }
}
