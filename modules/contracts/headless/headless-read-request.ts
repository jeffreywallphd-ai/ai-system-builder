import { isSystemBuilderSystemId, type SystemBuilderSystemId } from "../system-builder";
import { isWorkspaceId, type WorkspaceId } from "../workspace";
import { normalizeIngestionTaskId } from "../ingestion";
import { hasKnownPassiveCredential, copyBoundedPassiveData } from "../shared";
import type { HeadlessIngestionStatusRequest } from "./headless-data-task-status";
import { normalizeDatasetId, normalizeDatasetVersionId } from "../dataset";
import type { HeadlessDatasetMetadataRequest } from "./headless-dataset-metadata";
import { HEADLESS_DATASET_VERSION_READ_LIMIT } from "./headless-dataset-metadata";
import {readHeadlessDatasetPreparationRequest, type HeadlessDatasetPreparationRequest} from "./headless-dataset-preparation";
import {readHeadlessDatasetTaskStatusRequest, type HeadlessDatasetTaskStatusRequest} from "./headless-dataset-task-status";
import {readHeadlessDatasetTaskReviewRequest, type HeadlessDatasetTaskReviewRequest} from "./headless-dataset-task-review";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";
export {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";

import {readHeadlessContextReadRequest, type HeadlessContextReadRequest} from "./headless-context-preview";
import {readHeadlessContextTaskRequest, type HeadlessContextTaskRequest} from "./headless-context-task";
import {readHeadlessContextSavedRequest, type HeadlessContextSavedRequest} from "./headless-context-result-plan";
import {readHeadlessContextRebuildRequest, type HeadlessContextRebuildRequest} from "./headless-context-rebuild";
import {readHeadlessContextQueryPreviewRequest, type HeadlessContextQueryPreviewRequest} from "./headless-context-query-preview";

export const HEADLESS_DATA_READ_OPERATIONS = Object.freeze([
  "data.ingestion-status", "data.dataset-versions", "data.compare-dataset-versions", "data.preview-dataset-preparation", "data.dataset-task-status", "data.dataset-task-review",
] as const);
export function isHeadlessDataReadOperation(value: unknown): value is typeof HEADLESS_DATA_READ_OPERATIONS[number] {
  return HEADLESS_DATA_READ_OPERATIONS.some(operation => operation === value);
}

export const HEADLESS_READ_OPERATIONS = Object.freeze([
  "host.describe",
  "workspaces.list",
  "systems.list",
  "systems.read",
  "templates.list",
  "systems.snapshot",
  "systems.changes",
  "workflows.list",
  "workflows.prepare",
  "conversation-tasks.read",
  "plan.capabilities",
  ...HEADLESS_DATA_READ_OPERATIONS,
  "context.models", "context.preview-generation", "context.task", "context.saved", "context.preview-rebuild", "context.preview-query",
] as const);

export type HeadlessReadOperation = (typeof HEADLESS_READ_OPERATIONS)[number];

type HostTarget = {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
};

type WorkspaceTarget = HostTarget & {
  readonly workspaceId: WorkspaceId;
};

export type HeadlessChangeCursor = HostTarget & {
  readonly sequence: number;
  readonly scopeTag: string;
};

export const HEADLESS_WORKFLOW_SOURCE_KINDS = ["approved-release", "reviewed-execution-plan"] as const;
export type HeadlessWorkflowSourceKind = typeof HEADLESS_WORKFLOW_SOURCE_KINDS[number];
export type HeadlessWorkflowSource =
  | { readonly kind: "approved-release"; readonly sourceId: string; readonly sourceDigest: string }
  | { readonly kind: "reviewed-execution-plan"; readonly sourceId: string; readonly sourceRevision: string };

type ReadRequest<Operation extends HeadlessReadOperation, Input> = {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: Operation;
  readonly input: Readonly<Input>;
};

export type HeadlessReadRequest =
  | HeadlessContextQueryPreviewRequest
  | HeadlessContextRebuildRequest
  | HeadlessContextSavedRequest
  | HeadlessContextReadRequest
  | HeadlessContextTaskRequest
  | HeadlessIngestionStatusRequest
  | HeadlessDatasetMetadataRequest
  | HeadlessDatasetPreparationRequest
  | HeadlessDatasetTaskStatusRequest
  | HeadlessDatasetTaskReviewRequest
  | ReadRequest<"host.describe", Record<string, never>>
  | ReadRequest<"workspaces.list", HostTarget>
  | ReadRequest<"systems.list", WorkspaceTarget>
  | ReadRequest<"templates.list", WorkspaceTarget>
  | ReadRequest<"systems.snapshot", WorkspaceTarget>
  | ReadRequest<"systems.changes", WorkspaceTarget & { readonly cursor: HeadlessChangeCursor }>
  | ReadRequest<"workflows.list", WorkspaceTarget & { readonly sourceKind: HeadlessWorkflowSourceKind }>
  | ReadRequest<"workflows.prepare", WorkspaceTarget & { readonly profileId: string; readonly source: HeadlessWorkflowSource }>
  | ReadRequest<"conversation-tasks.read", WorkspaceTarget & { readonly sessionId: string; readonly turnId: string }>
  | ReadRequest<"plan.capabilities", WorkspaceTarget>
  | ReadRequest<"systems.read", WorkspaceTarget & { readonly systemId: SystemBuilderSystemId }>;

export type HeadlessReadRequestParseResult =
  | { readonly ok: true; readonly request: HeadlessReadRequest }
  | {
      readonly ok: false;
      readonly code:
        | "headless.invalid-request"
        | "headless.unsupported-version"
        | "headless.unsupported-operation"
        | "headless.host-changed";
    };

function exactDataRecord(value: unknown, names: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== names.length || keys.some((key) => typeof key !== "string" || !names.includes(key))) {
      return undefined;
    }
    const record: Record<string, unknown> = Object.create(null);
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) return undefined;
      record[name] = descriptor.value;
    }
    return record;
  } catch {
    return undefined;
  }
}

