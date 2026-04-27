export const KNOWN_HOST_KINDS = ["desktop", "server", "hybrid"] as const;

export type KnownHostKind = (typeof KNOWN_HOST_KINDS)[number];

export type HostKind = KnownHostKind | (string & {});

export function isKnownHostKind(value: string): value is KnownHostKind {
  return (KNOWN_HOST_KINDS as readonly string[]).includes(value);
}

export function resolveHostKind(
  value: string | undefined,
  fallback: KnownHostKind = "desktop",
): HostKind {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return isKnownHostKind(normalized) ? normalized : (normalized as HostKind);
}
