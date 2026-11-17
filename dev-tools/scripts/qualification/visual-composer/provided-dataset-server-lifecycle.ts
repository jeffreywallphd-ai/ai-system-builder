import path from "node:path";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { shutdownServerResources } from "../../../../apps/server/src/shutdownServerResources";

export interface QualificationServerResources {
  listener: { close(callback: (error?: Error) => void): unknown };
  shutdownBackgroundTasks(): Promise<void>;
  closePersistence(): Promise<void>;
}

export async function requireProvidedDatasetRoot(repoRoot: string, runtimeRoot: string): Promise<void> {
  if (!path.isAbsolute(repoRoot) || !path.isAbsolute(runtimeRoot) ||
      path.resolve(repoRoot) !== repoRoot || path.resolve(runtimeRoot) !== runtimeRoot) throw new Error("Qualification root is unavailable.");
  const allowed = path.join(repoRoot, "artifacts/qualification/visual-composer/d");
  const relative = path.relative(allowed, runtimeRoot);
  if (!/^[a-f0-9]{16}[\\/]thin-runtime$/.test(relative)) throw new Error("Qualification root is unavailable.");
  // Ancestors must exist and be regular; only the exact owned leaf may be created.
  const components = path.relative(repoRoot, runtimeRoot).split(path.sep);
  for (let i = 0; i <= components.length; i++) {
    const item = path.join(repoRoot, ...components.slice(0, i));
    if (i === components.length) await mkdir(item, { recursive: false }).catch(error => { if (error.code !== "EEXIST") throw error; });
    const info = await lstat(item);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(item) !== item) throw new Error("Qualification root is unavailable.");
  }
}

// One serialized owner; a failed close retains the old resources and denies a
// second composition. An exit request is never physical worker retirement proof.
export function createProvidedDatasetServerLifecycle(create: (restart: () => void) => Promise<QualificationServerResources>) {
  let active: QualificationServerResources | undefined;
  let pending = Promise.resolve();
  let failed = false;
  let stopping = false;
  const close = async () => {
    if (active) { await shutdownServerResources(active); active = undefined; }
  };
  const start = async () => {
    if (failed || stopping || active) throw new Error("Qualification server is unavailable.");
    active = await create(restart);
  };
  const queue = (operation: () => Promise<void>) => {
    pending = pending.then(operation).catch(() => { failed = true; throw new Error("Qualification server transition remains pending."); });
    // Attach a rejection handler for asynchronous restart callbacks; callers of
    // settled/start/stop still receive the failure and no fresh owner is opened.
    void pending.catch(() => undefined);
    return pending;
  };
  const restart = () => { if (!stopping) void queue(async () => { await close(); await start(); }); };
  return {
    start: () => queue(start),
    restart,
    stop: () => { stopping = true; return queue(close); },
    settled: () => pending,
  };
}
