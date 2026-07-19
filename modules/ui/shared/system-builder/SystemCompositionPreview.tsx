import { useMemo, useState } from "react";

import { readSystemFoundationBackingResourceProgram } from "../../../application/services/asset-packs/system-foundation-backing-resource-catalog";
import type {
  AssetInstance,
  AssetPlacement,
  AssetReference,
} from "../../../contracts/asset";
import { normalizeAssetId } from "../../../contracts/asset";
import type { SystemBuilderComposerAsset } from "../../../contracts/system-builder";
import { EmptyState } from "../components/EmptyState";
import { FoundationAssetPreview } from "../foundation-assets";
import {
  buildSystemComposerTree,
  flattenSystemComposerTree,
  type SystemComposerTreeNode,
} from "./systemComposerDraft";

export const MAX_SYSTEM_COMPOSITION_PREVIEW_SURFACES = 24;

export interface SystemCompositionPreviewItem {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly displayName: string;
  readonly configuration: AssetInstance["selectedConfiguration"];
}

export interface SystemCompositionPreviewSlot {
  readonly slotId: string;
  readonly displayName: string;
  readonly children: readonly SystemCompositionPreviewNode[];
}

export interface SystemCompositionPreviewNode {
  readonly item: SystemCompositionPreviewItem;
  readonly previewAvailable: boolean;
  readonly slots: readonly SystemCompositionPreviewSlot[];
}

export interface SystemCompositionPreviewModel {
  readonly items: readonly SystemCompositionPreviewItem[];
  readonly roots: readonly SystemCompositionPreviewNode[];
  readonly unassignedRoots: readonly SystemCompositionPreviewNode[];
  readonly unassignedCount: number;
  readonly unavailableCount: number;
  readonly truncatedCount: number;
}

export function buildSystemCompositionPreviewModel(
  instances: readonly AssetInstance[],
  placements: readonly AssetPlacement[] = [],
  rootInstanceRefs: readonly AssetReference[] = [],
  catalog: readonly SystemBuilderComposerAsset[] = [],
): SystemCompositionPreviewModel {
  const roots = rootInstanceRefs.length
    ? rootInstanceRefs
    : deriveRootInstanceRefs(instances, placements);
  const draft = { instances, placements, bindings: [] };
  const canonicalTree = buildSystemComposerTree(draft, roots);
  const reachableIds = new Set(
    flattenSystemComposerTree(canonicalTree).map((node) =>
      String(node.instance.instanceId),
    ),
  );
  const unassignedRefs = deriveRootInstanceRefs(
    instances.filter(
      (instance) => !reachableIds.has(String(instance.instanceId)),
    ),
    placements.filter(
      (placement) =>
        !reachableIds.has(String(placement.childInstanceRef.id)) &&
        !reachableIds.has(String(placement.parentInstanceRef.id)),
    ),
  );
  const unassignedTree = buildSystemComposerTree(draft, unassignedRefs);
  const definitions = new Map(
    catalog.map((definition) => [
      definition.definitionId + "@" + definition.version,
      definition,
    ]),
  );
  const state: PreviewBuildState = {
    renderedCount: 0,
    items: [],
    definitions,
  };
  const previewRoots = canonicalTree
    .map((node) => buildPreviewNode(node, state))
    .filter(isPreviewNode);
  const unassignedRoots = unassignedTree
    .map((node) => buildPreviewNode(node, state))
    .filter(isPreviewNode);
  const unavailableCount = instances.filter((instance) => {
    const program = readSystemFoundationBackingResourceProgram(
      String(instance.definitionRef.id),
    );
    return !program?.styleClassName;
  }).length;
  const unassignedCount = flattenSystemComposerTree(unassignedTree).length;
  return {
    items: state.items,
    roots: previewRoots,
    unassignedRoots,
    unassignedCount,
    unavailableCount,
    truncatedCount: Math.max(0, instances.length - state.renderedCount),
  };
}

