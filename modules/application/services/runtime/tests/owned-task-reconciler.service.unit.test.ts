import assert from "node:assert/strict";
import { test } from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { OwnedTaskReconcilerService } from "../owned-task-reconciler.service";
import { createOwnedTaskReconciler } from "../../../../hosts/shared/createOwnedTaskReconciler";
import { shutdownOwnedTasks } from "../../../../hosts/shared/shutdownOwnedTasks";

test("owned reconciliation is single-flight, retries failures and does not require a renderer", async () => {
  const service = new OwnedTaskReconcilerService(); let calls = 0; let releases = 0;
  let release!: () => void; const barrier = new Promise<void>((resolve) => { release = resolve; });
  service.reserve().start(async () => { calls++; await barrier; if (calls === 1) throw new Error("transient read"); releases++; return true; }, async () => {});
  const a = service.reconcileNow(), b = service.reconcileNow(); release(); await Promise.all([a, b]);
  assert.equal(calls, 1); assert.deepEqual(service.status, { pending: 1, retrying: 1 });
  await service.reconcileNow(); await service.reconcileNow();
  assert.equal(releases, 1); assert.equal(service.status.pending, 0);
});

test("shutdown denies starts before cancellation, preserves unfinished evidence and drains terminal work", async () => {
  const service = new OwnedTaskReconcilerService(); let cancelled = 0;
  service.reserve().start(async () => cancelled === 1, async () => { cancelled++; });
  assert.deepEqual(await service.cancelAndReconcile(), { pending: 0, retrying: 0 });
  assert.throws(() => service.reserve(), /unavailable/);
  const pending = new OwnedTaskReconcilerService(); const lease = pending.reserve();
  await pending.cancelAndReconcile();
  lease.start(async () => true, async () => {});
  await pending.reconcileNow(); assert.equal(pending.status.pending, 0);
});

test("host callbacks keep the accepted organization context during another request's reconciliation", async () => {
  const contexts = new AsyncLocalStorage<string>(); const service = createOwnedTaskReconciler(); const seen: unknown[] = [];
  for (const org of ["org-a", "org-b"]) contexts.run(org, () => service.reserve().start(async () => { await Promise.resolve(); seen.push(contexts.getStore()); return true; }, async () => {}));
  await contexts.run("foreign", () => service.reconcileNow());
  assert.deepEqual(seen.sort(), ["org-a", "org-b"]);
});

test("shutdown attempts both workers and settles only confirmed stops; failed cleanup and late acceptance retry", async () => {
  const service = new OwnedTaskReconcilerService(); let pythonCleaned = 0, imageCleaned = 0, imageStops = 0;
  service.reserve().start(async () => false, async () => {}, async () => { pythonCleaned++; });
  service.reserve("image").start(async () => false, async () => {}, async () => { if (++imageCleaned === 1) throw new Error("retry cleanup"); });
  const late = service.reserve("image");
  await assert.rejects(shutdownOwnedTasks({ reconciler: service, stopPython: async () => { throw new Error("retry stop"); }, stopImage: async () => { imageStops++; } }), /pending/);
  assert.equal(pythonCleaned, 0); assert.equal(imageStops, 1); assert.ok(service.status.pending > 0);
  let lateCleaned = 0;
  late.start(async () => false, async () => {}, async () => { lateCleaned++; });
  await shutdownOwnedTasks({ reconciler: service, stopPython: async () => {}, stopImage: async () => { imageStops++; } });
  assert.equal(lateCleaned, 1); assert.equal(pythonCleaned, 1); assert.equal(service.status.pending, 0);
});