function isHeadlessReadOperation(value: unknown): value is HeadlessReadOperation {
  return typeof value === "string" &&
    HEADLESS_READ_OPERATIONS.some((operation) => operation === value);
}

export function parseHeadlessChangeCursor(value: unknown): HeadlessChangeCursor | undefined {
  const cursor = exactDataRecord(value, ["hostIncarnationId", "sequence", "scopeTag"]);
  if (!cursor) return undefined;
  const { hostIncarnationId, sequence, scopeTag } = cursor;
  return isHeadlessHostIncarnationId(hostIncarnationId) && typeof sequence === "number" &&
    Number.isSafeInteger(sequence) && sequence >= 0 && typeof scopeTag === "string" && scopeTag.length === 64 &&
    /^[a-f0-9]{64}$/.test(scopeTag)
    ? { hostIncarnationId, sequence, scopeTag } : undefined;
}

export function isHeadlessWorkflowId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(value) &&
    !/[\r\n]/.test(value) && !value.includes("..");
}

function parseWorkflowSource(value: unknown): HeadlessWorkflowSource | undefined {
  const release = exactDataRecord(value, ["kind", "sourceId", "sourceDigest"]);
  if (release?.kind === "approved-release" && isHeadlessWorkflowId(release.sourceId) &&
      typeof release.sourceDigest === "string" && release.sourceDigest.length === 71 && /^sha256:[a-f0-9]{64}$/.test(release.sourceDigest))
    return { kind: "approved-release", sourceId: release.sourceId, sourceDigest: release.sourceDigest };
  const plan = exactDataRecord(value, ["kind", "sourceId", "sourceRevision"]);
  if (plan?.kind === "reviewed-execution-plan" && isHeadlessWorkflowId(plan.sourceId) && isHeadlessWorkflowId(plan.sourceRevision))
    return { kind: "reviewed-execution-plan", sourceId: plan.sourceId, sourceRevision: plan.sourceRevision };
  return undefined;
}

const invalid = (): HeadlessReadRequestParseResult => ({ ok: false, code: "headless.invalid-request" });

/**
 * Parse an already bounded, decoded request. Transport framing, authentication
 * and current workspace authorization belong to the owning host. This parser
 * does not grant access or advertise any operation as ready.
 */