export function SystemCompositionPreview({
  systemName,
  instances,
  placements = [],
  rootInstanceRefs = [],
  catalog = [],
  includesUnsavedChanges,
}: {
  readonly systemName: string;
  readonly instances: readonly AssetInstance[];
  readonly placements?: readonly AssetPlacement[];
  readonly rootInstanceRefs?: readonly AssetReference[];
  readonly catalog?: readonly SystemBuilderComposerAsset[];
  readonly includesUnsavedChanges: boolean;
}) {
  const [viewport, setViewport] = useState<"desktop" | "tablet" | "mobile">(
    "desktop",
  );
  const model = useMemo(
    () =>
      buildSystemCompositionPreviewModel(
        instances,
        placements,
        rootInstanceRefs,
        catalog,
      ),
    [catalog, instances, placements, rootInstanceRefs],
  );

  return (
    <section
      className="system-composition-preview ui-stack ui-stack--md"
      aria-label={systemName + " current UI preview"}
    >
      <div className="system-composition-preview__summary ui-stack ui-stack--xs">
        <p>
          This design-time preview recursively renders the current slot
          hierarchy using registered, side-effect-free System Foundation
          renderers. It does not execute backend logic, activate a release, or
          deploy the system.
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
          {model.unassignedCount ? (
            <span className="ui-badge ui-badge--warning">
              {model.unassignedCount} unassigned
            </span>
          ) : null}
        </div>
      </div>

      {includesUnsavedChanges ? (
        <p className="ui-status ui-status--warning" role="status">
          This preview includes unsaved composition changes.
        </p>
      ) : null}

      <div
        className="system-composition-preview__viewports"
        role="group"
        aria-label="Preview viewport"
      >
        {(["desktop", "tablet", "mobile"] as const).map((option) => (
          <button
            key={option}
            type="button"
            className="ui-button--secondary"
            aria-pressed={viewport === option}
            onClick={() => setViewport(option)}
          >
            {option[0]!.toUpperCase() + option.slice(1)}
          </button>
        ))}
      </div>

      {model.roots.length ? (
        <div className="system-composition-preview__viewport-frame">
          <ol
            className="system-composition-preview__tree"
            data-viewport={viewport}
            aria-label="Recursive system preview"
          >
            {model.roots.map((node) => (
              <PreviewNode key={node.item.instanceId} node={node} />
            ))}
          </ol>
        </div>
      ) : (
        <EmptyState
          compact
          icon="systems"
          title="No previewable system hierarchy"
          description="Add a System Foundation asset with registered frontend backing resources to see a safe UI preview. Imported and authored frontend execution remains unavailable until a qualified sandbox is present."
        />
      )}

      {model.unassignedRoots.length ? (
        <section
          className="system-composition-preview__unassigned"
          aria-labelledby="system-preview-unassigned-title"
        >
          <h3 id="system-preview-unassigned-title">Unassigned assets</h3>
          <p>
            These assets are outside the current root hierarchy and will not
            appear in a built interface until they are placed in a compatible
            slot.
          </p>
          <ol className="system-composition-preview__tree">
            {model.unassignedRoots.map((node) => (
              <PreviewNode key={node.item.instanceId} node={node} />
            ))}
          </ol>
        </section>
      ) : null}

      {model.unavailableCount ? (
        <p className="ui-text-muted">
          {model.unavailableCount} nonvisual or unregistered asset
          {model.unavailableCount === 1 ? " is" : "s are"} represented without
          executing frontend or backend code.
        </p>
      ) : null}
      {model.truncatedCount ? (
        <p className="ui-status ui-status--warning" role="status">
          {model.truncatedCount} additional composition node
          {model.truncatedCount === 1 ? " was" : "s were"} omitted to keep the
          preview bounded.
        </p>
      ) : null}
    </section>
  );
}

