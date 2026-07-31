import { createTransportOperation } from "../transport";

export const API_SYSTEM_REVIEW_OPERATIONS = {
  describe: createTransportOperation("system-review", "describe"),
  browse: createTransportOperation("system-review", "browse"),
  detail: createTransportOperation("system-review", "detail"),
  preview: createTransportOperation("system-review", "preview"),
  listAudit: createTransportOperation("system-review", "list-audit"),
} as const;
