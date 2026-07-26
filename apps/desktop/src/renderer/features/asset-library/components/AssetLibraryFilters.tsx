import { TermWithHint } from "../../../../../../../modules/ui/shared";
import type { AssetLibraryBuiltInFilter } from "../../../../../../../modules/ui/shared/asset-library";
import type {
  AssetLibraryFilterValue,
  AssetLibraryFiltersState,
} from "../hooks/useAssetLibraryFeature";

interface AssetLibraryFiltersProps {
  readonly filters: AssetLibraryFiltersState;
  readonly onSearchTextChange: (value: string) => void;
  readonly onAssetTypeChange: (value: AssetLibraryFilterValue) => void;
  readonly onAssetFamilyChange: (value: AssetLibraryFilterValue) => void;
  readonly onLifecycleStatusChange: (value: AssetLibraryFilterValue) => void;
  readonly onBuiltInChange: (value: AssetLibraryBuiltInFilter) => void;
  readonly onPackIdChange: (value: AssetLibraryFilterValue) => void;
  readonly onSourceLayerChange: (value: AssetLibraryFilterValue) => void;
  readonly onCategoryIdChange: (value: AssetLibraryFilterValue) => void;
  readonly onRefresh: () => void;
  readonly isRefreshing: boolean;
}

const ASSET_TYPE_OPTIONS = [
  "adapter-binding",
  "data-source",
  "dataset",
  "document",
  "feature",
  "image",
  "model",
  "page",
  "policy",
  "prompt-template",
  "schema",
  "subsystem",
  "system",
  "test",
  "tool",
  "ui-component",
  "workflow",
  "workflow-step",
] as const;

const ASSET_FAMILY_OPTIONS = [
  "behavioral",
  "composition",
  "context",
  "resource-backed",
  "structural",
] as const;

const LIFECYCLE_STATUS_OPTIONS = [
  "archived",
  "deprecated",
  "draft",
  "failed-validation",
  "published",
  "validated",
] as const;

const SOURCE_LAYER_OPTIONS = [
  "system-default",
  "installed-pack",
  "imported-pack",
  "workspace-pack",
  "organization-override",
  "user-override",
  "custom",
] as const;

const CATEGORY_OPTIONS = [
  ["ui-structure", "UI Structure"],
  ["forms-fields", "Forms and Fields"],
  ["data-display", "Data Display"],
  ["state-messages", "State Messages"],
  ["page-feature-shells", "Page and Feature Shells"],
  ["workflow-system-shells", "Workflow and System Shells"],
] as const;

function formatLabel(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function AssetLibraryFilters({
  filters,
  onSearchTextChange,
  onAssetTypeChange,
  onAssetFamilyChange,
  onLifecycleStatusChange,
  onBuiltInChange,
  onPackIdChange,
  onSourceLayerChange,
  onCategoryIdChange,
  onRefresh,
  isRefreshing,
}: AssetLibraryFiltersProps) {
  return (
    <form
      className="asset-library-toolbar"
      onSubmit={(event) => event.preventDefault()}
    >
      <label className="ui-stack ui-stack--sm">
        <span className="ui-label">
          <TermWithHint termId="assetSearchFilter">Search assets</TermWithHint>
        </span>
        <input
          className="ui-input asset-library-toolbar__search"
          type="search"
          value={filters.searchText}
          placeholder="Search by name or summary"
          onInput={(event) => onSearchTextChange(event.currentTarget.value)}
        />
      </label>

      <label className="ui-stack ui-stack--sm">
        <span className="ui-label">
          <TermWithHint termId="assetTypeFilter">Type</TermWithHint>
        </span>
        <select
          className="ui-input"
          value={filters.assetType}
          onChange={(event) => onAssetTypeChange(event.currentTarget.value)}
        >
          <option value="all">All types</option>
          {ASSET_TYPE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {formatLabel(option)}
            </option>
          ))}
        </select>
      </label>

      <label className="ui-stack ui-stack--sm">
        <span className="ui-label">
          <TermWithHint termId="assetFamilyFilter">Family</TermWithHint>
        </span>
        <select
          className="ui-input"
          value={filters.assetFamily}
          onChange={(event) => onAssetFamilyChange(event.currentTarget.value)}
        >
          <option value="all">All families</option>
          {ASSET_FAMILY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {formatLabel(option)}
            </option>
          ))}
        </select>
      </label>

      <label className="ui-stack ui-stack--sm">
        <span className="ui-label">
          <TermWithHint termId="assetStatusFilter">Status</TermWithHint>
        </span>
        <select
          className="ui-input"
          value={filters.lifecycleStatus}
          onChange={(event) =>
            onLifecycleStatusChange(event.currentTarget.value)
          }
        >
          <option value="all">All statuses</option>
          {LIFECYCLE_STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {formatLabel(option)}
            </option>
          ))}
        </select>
      </label>

      <label className="ui-stack ui-stack--sm">
        <span className="ui-label">
          <TermWithHint termId="assetSourceFilter">Source</TermWithHint>
        </span>
        <select
          className="ui-input"
          value={filters.builtIn}
          onChange={(event) =>
            onBuiltInChange(
              event.currentTarget.value as AssetLibraryBuiltInFilter,
            )
          }
        >
          <option value="all">Built-in and custom</option>
          <option value="built-in">Built-in</option>
          <option value="custom">Custom</option>
        </select>
      </label>

      <label className="ui-stack ui-stack--sm">
        <span className="ui-label">
          <TermWithHint termId="assetPackFilter">Pack</TermWithHint>
        </span>
        <select
          className="ui-input"
          value={filters.packId}
          onChange={(event) => onPackIdChange(event.currentTarget.value)}
        >
          <option value="all">All packs</option>
          <option value="system.foundation">System Foundation</option>
          <option value="custom">Custom assets</option>
        </select>
      </label>

      <label className="ui-stack ui-stack--sm">
        <span className="ui-label">
          <TermWithHint termId="assetLayerFilter">Layer</TermWithHint>
        </span>
        <select
          className="ui-input"
          value={filters.sourceLayer}
          onChange={(event) => onSourceLayerChange(event.currentTarget.value)}
        >
          <option value="all">All layers</option>
          {SOURCE_LAYER_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === "custom" ? "Custom" : formatLabel(option)}
            </option>
          ))}
        </select>
      </label>

      <label className="ui-stack ui-stack--sm">
        <span className="ui-label">
          <TermWithHint termId="assetCategoryFilter">Category</TermWithHint>
        </span>
        <select
          className="ui-input"
          value={filters.categoryId}
          onChange={(event) => onCategoryIdChange(event.currentTarget.value)}
        >
          <option value="all">All categories</option>
          {CATEGORY_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <button
        className="ui-button asset-library-toolbar__refresh"
        type="button"
        onClick={onRefresh}
        disabled={isRefreshing}
      >
        Refresh
      </button>
    </form>
  );
}
