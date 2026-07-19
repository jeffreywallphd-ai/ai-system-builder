import { createTransportOperation } from "../transport";

export const API_SYSTEM_BUILDER_OPERATIONS = {
  create: createTransportOperation("system-builder", "create"),
  listTemplates: createTransportOperation("system-builder", "list-templates"),
  createFromTemplate: createTransportOperation(
    "system-builder",
    "create-from-template",
  ),
  list: createTransportOperation("system-builder", "list"),
  listManagement: createTransportOperation("system-builder", "list-management"),
  read: createTransportOperation("system-builder", "read"),
  rename: createTransportOperation("system-builder", "rename"),
  archive: createTransportOperation("system-builder", "archive"),
  restore: createTransportOperation("system-builder", "restore"),
  clone: createTransportOperation("system-builder", "clone"),
  saveRevision: createTransportOperation("system-builder", "save-revision"),
  readRevision: createTransportOperation("system-builder", "read-revision"),
  listRevisions: createTransportOperation("system-builder", "list-revisions"),
  listComposerAssets: createTransportOperation(
    "system-builder",
    "list-composer-assets",
  ),
} as const;