function PreviewNode({
  node,
}: {
  readonly node: SystemCompositionPreviewNode;
}) {
  return (
    <li
      className="system-composition-preview__node"
      data-preview-instance={node.item.instanceId}
    >
      <div className="system-composition-preview__surface-heading">
        <div>
          <strong>{node.item.displayName}</strong>
          <small>{node.item.definitionId}</small>
        </div>
      </div>
      {node.previewAvailable ? (
        <FoundationAssetPreview
          definitionId={node.item.definitionId}
          displayName={node.item.displayName}
          configuration={node.item.configuration}
        />
      ) : (
        <div
          className="foundation-preview foundation-preview--unsupported"
          role="status"
        >
          <strong>Visual preview unavailable</strong>
          <span>
            This nonvisual or unqualified asset remains in the hierarchy, but
            its implementation is not executed.
          </span>
        </div>
      )}
      {node.slots.map((slot) => (
        <section
          key={slot.slotId}
          className="system-composition-preview__slot"
          aria-label={slot.displayName + " slot"}
        >
          <header>
            <strong>{slot.displayName}</strong>
            <small>
              {slot.children.length}{" "}
              {slot.children.length === 1 ? "asset" : "assets"}
            </small>
          </header>
          {slot.children.length ? (
            <ol className="system-composition-preview__tree">
              {slot.children.map((child) => (
                <PreviewNode key={child.item.instanceId} node={child} />
              ))}
            </ol>
          ) : (
            <span className="system-composition-preview__empty">
              Empty slot
            </span>
          )}
        </section>
      ))}
    </li>
  );
}

interface PreviewBuildState {
  renderedCount: number;
  readonly items: SystemCompositionPreviewItem[];
  readonly definitions: ReadonlyMap<string, SystemBuilderComposerAsset>;
}

function buildPreviewNode(
  node: SystemComposerTreeNode,
  state: PreviewBuildState,
): SystemCompositionPreviewNode | undefined {
  if (state.renderedCount >= MAX_SYSTEM_COMPOSITION_PREVIEW_SURFACES) {
    return undefined;
  }
  state.renderedCount += 1;
  const definitionId = String(node.instance.definitionRef.id);
  const program = readSystemFoundationBackingResourceProgram(definitionId);
  const item: SystemCompositionPreviewItem = {
    instanceId: String(node.instance.instanceId),
    definitionId,
    displayName:
      node.instance.displayName ?? program?.displayName ?? definitionId,
    configuration: node.instance.selectedConfiguration,
  };
  const previewAvailable = Boolean(program?.styleClassName);
  if (previewAvailable) state.items.push(item);
  const definition = state.definitions.get(
    definitionId + "@" + (node.instance.definitionRef.version ?? ""),
  );
  const childrenBySlot = new Map<string, SystemComposerTreeNode[]>();
  for (const child of node.children) {
    const slotId = String(child.placement?.slotId ?? "unassigned");
    const children = childrenBySlot.get(slotId) ?? [];
    children.push(child);
    childrenBySlot.set(slotId, children);
  }
  const slotIds = [
    ...(definition?.slots.map((slot) => String(slot.slotId)) ?? []),
    ...Array.from(childrenBySlot.keys()).filter(
      (slotId) =>
        !definition?.slots.some((slot) => String(slot.slotId) === slotId),
    ),
  ];
  const slots = slotIds.map((slotId) => {
    const definitionSlot = definition?.slots.find(
      (slot) => String(slot.slotId) === slotId,
    );
    return {
      slotId,
      displayName: definitionSlot?.displayName ?? slotId,
      children: (childrenBySlot.get(slotId) ?? [])
        .map((child) => buildPreviewNode(child, state))
        .filter(isPreviewNode),
    };
  });
  return { item, previewAvailable, slots };
}

function deriveRootInstanceRefs(
  instances: readonly AssetInstance[],
  placements: readonly AssetPlacement[],
): readonly AssetReference[] {
  const instanceIds = new Set(
    instances.map((instance) => String(instance.instanceId)),
  );
  const childIds = new Set(
    placements
      .map((placement) => String(placement.childInstanceRef.id))
      .filter((instanceId) => instanceIds.has(instanceId)),
  );
  return instances
    .filter((instance) => !childIds.has(String(instance.instanceId)))
    .map((instance) => ({
      kind: "asset-instance" as const,
      id: normalizeAssetId(String(instance.instanceId)),
    }));
}

function isPreviewNode(
  value: SystemCompositionPreviewNode | undefined,
): value is SystemCompositionPreviewNode {
  return Boolean(value);
}
