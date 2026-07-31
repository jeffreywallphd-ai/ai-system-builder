import { createTransportOperation } from "../transport";

export const API_SYSTEM_DEPLOYMENT_OPERATIONS = {
  lifecycleRead: createTransportOperation("system-deployment", "lifecycle-read"),
  lifecycleInvoke: createTransportOperation("system-deployment", "lifecycle-invoke"),
  install: createTransportOperation("system-deployment", "install"),
  activate: createTransportOperation("system-deployment", "activate"),
  health: createTransportOperation("system-deployment", "health"),
  rollback: createTransportOperation("system-deployment", "rollback"),
  revoke: createTransportOperation("system-deployment", "revoke"),
  read: createTransportOperation("system-deployment", "read"),
  list: createTransportOperation("system-deployment", "list"),
  startRun: createTransportOperation("system-deployment", "start-run"),
  cancelRun: createTransportOperation("system-deployment", "cancel-run"),
  listRuns: createTransportOperation("system-deployment", "list-runs"),
  listAudit: createTransportOperation("system-deployment", "list-audit"),
} as const;
