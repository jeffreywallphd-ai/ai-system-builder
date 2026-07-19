import { useMemo } from "react";

import { readSystemFoundationBackingResourceProgram } from "../../../application/services/asset-packs/system-foundation-backing-resource-catalog";
import type { AssetInstance } from "../../../contracts/asset";
import { EmptyState } from "../components/EmptyState";
import { FoundationAssetPreview } from "../foundation-assets";

export const MAX_SYSTEM_COMPOSITION_PREVIEW_SURFACES = 24;

export interface SystemCompositionPreviewItem {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly displayName: string;
  readonly configuration: AssetInstance["selectedConfiguration"];
}

export interface SystemCompositionPreviewModel {
  readonly items: readonly SystemCompositionPreviewItem[];
  readonly unavailableCount: number;
  readonly truncatedCount: number;
}

export function buildSystemCompositionPreviewModel(
  instances: readonly AssetInstance[],
): SystemCompositionPreviewModel {
  const previewable = instances.flatMap((instance) => {
    const definitionId = String(instance.definitionRef.id);
    const program = readSystemFoundationBackingResourceProgram(definitionId);
    if (!program?.styleClassName) return [];
    return [
      {
        instanceId: String(instance.instanceId),
        definitionId,
        displayName: instance.displayName ?? program.displayName,
        configuration: instance.selectedConfiguration,
      },
    ];
  });
  const items = previewable.slice(0, MAX_SYSTEM_COMPOSITION_PREVIEW_SURFACES);
  return {
    items,
    unavailableCount: instances.length - previewable.length,
    truncatedCount: previewable.length - items.length,
  };
}

export function SystemCompositionPreview({
  systemName,
  instances,
  includesUnsavedChanges,
}: {
  readonly systemName: string;
  readonly instances: readonly AssetInstance[];
  readonly includesUnsavedChanges: boolean;
}) {
  const model = useMemo(
    () => buildSystemCompositionPreviewModel(instances),
    [instances],
  );

  return (
    <section
      className="system-composition-preview ui-stack ui-stack--md"
      aria-label={`${systemName} current UI preview`}
    >
      <div className="system-composition-preview__summary ui-stack ui-stack--xs">
        <p>
          This design-time preview renders the current ordered frontend surfaces
          using registered, side-effect-free System Foundation renderers. It
          does not execute backend logic, activate a release, or deploy the
          system.
        </p>
        <div
          className="system-composition-preview__counts"
          aria-label="Preview coverage"
        >
          <span className="ui-badge ui-badge--info">
            {model.items.length} frontend{" "}
            {model.items.length === 1 ? "surface" : "surfaces"}
          </span>
          {model.unavailableCount ? (
            <span className="ui-badge ui-badge--warning">
              {model.unavailableCount} unavailable
            </span>
          ) : null}
        </div>
      </div>

      {includesUnsavedChanges ? (
        <p className="ui-status ui-status--warning" role="status">
          This preview includes unsaved composition changes.
        </p>
      ) : null}

      {model.items.length ? (
        <ol className="system-composition-preview__surfaces">
          {model.items.map((item, index) => (
            <li
              key={item.instanceId}
              className="system-composition-preview__surface"
            >
              <div className="system-composition-preview__surface-heading">
                <span aria-hidden="true">{index + 1}</span>
                <div>
                  <strong>{item.displayName}</strong>
                  <small>{item.definitionId}</small>
                </div>
              </div>
              <FoundationAssetPreview
                definitionId={item.definitionId}
                displayName={item.displayName}
                configuration={item.configuration}
              />
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          compact
          icon="systems"
          title="No previewable frontend surfaces"
          description="Add a System Foundation asset with registered frontend backing resources to see a safe UI preview. Imported and authored frontend execution remains unavailable until a qualified sandbox is present."
        />
      )}

      {model.unavailableCount ? (
        <p className="ui-text-muted">
          {model.unavailableCount} nonvisual or unregistered asset
          {model.unavailableCount === 1 ? " was" : "s were"} omitted from the UI
          preview.
        </p>
      ) : null}
      {model.truncatedCount ? (
        <p className="ui-status ui-status--warning" role="status">
          {model.truncatedCount} additional frontend surface
          {model.truncatedCount === 1 ? " was" : "s were"} omitted to keep the
          preview bounded.
        </p>
      ) : null}
    </section>
  );
}
