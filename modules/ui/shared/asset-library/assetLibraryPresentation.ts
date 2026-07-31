import type { AssetLibraryDefinitionDetail } from "./assetLibraryReadModels";

export function formatAssetLibraryLabel(value: string | undefined): string {
  if (!value) return "Not specified";
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatAssetLibraryBoolean(value: boolean | undefined): string {
  if (value === undefined) return "Not specified";
  return value ? "Yes" : "No";
}

export function formatAssetLibraryDate(value: string | undefined, options?: Intl.DateTimeFormatOptions): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, options ?? { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function displayAssetLibraryValue(value: string | number | undefined): string | number {
  return value === undefined || value === "" ? "Not specified" : value;
}

export function getAssetLibraryTypeLabel(detail: Pick<AssetLibraryDefinitionDetail, "assetType" | "assetTypeLabel">): string {
  return detail.assetTypeLabel ?? formatAssetLibraryLabel(detail.assetType);
}

export function getAssetLibraryFamilyLabel(detail: Pick<AssetLibraryDefinitionDetail, "assetFamily" | "assetFamilyLabel">): string {
  return detail.assetFamilyLabel ?? formatAssetLibraryLabel(detail.assetFamily);
}

export function getAssetLibraryLifecycleStatusLabel(
  detail: Pick<AssetLibraryDefinitionDetail, "lifecycleStatus" | "lifecycleStatusLabel">,
): string {
  return detail.lifecycleStatusLabel ?? formatAssetLibraryLabel(detail.lifecycleStatus);
}
