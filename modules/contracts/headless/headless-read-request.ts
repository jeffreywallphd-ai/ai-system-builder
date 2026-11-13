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
  }
  return hostIncarnationId === currentHost
    ? { ok: true, request }
    : { ok: false, code: "headless.host-changed" };
}
