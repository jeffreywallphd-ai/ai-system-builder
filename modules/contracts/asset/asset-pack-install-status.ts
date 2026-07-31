export const ASSET_PACK_INSTALL_STATUSES = [
  "cataloged",
  "installed",
  "active",
  "disabled",
  "blocked",
  "removed",
] as const;

export type AssetPackInstallStatus =
  (typeof ASSET_PACK_INSTALL_STATUSES)[number];

export function isAssetPackInstallStatus(
  value: string,
): value is AssetPackInstallStatus {
  return ASSET_PACK_INSTALL_STATUSES.includes(value as AssetPackInstallStatus);
}

export function normalizeAssetPackInstallStatus(
  value: string,
): AssetPackInstallStatus {
  const normalized = value.trim().toLowerCase();

  if (!isAssetPackInstallStatus(normalized)) {
    throw new Error(
      `Asset pack install status must be one of ${ASSET_PACK_INSTALL_STATUSES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
