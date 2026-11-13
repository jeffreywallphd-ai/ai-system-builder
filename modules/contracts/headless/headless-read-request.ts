import { isSystemBuilderSystemId, type SystemBuilderSystemId } from "../system-builder";
import { isWorkspaceId, type WorkspaceId } from "../workspace";

export const HEADLESS_CONTRACT_VERSION = "aisb-headless-v1";

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
] as const);

export type HeadlessReadOperation = (typeof HEADLESS_READ_OPERATIONS)[number];

export type HeadlessHostIncarnationId = string & {
  readonly __headlessHostIncarnationIdBrand: unique symbol;
};

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
  | ReadRequest<"host.describe", Record<string, never>>
  | ReadRequest<"workspaces.list", HostTarget>
  | ReadRequest<"systems.list", WorkspaceTarget>
  | ReadRequest<"templates.list", WorkspaceTarget>
  | ReadRequest<"systems.snapshot", WorkspaceTarget>
  | ReadRequest<"systems.changes", WorkspaceTarget & { readonly cursor: HeadlessChangeCursor }>
  | ReadRequest<"workflows.list", WorkspaceTarget & { readonly sourceKind: HeadlessWorkflowSourceKind }>
  | ReadRequest<"workflows.prepare", WorkspaceTarget & { readonly profileId: string; readonly source: HeadlessWorkflowSource }>
  | ReadRequest<"conversation-tasks.read", WorkspaceTarget & { readonly sessionId: string; readonly turnId: string }>
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

export function isHeadlessHostIncarnationId(value: unknown): value is HeadlessHostIncarnationId {
  // Canonical random UUID v4, minted by the host for this process lifetime.
  return typeof value === "string" && value.length === 36 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

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
        : ["hostIncarnationId", "workspaceId"];
  const input = exactDataRecord(record.input, fields);
  if (!input || !isHeadlessHostIncarnationId(input.hostIncarnationId)) return invalid();
  const { hostIncarnationId, workspaceId, systemId } = input;
  let request: HeadlessReadRequest;
  switch (operation) {
    case "workspaces.list":
      request = { version, operation, input: { hostIncarnationId } };
      break;
    case "systems.list":
    case "templates.list":
    case "systems.snapshot":
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
