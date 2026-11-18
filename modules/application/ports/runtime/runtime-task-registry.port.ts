import type {
  CancelRuntimeTaskResult,
  RuntimeTaskListRequest,
  RuntimeTaskListResult,
  RuntimeTaskStatusRecord,
  StartRuntimeTaskRequest,
  StartRuntimeTaskResult,
} from "../../../contracts/runtime";

/** Unavailable proves no business task dispatch; thrown/unknown outcomes do not. */
export type InstalledRuntimeTaskStart =
  | { kind: "accepted"; value: StartRuntimeTaskResult }
  | { kind: "unavailable" }
  | { kind: "unconfirmed" };

export interface RuntimeTaskRegistryPort {
  startTask(request: StartRuntimeTaskRequest): Promise<StartRuntimeTaskResult>;
  /** Internal existing-environment capability, never a client install-policy flag. */
  startTaskWithoutInstalling?(request: StartRuntimeTaskRequest): Promise<InstalledRuntimeTaskStart>;
  getTaskStatus(requestId: string): Promise<RuntimeTaskStatusRecord>;
  cancelTask(requestId: string): Promise<CancelRuntimeTaskResult>;
  listTasks(request: RuntimeTaskListRequest): Promise<RuntimeTaskListResult>;
}
