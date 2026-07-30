import { useMemo, useState } from "react";

import { readSystemFoundationBackingResourceProgram } from "../../../application/services/asset-packs/system-foundation-backing-resource-catalog";
import type {
  AssetInstance,
  AssetJsonValue,
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
export const MAX_SYSTEM_COMPOSITION_PREVIEW_INPUT_INSTANCES = 256;
export const MAX_SYSTEM_COMPOSITION_PREVIEW_INPUT_PLACEMENTS = 1_024;
export const MAX_SYSTEM_COMPOSITION_PREVIEW_ROOTS = 64;
export const MAX_SYSTEM_COMPOSITION_PREVIEW_TREE_NODES = 96;
export const MAX_SYSTEM_COMPOSITION_PREVIEW_DEPTH = 16;
export const MAX_SYSTEM_COMPOSITION_PREVIEW_CONFIGURATION_NODES = 256;
export const MAX_SYSTEM_COMPOSITION_PREVIEW_CONFIGURATION_DEPTH = 4;
export const MAX_SYSTEM_COMPOSITION_PREVIEW_CONFIGURATION_ARRAY_ITEMS = 50;
export const MAX_SYSTEM_COMPOSITION_PREVIEW_CONFIGURATION_KEYS = 64;
export const MAX_SYSTEM_COMPOSITION_PREVIEW_TEXT_LENGTH = 2_000;

export interface SystemCompositionPreviewItem {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly displayName: string;
  readonly version?: string;
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
  const boundedInstances = instances.slice(
    0,
    MAX_SYSTEM_COMPOSITION_PREVIEW_INPUT_INSTANCES,
  );
  const boundedInstanceIds = new Set(
    boundedInstances.map((instance) => String(instance.instanceId)),
  );
  const boundedPlacements = placements
    .slice(0, MAX_SYSTEM_COMPOSITION_PREVIEW_INPUT_PLACEMENTS)
    .filter(
      (placement) =>
        boundedInstanceIds.has(String(placement.parentInstanceRef.id)) &&
        boundedInstanceIds.has(String(placement.childInstanceRef.id)),
    );
  const explicitRoots = rootInstanceRefs
    .slice(0, MAX_SYSTEM_COMPOSITION_PREVIEW_ROOTS)
    .filter((reference) => boundedInstanceIds.has(String(reference.id)));
  const roots = explicitRoots.length
    ? explicitRoots
    : deriveRootInstanceRefs(boundedInstances, boundedPlacements).slice(
        0,
        MAX_SYSTEM_COMPOSITION_PREVIEW_ROOTS,
      );
  const draft = {
    instances: boundedInstances,
    placements: boundedPlacements,
    bindings: [],
  };
  const treeOptions = {
    maximumDepth: MAX_SYSTEM_COMPOSITION_PREVIEW_DEPTH,
    maximumNodes: MAX_SYSTEM_COMPOSITION_PREVIEW_TREE_NODES,
  };
  const canonicalTree = buildSystemComposerTree(draft, roots, treeOptions);
  const reachableIds = new Set(
    flattenSystemComposerTree(canonicalTree).map((node) =>
      String(node.instance.instanceId),
    ),
  );
  const unassignedRefs = deriveRootInstanceRefs(
    boundedInstances.filter(
      (instance) => !reachableIds.has(String(instance.instanceId)),
    ),
    boundedPlacements.filter(
      (placement) =>
        !reachableIds.has(String(placement.childInstanceRef.id)) &&
        !reachableIds.has(String(placement.parentInstanceRef.id)),
    ),
  );
  const unassignedTree = buildSystemComposerTree(
    draft,
    unassignedRefs.slice(0, MAX_SYSTEM_COMPOSITION_PREVIEW_ROOTS),
    treeOptions,
  );
  const definitions = new Map(
    catalog
      .slice(0, MAX_SYSTEM_COMPOSITION_PREVIEW_INPUT_INSTANCES)
      .map((definition) => [
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
  const unavailableCount = boundedInstances.filter((instance) => {
    const program = readSystemFoundationBackingResourceProgram(
      String(instance.definitionRef.id),
      instance.definitionRef.version as never,
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
}: {
  readonly systemName: string;
  readonly instances: readonly AssetInstance[];
  readonly placements?: readonly AssetPlacement[];
  readonly rootInstanceRefs?: readonly AssetReference[];
  readonly catalog?: readonly SystemBuilderComposerAsset[];
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
          This design-time preview recursively renders the current visual
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

      <div
        className="system-composition-preview__viewports"
        role="group"
        aria-label="Preview viewport"
      >
        {(["desktop", "tablet", "mobile"] as const).map((option) => (
          <button
            key={option}
            type="button"
            className="ui-button ui-button--outline"
            aria-pressed={viewport === option}
            onClick={() => setViewport(option)}
          >
            {option[0]!.toUpperCase() + option.slice(1)}
          </button>
        ))}
      </div>

      {model.roots.length ? (
        <div className="system-composition-preview__viewport-frame">
          <SystemCompositionPreviewSurface
            roots={model.roots}
            viewport={viewport}
          />
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
            canvas region.
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

export function SystemCompositionPreviewSurface({
  roots,
  viewport = "desktop",
}: {
  readonly roots: readonly SystemCompositionPreviewNode[];
  readonly viewport?: "desktop" | "tablet" | "mobile";
}) {
  return (
    <div
      className="system-composition-preview__surface"
      data-viewport={viewport}
      aria-label="Recursive system preview"
    >
      {roots.map((node) => (
        <ComposedPreviewNode key={node.item.instanceId} node={node} />
      ))}
    </div>
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
          aria-label={slot.displayName + " region"}
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
              Empty region
            </span>
          )}
        </section>
      ))}
    </li>
  );
}

function ComposedPreviewNode({
  node,
}: {
  readonly node: SystemCompositionPreviewNode;
}) {
  const regions = Object.fromEntries(
    node.slots.map((slot) => [
      slot.slotId,
      slot.children.map((child) => (
        <ComposedPreviewNode key={child.item.instanceId} node={child} />
      )),
    ]),
  );
  if (!node.previewAvailable) {
    return (
      <section
        className="foundation-preview foundation-preview--unsupported"
        data-foundation-definition={node.item.definitionId}
        data-preview-instance={node.item.instanceId}
        role="status"
      >
        <strong>Visual preview unavailable</strong>
        <span>{node.item.displayName}</span>
        <span>
          This asset remains in the hierarchy, but its implementation is not
          executed.
        </span>
        {node.slots.map((slot) => (
          <section key={slot.slotId} aria-label={slot.displayName + " region"}>
            {regions[slot.slotId]}
          </section>
        ))}
      </section>
    );
  }
  return (
    <div data-preview-instance={node.item.instanceId}>
      <FoundationAssetPreview
        definitionId={node.item.definitionId}
        version={node.item.version}
        displayName={node.item.displayName}
        configuration={node.item.configuration}
        presentation="composed"
        regions={regions}
      />
    </div>
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
  const program = readSystemFoundationBackingResourceProgram(
    definitionId,
    node.instance.definitionRef.version as never,
  );
  const item: SystemCompositionPreviewItem = {
    instanceId: String(node.instance.instanceId),
    definitionId,
    displayName:
      node.instance.displayName ?? program?.displayName ?? definitionId,
    version: node.instance.definitionRef.version,
    configuration: boundPreviewConfiguration(
      node.instance.selectedConfiguration,
    ),
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

function boundPreviewConfiguration(
  configuration: AssetInstance["selectedConfiguration"],
): AssetInstance["selectedConfiguration"] {
  const state = { visited: 0 };
  const bounded = boundPreviewJsonValue(configuration, 0, state);
  if (!bounded || typeof bounded !== "object" || Array.isArray(bounded)) {
    return {};
  }
  return bounded as AssetInstance["selectedConfiguration"];
}

function boundPreviewJsonValue(
  value: unknown,
  depth: number,
  state: { visited: number },
): AssetJsonValue | undefined {
  if (
    state.visited >= MAX_SYSTEM_COMPOSITION_PREVIEW_CONFIGURATION_NODES ||
    depth > MAX_SYSTEM_COMPOSITION_PREVIEW_CONFIGURATION_DEPTH
  ) return undefined;
  state.visited += 1;
  if (typeof value === "string") {
    return value.slice(0, MAX_SYSTEM_COMPOSITION_PREVIEW_TEXT_LENGTH);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    const result: AssetJsonValue[] = [];
    for (const item of value.slice(
      0,
      MAX_SYSTEM_COMPOSITION_PREVIEW_CONFIGURATION_ARRAY_ITEMS,
    )) {
      const bounded = boundPreviewJsonValue(item, depth + 1, state);
      if (bounded !== undefined) result.push(bounded);
    }
    return result;
  }
  if (value && typeof value === "object") {
    const result: Record<string, AssetJsonValue> = {};
    for (const [key, item] of Object.entries(value).slice(
      0,
      MAX_SYSTEM_COMPOSITION_PREVIEW_CONFIGURATION_KEYS,
    )) {
      if (!key || key.length > 128) continue;
      const bounded = boundPreviewJsonValue(item, depth + 1, state);
      if (bounded !== undefined) result[key] = bounded;
    }
    return result;
  }
  return undefined;
}
