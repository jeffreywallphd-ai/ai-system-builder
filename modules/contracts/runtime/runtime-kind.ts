export const KNOWN_RUNTIME_KINDS = ["node", "python"] as const;

export type KnownRuntimeKind = (typeof KNOWN_RUNTIME_KINDS)[number];

export type RuntimeKind = KnownRuntimeKind | (string & {});

export function isKnownRuntimeKind(value: string): value is KnownRuntimeKind {
  return (KNOWN_RUNTIME_KINDS as readonly string[]).includes(value);
}

export function resolveRuntimeKind(
  value: string | undefined,
  fallback: KnownRuntimeKind = "node",
): RuntimeKind {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return isKnownRuntimeKind(normalized)
    ? normalized
    : (normalized as RuntimeKind);
}
