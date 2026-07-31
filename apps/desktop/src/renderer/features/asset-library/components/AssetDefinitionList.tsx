import type { AssetLibraryDefinitionCard } from "../../../../../../../modules/ui/shared/asset-library";
import {
  formatAssetLibraryDate,
  getAssetCategoryLabel,
  getAssetPackLabel,
  getAssetSourceBadge,
  getAssetLibraryFamilyLabel,
  getAssetLibraryLifecycleStatusLabel,
  getAssetLibraryTypeLabel,
} from "../../../../../../../modules/ui/shared/asset-library";

interface AssetDefinitionListProps {
  readonly definitions: readonly AssetLibraryDefinitionCard[];
  readonly selectedDefinitionId?: string;
  readonly hasActiveFilters: boolean;
  readonly onSelectDefinition: (definition: AssetLibraryDefinitionCard) => void;
  readonly onCustomizeDefinition?: (
    definition: AssetLibraryDefinitionCard,
  ) => void;
}

export function AssetDefinitionList({
  definitions,
  selectedDefinitionId,
  hasActiveFilters,
  onSelectDefinition,
  onCustomizeDefinition,
}: AssetDefinitionListProps) {
  if (definitions.length === 0) {
    return (
      <section className="ui-panel asset-library-empty">
        <h2>
          {hasActiveFilters
            ? "No assets match the current filters."
            : "No reusable building blocks are registered yet."}
        </h2>
        {!hasActiveFilters ? (
          <p>
            Built-in assets appear here after they are registered for this
            workspace.
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section
      className="asset-library-list"
      aria-label="Reusable building blocks"
    >
      {definitions.map((definition) => {
        const updatedAt = formatAssetLibraryDate(definition.updatedAt, {
          dateStyle: "medium",
        });
        const isSelected = definition.id === selectedDefinitionId;

        return (
          <article
            key={definition.id}
            className={`asset-definition-card${isSelected ? " asset-definition-card--selected" : ""}`}
          >
            <button
              type="button"
              className="asset-definition-card__preview"
              aria-haspopup="dialog"
              aria-expanded={isSelected}
              onClick={() => onSelectDefinition(definition)}
            >
              <span className="asset-definition-card__header">
                <span className="asset-definition-card__title">
                  {definition.displayName}
                </span>
                <span
                  className={`asset-library-badge ${definition.systemDefault || definition.builtIn ? "asset-library-badge--system" : "asset-library-badge--custom"}`}
                >
                  {getAssetSourceBadge(definition)}
                </span>
              </span>
              {definition.summary ? (
                <span className="asset-definition-card__summary">
                  {definition.summary}
                </span>
              ) : null}
              <span
                className="asset-library-cues"
                aria-label="Pack and category cues"
              >
                <span>{getAssetPackLabel(definition)}</span>
                <span>{getAssetCategoryLabel(definition)}</span>
              </span>
              <span className="asset-library-cues" aria-label="Asset cues">
                <span>{getAssetLibraryTypeLabel(definition)}</span>
                <span>{getAssetLibraryFamilyLabel(definition)}</span>
                <span>{getAssetLibraryLifecycleStatusLabel(definition)}</span>
                <span>v{definition.version}</span>
              </span>
              {updatedAt ? (
                <span className="asset-definition-card__updated">
                  Updated {updatedAt}
                </span>
              ) : null}
            </button>
            {onCustomizeDefinition ? (
              <div className="asset-definition-card__actions">
                <button
                  type="button"
                  className="ui-button ui-button--outline"
                  onClick={() => onCustomizeDefinition(definition)}
                >
                  Customize
                </button>
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
