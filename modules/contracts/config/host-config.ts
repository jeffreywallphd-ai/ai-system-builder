import { createHostIdentity, resolveHostKind, type HostIdentity } from "../host";

export type HostConfig = HostIdentity;

export function createHostConfig(options?: {
  kind?: string;
  id?: string;
}): HostConfig {
  return createHostIdentity(resolveHostKind(options?.kind), {
    id: options?.id,
  });
}
