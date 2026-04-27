import { resolveRuntimeKind, type RuntimeKind } from "./runtime-kind";

export type RuntimeTargetMetadata = Readonly<Record<string, unknown>>;

export interface RuntimeTarget<
  TMetadata extends RuntimeTargetMetadata = RuntimeTargetMetadata,
> {
  kind: RuntimeKind;
  adapter?: string;
  capability?: string;
  metadata?: TMetadata;
}

export function createRuntimeTarget<
  TMetadata extends RuntimeTargetMetadata = RuntimeTargetMetadata,
>(
  kind: RuntimeKind = "node",
  options?: {
    adapter?: string;
    capability?: string;
    metadata?: TMetadata;
  },
): RuntimeTarget<TMetadata> {
  return {
    kind: resolveRuntimeKind(kind),
    adapter: options?.adapter,
    capability: options?.capability,
    metadata: options?.metadata,
  };
}
