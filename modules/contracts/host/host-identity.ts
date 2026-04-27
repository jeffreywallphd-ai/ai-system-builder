import { resolveHostKind, type HostKind } from "./host-kind";

export const HOST_ID_FORMAT_DESCRIPTION =
  "a non-empty, trimmed host identifier string";

export type HostId = string;

export interface HostIdentity {
  kind: HostKind;
  id?: HostId;
}

function invalidHostIdMessage(id: string): string {
  return `Host id must be ${HOST_ID_FORMAT_DESCRIPTION}. Received "${id}".`;
}

export function normalizeHostId(id: string): HostId {
  const normalizedId = id.trim();

  if (normalizedId.length === 0) {
    throw new Error(invalidHostIdMessage(id));
  }

  return normalizedId;
}

export function createHostIdentity(
  kind: HostKind,
  options?: {
    id?: string;
  },
): HostIdentity {
  return {
    kind: resolveHostKind(kind),
    id: options?.id === undefined ? undefined : normalizeHostId(options.id),
  };
}