export function parseHeadlessReadRequest(
  value: unknown,
  currentHost: HeadlessHostIncarnationId,
): HeadlessReadRequestParseResult {
  if (!isHeadlessHostIncarnationId(currentHost)) return invalid();
  const record = exactDataRecord(value, ["version", "operation", "input"]);
  if (!record || typeof record.version !== "string" || typeof record.operation !== "string") return invalid();
  if (record.version !== HEADLESS_CONTRACT_VERSION) return { ok: false, code: "headless.unsupported-version" };
  const { operation } = record;
  if (!isHeadlessReadOperation(operation)) return { ok: false, code: "headless.unsupported-operation" };

  const version = HEADLESS_CONTRACT_VERSION;
  if (operation === "context.task") return readHeadlessContextTaskRequest(value, currentHost);
  if (operation === "context.saved") return readHeadlessContextSavedRequest(value, currentHost);
  if (operation === "context.preview-rebuild") return readHeadlessContextRebuildRequest(value, currentHost);
  if (operation === "context.preview-query") return readHeadlessContextQueryPreviewRequest(value, currentHost);
  if (operation === "context.models" || operation === "context.preview-generation") return readHeadlessContextReadRequest(value, currentHost);
  if (operation === "data.dataset-task-status") return readHeadlessDatasetTaskStatusRequest(value, currentHost);
  if (operation === "data.dataset-task-review") return readHeadlessDatasetTaskReviewRequest(value, currentHost);
  if (operation === "data.preview-dataset-preparation") return readHeadlessDatasetPreparationRequest(value, currentHost);
  if (operation === "host.describe") {
    if (!exactDataRecord(record.input, [])) return invalid();
    return { ok: true, request: { version, operation, input: {} } };
  }

  const fields = operation === "workspaces.list" ? ["hostIncarnationId"]
    : operation === "systems.read" ? ["hostIncarnationId", "workspaceId", "systemId"]
      : operation === "systems.changes" ? ["hostIncarnationId", "workspaceId", "cursor"]
        : operation === "workflows.list" ? ["hostIncarnationId", "workspaceId", "sourceKind"]
        : operation === "workflows.prepare" ? ["hostIncarnationId", "workspaceId", "profileId", "source"]
        : operation === "conversation-tasks.read" ? ["hostIncarnationId", "workspaceId", "sessionId", "turnId"]
        : operation === "data.ingestion-status" ? ["hostIncarnationId", "workspaceId", "taskId"]
        : operation === "data.dataset-versions" ? ["hostIncarnationId", "workspaceId", "datasetId", "versionIds"]
        : operation === "data.compare-dataset-versions" ? ["hostIncarnationId", "workspaceId", "fromVersionId", "toVersionId"]
        : ["hostIncarnationId", "workspaceId"];
  const input = exactDataRecord(record.input, fields);
  if (!input || !isHeadlessHostIncarnationId(input.hostIncarnationId)) return invalid();
  const { hostIncarnationId, workspaceId, systemId } = input;
  let request: HeadlessReadRequest;
  switch (operation) {
    case "data.dataset-versions": {
      if (!isWorkspaceId(workspaceId)) return invalid();
      try {
        const datasetId = input.datasetId, ids = copyBoundedPassiveData(input.versionIds);
        if (typeof datasetId !== "string" || hasKnownPassiveCredential(datasetId) || normalizeDatasetId(datasetId) !== datasetId ||
            !Array.isArray(ids) || ids.length < 1 || ids.length > HEADLESS_DATASET_VERSION_READ_LIMIT || new Set(ids).size !== ids.length ||
            ids.some(value => typeof value !== "string" || hasKnownPassiveCredential(value) || normalizeDatasetVersionId(value) !== value)) return invalid();
        request = {version, operation, input: {hostIncarnationId, workspaceId, datasetId: normalizeDatasetId(datasetId),
          versionIds: ids.map(normalizeDatasetVersionId)}};
      } catch { return invalid(); }
      break;
    }
    case "data.compare-dataset-versions": {
      if (!isWorkspaceId(workspaceId)) return invalid();
      try {
        const {fromVersionId: from, toVersionId: to} = input;
        if (typeof from !== "string" || typeof to !== "string" || hasKnownPassiveCredential(from) || hasKnownPassiveCredential(to) ||
            normalizeDatasetVersionId(from) !== from || normalizeDatasetVersionId(to) !== to) return invalid();
        request = {version, operation, input: {hostIncarnationId, workspaceId,
          fromVersionId: normalizeDatasetVersionId(from), toVersionId: normalizeDatasetVersionId(to)}};
      } catch { return invalid(); }
      break;
    }
    case "data.ingestion-status": {
      const { taskId } = input;
      if (!isWorkspaceId(workspaceId) || typeof taskId !== "string" || hasKnownPassiveCredential(taskId)) return invalid();
      try {
        const normalized = normalizeIngestionTaskId(taskId);
        if (normalized !== taskId) return invalid();
        request = { version, operation, input: { hostIncarnationId, workspaceId, taskId: normalized } };
      } catch { return invalid(); }
      break;
    }
    case "workspaces.list":
      request = { version, operation, input: { hostIncarnationId } };
      break;
    case "systems.list":
    case "templates.list":
    case "systems.snapshot":
    case "plan.capabilities":
      if (!isWorkspaceId(workspaceId)) return invalid();
      request = { version, operation, input: { hostIncarnationId, workspaceId } };
      break;
    case "systems.read":
      if (!isWorkspaceId(workspaceId) || !isSystemBuilderSystemId(systemId)) return invalid();
      request = { version, operation, input: { hostIncarnationId, workspaceId, systemId } };
      break;
    case "systems.changes": {
      const cursor = parseHeadlessChangeCursor(input.cursor);
      if (!isWorkspaceId(workspaceId) || !cursor) return invalid();
      request = { version, operation, input: { hostIncarnationId, workspaceId, cursor } };
      break;
    }
    case "workflows.list": {
      const { sourceKind } = input;
      if (!isWorkspaceId(workspaceId) || (sourceKind !== "approved-release" && sourceKind !== "reviewed-execution-plan")) return invalid();
      request = { version, operation, input: { hostIncarnationId, workspaceId, sourceKind } };
      break;
    }
    case "workflows.prepare": {
      const { profileId } = input;
      const source = parseWorkflowSource(input.source);
      if (!isWorkspaceId(workspaceId) || !isHeadlessWorkflowId(profileId) || !source) return invalid();
      request = { version, operation, input: { hostIncarnationId, workspaceId, profileId, source } };
      break;
    }
    case "conversation-tasks.read": {
      const { sessionId, turnId } = input;
      if (!isWorkspaceId(workspaceId) || !isHeadlessWorkflowId(sessionId) || !isHeadlessWorkflowId(turnId)) return invalid();
      request = { version, operation, input: { hostIncarnationId, workspaceId, sessionId, turnId } };
      break;
    }
  }
  return hostIncarnationId === currentHost
    ? { ok: true, request }
    : { ok: false, code: "headless.host-changed" };
}
