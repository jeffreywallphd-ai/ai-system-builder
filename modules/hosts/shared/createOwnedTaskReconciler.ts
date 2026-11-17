import { AsyncResource } from "node:async_hooks";
import { OwnedTaskReconcilerService } from "../../application/services/runtime/owned-task-reconciler.service";

/** Capture the accepted request's organization context for every owned callback. */
export function createOwnedTaskReconciler(): OwnedTaskReconcilerService {
  return new OwnedTaskReconcilerService({ bind: (callback) => AsyncResource.bind(callback) });
}
