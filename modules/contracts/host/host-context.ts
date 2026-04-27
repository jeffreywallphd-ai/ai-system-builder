import type { ContractBoundaryContext } from "../shared";
import { createHostIdentity, type HostIdentity } from "./host-identity";
import type { HostKind } from "./host-kind";

const HOST_CONTEXT_NON_GOAL_KEYWORDS = [
  "auth",
  "session",
  "request",
  "response",
  "window",
  "framework",
  "electron",
  "express",
] as const;

export const HOST_CONTEXT_METADATA_FORMAT_DESCRIPTION =
  "a plain object containing JSON-serializable values and no auth/session/request/window/framework semantics";

export type HostContextMetadataValue =
  | string
  | number
  | boolean
  | null
  | readonly HostContextMetadataValue[]
  | {
      readonly [key: string]: HostContextMetadataValue;
    };

export type HostContextMetadata = Readonly<
  Record<string, HostContextMetadataValue>
>;

export interface HostContext extends ContractBoundaryContext {
  host: HostIdentity;
  metadata?: HostContextMetadata;
}

function invalidHostContextMetadataMessage(reason: string): string {
  return `Host context metadata must be ${HOST_CONTEXT_METADATA_FORMAT_DESCRIPTION}. ${reason}`;
}

function hasNonGoalKeyword(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return HOST_CONTEXT_NON_GOAL_KEYWORDS.some((keyword) =>
    normalized.includes(keyword),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeMetadataValue(
  value: HostContextMetadataValue,
  path: string,
): HostContextMetadataValue {
  if (value === null) {
    return value;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      normalizeMetadataValue(entry, `${path}[${index}]`),
    );
  }

  if (!isPlainObject(value)) {
    throw new Error(
      invalidHostContextMetadataMessage(
        `Received non-plain object at "${path}".`,
      ),
    );
  }

  const normalizedEntries = Object.entries(value).map(([entryKey, entry]) => {
    const normalizedKey = entryKey.trim();

    if (!normalizedKey) {
      throw new Error(
        invalidHostContextMetadataMessage(
          `Received an empty metadata key at "${path}".`,
        ),
      );
    }

    if (hasNonGoalKeyword(normalizedKey)) {
      throw new Error(
        invalidHostContextMetadataMessage(
          `Metadata key "${normalizedKey}" introduces a non-goal semantic.`,
        ),
      );
    }

    return [
      normalizedKey,
      normalizeMetadataValue(
        entry as HostContextMetadataValue,
        `${path}.${normalizedKey}`,
      ),
    ] as const;
  });

  return Object.fromEntries(normalizedEntries) as HostContextMetadataValue;
}

export function normalizeHostContextMetadata(
  metadata: HostContextMetadata | undefined,
): HostContextMetadata | undefined {
  if (metadata === undefined) {
    return undefined;
  }

  if (!isPlainObject(metadata)) {
    throw new Error(
      invalidHostContextMetadataMessage("Received non-object root metadata."),
    );
  }

  return normalizeMetadataValue(metadata, "metadata") as HostContextMetadata;
}

export function createHostContext(
  host: HostIdentity | HostKind,
  options?: {
    hostId?: string;
    requestId?: string;
    correlationId?: string;
    metadata?: HostContextMetadata;
  },
): HostContext {
  const resolvedHost =
    typeof host === "string"
      ? createHostIdentity(host, { id: options?.hostId })
      : createHostIdentity(host.kind, { id: host.id });

  return {
    host: resolvedHost,
    requestId: options?.requestId,
    correlationId: options?.correlationId,
    metadata: normalizeHostContextMetadata(options?.metadata),
  };
}
