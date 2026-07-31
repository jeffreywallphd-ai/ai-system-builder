import { createTransportOperation } from "../transport";

export const API_SYSTEM_RUN_WORKFLOW_OPERATIONS = {
  listProfiles: createTransportOperation("system-run-workflow", "list-profiles"),
  prepare: createTransportOperation("system-run-workflow", "prepare"),
  invoke: createTransportOperation("system-run-workflow", "invoke"),
} as const;
