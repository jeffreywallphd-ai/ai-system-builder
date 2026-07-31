import type { AssetSourceLayer } from "../../../contracts/asset";
import type { AssetLibraryDefinitionCard } from "./assetLibraryReadModels";

export interface AssetLibraryDefinitionGroup<T extends AssetLibraryDefinitionCard = AssetLibraryDefinitionCard> {
  readonly key: string;
  readonly label: string;
  readonly items: readonly T[];
}

const CUSTOM_KEY = "custom";
const UNCATEGORIZED_KEY = "uncategorized";

export function getAssetSourceBadge(asset: Pick<AssetLibraryDefinitionCard, "sourceBadgeLabel" | "builtIn">): string {
  return asset.sourceBadgeLabel ?? (asset.builtIn ? "System default" : "Custom");
}

export function getAssetCategoryLabel(
  asset: Pick<AssetLibraryDefinitionCard, "categoryLabel" | "packCategoryDisplayName" | "packCategoryId">,
): string {
  return asset.categoryLabel ?? asset.packCategoryDisplayName ?? asset.packCategoryId ?? "Uncategorized";
}

export function getAssetPackLabel(
  asset: Pick<AssetLibraryDefinitionCard, "packLabel" | "sourcePackDisplayName" | "sourcePackId">,
): string {
  return asset.packLabel ?? asset.sourcePackDisplayName ?? asset.sourcePackId ?? "Custom assets";
}

export function groupAssetDefinitionsByPack<T extends AssetLibraryDefinitionCard>(
  assets: readonly T[],
): readonly AssetLibraryDefinitionGroup<T>[] {
  return groupBy(assets, (asset) => ({
    key: asset.sourcePackId ?? CUSTOM_KEY,
    label: getAssetPackLabel(asset),
  }));
}

export function groupAssetDefinitionsByCategory<T extends AssetLibraryDefinitionCard>(
  assets: readonly T[],
): readonly AssetLibraryDefinitionGroup<T>[] {
  return groupBy(assets, (asset) => ({
    key: asset.packCategoryId ?? UNCATEGORIZED_KEY,
    label: getAssetCategoryLabel(asset),
  }));
}

export function filterAssetDefinitionsByPack<T extends AssetLibraryDefinitionCard>(
  assets: readonly T[],
  packId: string | "all",
): readonly T[] {
  if (packId === "all") return assets;
  return assets.filter((asset) => (asset.sourcePackId ?? CUSTOM_KEY) === packId);
}

export function filterAssetDefinitionsBySourceLayer<T extends AssetLibraryDefinitionCard>(
  assets: readonly T[],
  sourceLayer: AssetSourceLayer | "custom" | "all",
): readonly T[] {
  if (sourceLayer === "all") return assets;
  if (sourceLayer === "custom") return assets.filter((asset) => !asset.sourceLayer);
  return assets.filter((asset) => asset.sourceLayer === sourceLayer);
}

export function filterAssetDefinitionsByCategory<T extends AssetLibraryDefinitionCard>(
  assets: readonly T[],
  categoryId: string | "all",
): readonly T[] {
  if (categoryId === "all") return assets;
  return assets.filter((asset) => (asset.packCategoryId ?? UNCATEGORIZED_KEY) === categoryId);
}

function groupBy<T extends AssetLibraryDefinitionCard>(
  assets: readonly T[],
  selector: (asset: T) => { readonly key: string; readonly label: string },
): readonly AssetLibraryDefinitionGroup<T>[] {
  const groups = new Map<string, { label: string; items: T[] }>();
  for (const asset of assets) {
    const { key, label } = selector(asset);
    const group = groups.get(key);
    if (group) {
      group.items.push(asset);
    } else {
      groups.set(key, { label, items: [asset] });
    }
  }
  return Array.from(groups.entries()).map(([key, group]) => ({
    key,
    label: group.label,
    items: group.items,
  }));
}
