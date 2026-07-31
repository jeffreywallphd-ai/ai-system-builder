import { createTransportOperation } from "../transport";

export const API_SYSTEM_DATA_OPERATIONS = {
  describe: createTransportOperation("system-data", "describe"),
  create: createTransportOperation("system-data", "create"),
  read: createTransportOperation("system-data", "read"),
  update: createTransportOperation("system-data", "update"),
  list: createTransportOperation("system-data", "list"),
  listAudit: createTransportOperation("system-data", "list-audit"),
} as const;
