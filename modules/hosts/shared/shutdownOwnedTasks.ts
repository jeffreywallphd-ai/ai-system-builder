import type { OwnedTaskReconcilerService } from "../../application/services/runtime/owned-task-reconciler.service";

/** Failed worker stops retain task ownership and keep persistence open for retry. */
export async function shutdownOwnedTasks(options: {
  reconciler: OwnedTaskReconcilerService;
  stopPython: () => Promise<void>;
  stopImage: () => Promise<void>;
}): Promise<void> {
  options.reconciler.stopAccepting();
  await options.reconciler.cancelAndReconcile();
  const outcomes = await Promise.allSettled([options.stopPython(), options.stopImage()]);
  const confirmed: ("python" | "image")[] = [];
  if (outcomes[0].status === "fulfilled") confirmed.push("python");
  if (outcomes[1].status === "fulfilled") confirmed.push("image");
  await options.reconciler.settleAfterRuntimeStop(confirmed);
  await options.reconciler.reconcileNow();
  if (outcomes.some((result) => result.status === "rejected") || options.reconciler.status.pending) {
    throw new Error("Background task shutdown reconciliation remains pending.");
  }
  options.reconciler.stopObservation();
}
