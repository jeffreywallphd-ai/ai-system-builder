export const ASSET_PORT_DIRECTIONS = [
  "input",
  "output",
  "event",
  "control",
] as const;

export type AssetPortDirection = (typeof ASSET_PORT_DIRECTIONS)[number];

export function isAssetPortDirection(value: string): value is AssetPortDirection {
  return ASSET_PORT_DIRECTIONS.includes(value as AssetPortDirection);
}

export function normalizeAssetPortDirection(value: string): AssetPortDirection {
  const normalized = value.trim().toLowerCase();

  if (!isAssetPortDirection(normalized)) {
    throw new Error(
      `Asset port direction must be one of ${ASSET_PORT_DIRECTIONS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
