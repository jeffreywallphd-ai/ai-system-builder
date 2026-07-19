import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type {
  AssetInstance,
  AssetPlacement,
  AssetReference,
} from "../../../contracts/asset";
import type { SystemBuilderComposerAsset } from "../../../contracts/system-builder";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { EmptyState } from "../components/EmptyState";
import {
  buildSystemComposerTree,
  flattenSystemComposerTree,
  type SystemComposerDraft,
  type SystemComposerTreeNode,
} from "./systemComposerDraft";

export interface SystemComposerTargetSlot {
  readonly parentInstanceId: string;
  readonly slotId: string;
}
export interface SystemComposerWrapCompatibility {
  readonly status: "idle" | "checking" | "compatible" | "incompatible";
  readonly reason?: string;
}

export interface SystemComposerStructureEditorProps {
  readonly draft: SystemComposerDraft;
  readonly rootInstanceRefs: readonly AssetReference[];
  readonly catalog: readonly SystemBuilderComposerAsset[];
  readonly compatibleAssets: readonly SystemBuilderComposerAsset[];
  readonly selectedInstanceId?: string;
  readonly targetSlot?: SystemComposerTargetSlot;
  readonly protectedInstanceIds: ReadonlySet<string>;
  readonly catalogLoading?: boolean;
  readonly catalogError?: string;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onSelect: (instanceId: string) => void;
  readonly onTargetSlotChange: (target: SystemComposerTargetSlot) => void;
  readonly onAdd: (
    asset: SystemBuilderComposerAsset,
    target: SystemComposerTargetSlot,
  ) => void;
  readonly onMove: (offset: -1 | 1) => void;
  readonly onReparent: (target: SystemComposerTargetSlot) => void;
  readonly onWrap: (
    wrapper: SystemBuilderComposerAsset,
    wrapperSlotId: string,
  ) => void;
  readonly wrapCompatibility?: SystemComposerWrapCompatibility;
  readonly onWrapTargetChange?: (
    wrapper: SystemBuilderComposerAsset | undefined,
    wrapperSlotId: string | undefined,
  ) => void;
  readonly onRemove: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}

export function SystemComposerStructureEditor({
  draft,
  rootInstanceRefs,
  catalog,
  compatibleAssets,
  selectedInstanceId,
  targetSlot,
  protectedInstanceIds,
  catalogLoading = false,
  catalogError,
  canUndo,
  canRedo,
  onSelect,
  onTargetSlotChange,
  onAdd,
  onMove,
  onReparent,
  onWrap,
  wrapCompatibility = { status: "idle" },
  onWrapTargetChange,
  onRemove,
  onUndo,
  onRedo,
}: SystemComposerStructureEditorProps) {
  const [search, setSearch] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [reparentParentId, setReparentParentId] = useState("");
  const [reparentSlotId, setReparentSlotId] = useState("");
  const [wrapperDefinitionId, setWrapperDefinitionId] = useState("");
  const [wrapperSlotId, setWrapperSlotId] = useState("");
  const treeItemRefs = useRef(new Map<string, HTMLButtonElement>());
  const tree = useMemo(
    () => buildSystemComposerTree(draft, rootInstanceRefs),
    [draft, rootInstanceRefs],
  );
  const flatTree = useMemo(() => flattenSystemComposerTree(tree), [tree]);
  const selectedNode = flatTree.find(
    (node) => String(node.instance.instanceId) === selectedInstanceId,
  );
  const selectedPlacement = draft.placements.find(
    (placement) => String(placement.childInstanceRef.id) === selectedInstanceId,
  );
  const palette = compatibleAssets.filter((asset) => {
    const query = search.trim().toLowerCase();
    return (
      asset.compatibility.status === "compatible" &&
      (!query ||
        `${asset.displayName} ${asset.definitionId} ${asset.assetType}`
          .toLowerCase()
          .includes(query))
    );
  });
  const reparentDefinition = definitionForInstance(
    draft.instances.find(
      (instance) => String(instance.instanceId) === reparentParentId,
    ),
    catalog,
  );
  const wrappers = compatibleAssets.filter(
    (asset) =>
      asset.compatibility.status === "compatible" && asset.slots.length > 0,
  );
  const selectedWrapper = wrappers.find(
    (asset) => asset.definitionId === wrapperDefinitionId,
  );
  const breadcrumb = selectedNode
    ? breadcrumbFor(selectedNode, draft.instances, draft.placements)
    : [];
  const canvasTree = focusMode && selectedNode ? [selectedNode] : tree;

  const moveTreeFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    node: SystemComposerTreeNode,
  ) => {
    const id = String(node.instance.instanceId);
    const index = flatTree.findIndex(
      (item) => String(item.instance.instanceId) === id,
    );
    let nextId: string | undefined;
    if (event.key === "ArrowDown") {
      nextId = flatTree[index + 1]
        ? String(flatTree[index + 1]?.instance.instanceId)
        : undefined;
    } else if (event.key === "ArrowUp") {
      nextId = flatTree[index - 1]
        ? String(flatTree[index - 1]?.instance.instanceId)
        : undefined;
    } else if (event.key === "Home") {
      nextId = flatTree[0]
        ? String(flatTree[0]?.instance.instanceId)
        : undefined;
    } else if (event.key === "End") {
      nextId = flatTree[flatTree.length - 1]
        ? String(flatTree[flatTree.length - 1]?.instance.instanceId)
        : undefined;
    } else if (event.key === "ArrowRight" && node.children[0]) {
      nextId = String(node.children[0].instance.instanceId);
    } else if (event.key === "ArrowLeft" && node.placement) {
      nextId = String(node.placement.parentInstanceRef.id);
    }
    if (!nextId) return;
    event.preventDefault();
    onSelect(nextId);
    treeItemRefs.current.get(nextId)?.focus();
  };

  return (
    <div className="system-composer ui-stack ui-stack--md">
      <div
        className="system-composer__toolbar"
        role="toolbar"
        aria-label="Composition history"
      >
        <button
          type="button"
          className="ui-button--secondary"
          onClick={onUndo}
          disabled={!canUndo}
        >
          <ApplicationIcon name="switch" />
          <span>Undo</span>
        </button>
        <button
          type="button"
          className="ui-button--secondary"
          onClick={onRedo}
          disabled={!canRedo}
        >
          <ApplicationIcon name="refresh" />
          <span>Redo</span>
        </button>
        <button
          type="button"
          className="ui-button--secondary"
          aria-pressed={focusMode}
          onClick={() => setFocusMode((current) => !current)}
          disabled={!selectedNode}
        >
          <ApplicationIcon name="expand" />
          <span>
            {focusMode ? "Show full canvas" : "Focus selected branch"}
          </span>
        </button>
      </div>

      {breadcrumb.length ? (
        <nav
          className="system-composer__breadcrumbs"
          aria-label="Selected asset path"
        >
          <ol>
            {breadcrumb.map((instance) => (
              <li key={String(instance.instanceId)}>
                <button
                  type="button"
                  onClick={() => onSelect(String(instance.instanceId))}
                >
                  {instance.displayName ?? String(instance.definitionRef.id)}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <div className="system-composer__workspace">
        <aside
          className="system-composer__panel"
          aria-labelledby="composer-library-title"
        >
          <h3 id="composer-library-title">Asset Library</h3>
          <p className="ui-text-muted">
            Choose a slot on the canvas, then add a compatible exact asset
            version.
          </p>
          {targetSlot ? (
            <p className="system-composer__target" role="status">
              Adding to{" "}
              <strong>
                {labelForInstance(targetSlot.parentInstanceId, draft.instances)}
              </strong>
              <span> / {targetSlot.slotId}</span>
            </p>
          ) : (
            <p className="ui-status ui-status--info">
              Choose an insertion slot.
            </p>
          )}
          <label>
            Search compatible assets
            <input
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Card, navigation, form..."
            />
          </label>
          {catalogError ? (
            <p className="ui-status ui-status--error" role="alert">
              {catalogError}
            </p>
          ) : null}
          {catalogLoading ? (
            <p className="ui-text-muted" role="status">
              Loading compatible assets...
            </p>
          ) : null}
          {!catalogLoading && targetSlot && palette.length === 0 ? (
            <EmptyState
              compact
              title="No compatible assets"
              description="Try another slot or search term."
              icon="assets"
            />
          ) : null}
          <ul className="system-composer__palette">
            {palette.map((asset) => (
              <li key={`${asset.definitionId}@${asset.version}`}>
                <div>
                  <strong>{asset.displayName}</strong>
                  <span>
                    {asset.assetType} · v{asset.version}
                  </span>
                </div>
                <button
                  type="button"
                  className="ui-button--secondary"
                  disabled={!targetSlot}
                  onClick={() => targetSlot && onAdd(asset, targetSlot)}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section
          className="system-composer__panel"
          aria-labelledby="composer-canvas-title"
        >
          <div className="system-composer__panel-heading">
            <div>
              <h3 id="composer-canvas-title">Semantic canvas</h3>
              <p className="ui-text-muted">
                Named slots preserve semantic source and keyboard order.
              </p>
            </div>
          </div>
          {canvasTree.length ? (
            <div className="system-composer__canvas">
              {canvasTree.map((node) => (
                <CanvasNode
                  key={String(node.instance.instanceId)}
                  node={node}
                  catalog={catalog}
                  selectedInstanceId={selectedInstanceId}
                  targetSlot={targetSlot}
                  protectedInstanceIds={protectedInstanceIds}
                  onSelect={onSelect}
                  onTargetSlotChange={onTargetSlotChange}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              title="No canonical hierarchy"
              description="This historical revision needs an explicit upgrade before slot editing."
              icon="systems"
            />
          )}
        </section>

        <aside
          className="system-composer__panel"
          aria-labelledby="composer-hierarchy-title"
        >
          <h3 id="composer-hierarchy-title">Hierarchy and actions</h3>
          <p id="composer-tree-help" className="ui-text-muted">
            Use arrow keys, Home, and End to navigate. Enter or click selects.
          </p>
          <ul
            role="tree"
            aria-label="System asset hierarchy"
            aria-describedby="composer-tree-help"
            className="system-composer__tree"
          >
            {tree.map((node) => (
              <TreeNode
                key={String(node.instance.instanceId)}
                node={node}
                selectedInstanceId={selectedInstanceId}
                protectedInstanceIds={protectedInstanceIds}
                itemRefs={treeItemRefs.current}
                onSelect={onSelect}
                onKeyDown={moveTreeFocus}
              />
            ))}
          </ul>

          {selectedNode ? (
            <div className="system-composer__actions ui-stack ui-stack--sm">
              <dl>
                <dt>Selected</dt>
                <dd>
                  {selectedNode.instance.displayName ??
                    String(selectedNode.instance.definitionRef.id)}
                </dd>
                <dt>Exact definition</dt>
                <dd>
                  {String(selectedNode.instance.definitionRef.id)}@
                  {selectedNode.instance.definitionRef.version}
                </dd>
              </dl>
              {protectedInstanceIds.has(
                String(selectedNode.instance.instanceId),
              ) ? (
                <p className="ui-status ui-status--info">
                  Required by the selected layout
                </p>
              ) : null}
              <div className="ui-inline-actions">
                <button
                  type="button"
                  className="ui-button--secondary"
                  onClick={() => onMove(-1)}
                  disabled={!selectedPlacement || selectedPlacement.order === 0}
                >
                  Move before
                </button>
                <button
                  type="button"
                  className="ui-button--secondary"
                  onClick={() => onMove(1)}
                  disabled={!selectedPlacement}
                >
                  Move after
                </button>
              </div>

              <fieldset disabled={!selectedPlacement}>
                <legend>Move to another slot</legend>
                <label>
                  Parent
                  <select
                    value={reparentParentId}
                    onChange={(event) => {
                      setReparentParentId(event.currentTarget.value);
                      setReparentSlotId("");
                    }}
                  >
                    <option value="">Choose parent</option>
                    {draft.instances
                      .filter(
                        (instance) =>
                          String(instance.instanceId) !== selectedInstanceId,
                      )
                      .map((instance) => (
                        <option
                          key={String(instance.instanceId)}
                          value={String(instance.instanceId)}
                        >
                          {instance.displayName ??
                            String(instance.definitionRef.id)}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Slot
                  <select
                    value={reparentSlotId}
                    onChange={(event) =>
                      setReparentSlotId(event.currentTarget.value)
                    }
                    disabled={!reparentDefinition}
                  >
                    <option value="">Choose slot</option>
                    {reparentDefinition?.slots.map((slot) => (
                      <option key={slot.slotId} value={slot.slotId}>
                        {slot.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="ui-button--secondary"
                  disabled={!reparentParentId || !reparentSlotId}
                  onClick={() =>
                    onReparent({
                      parentInstanceId: reparentParentId,
                      slotId: reparentSlotId,
                    })
                  }
                >
                  Move asset
                </button>
              </fieldset>

              <fieldset disabled={!selectedPlacement}>
                <legend>Wrap in a container</legend>
                <label>
                  Container
                  <select
                    value={wrapperDefinitionId}
                    onChange={(event) => {
                      setWrapperDefinitionId(event.currentTarget.value);
                      setWrapperSlotId("");
                      onWrapTargetChange?.(undefined, undefined);
                    }}
                  >
                    <option value="">Choose compatible container</option>
                    {wrappers.map((asset) => (
                      <option
                        key={`${asset.definitionId}@${asset.version}`}
                        value={asset.definitionId}
                      >
                        {asset.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Container slot
                  <select
                    value={wrapperSlotId}
                    onChange={(event) => {
                      const slotId = event.currentTarget.value;
                      setWrapperSlotId(slotId);
                      onWrapTargetChange?.(
                        selectedWrapper,
                        slotId || undefined,
                      );
                    }}
                    disabled={!selectedWrapper}
                  >
                    <option value="">Choose slot</option>
                    {selectedWrapper?.slots.map((slot) => (
                      <option key={slot.slotId} value={slot.slotId}>
                        {slot.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                {wrapCompatibility.status === "checking" ? (
                  <p className="ui-text-muted" role="status">
                    Checking child compatibility...
                  </p>
                ) : null}
                {wrapCompatibility.status === "incompatible" ? (
                  <p className="ui-status ui-status--info">
                    {wrapCompatibility.reason ??
                      "The selected asset is not accepted by this wrapper slot."}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="ui-button--secondary"
                  disabled={
                    !selectedWrapper ||
                    !wrapperSlotId ||
                    wrapCompatibility.status !== "compatible"
                  }
                  onClick={() =>
                    selectedWrapper && onWrap(selectedWrapper, wrapperSlotId)
                  }
                >
                  Wrap asset
                </button>
              </fieldset>

              <button
                type="button"
                className="ui-button--danger"
                onClick={onRemove}
                disabled={protectedInstanceIds.has(
                  String(selectedNode.instance.instanceId),
                )}
              >
                <ApplicationIcon name="delete" />
                <span>Remove selected subtree</span>
              </button>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

export function SystemLayoutGallery({
  layouts,
  selectedDefinitionId,
  disabled = false,
  onSelect,
}: {
  readonly layouts: readonly SystemBuilderComposerAsset[];
  readonly selectedDefinitionId?: string;
  readonly disabled?: boolean;
  readonly onSelect: (asset: SystemBuilderComposerAsset) => void;
}) {
  return (
    <fieldset className="system-layout-gallery" disabled={disabled}>
      <legend>Application layout</legend>
      <p className="ui-text-muted">
        Choose a predefined responsive slot configuration for the new
        interaction system.
      </p>
      <div className="system-layout-gallery__grid">
        {layouts.map((layout) => (
          <label
            key={`${layout.definitionId}@${layout.version}`}
            className="system-layout-gallery__card"
          >
            <input
              type="radio"
              name="system-layout"
              value={layout.definitionId}
              checked={selectedDefinitionId === layout.definitionId}
              onChange={() => onSelect(layout)}
            />
            <span
              className="system-layout-gallery__thumbnail"
              aria-hidden="true"
            >
              {layout.slots.slice(0, 4).map((slot) => (
                <span key={slot.slotId}>{slot.displayName}</span>
              ))}
            </span>
            <strong>{layout.displayName}</strong>
            <small>
              {layout.slots.map((slot) => slot.displayName).join(" · ")}
            </small>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function TreeNode({
  node,
  selectedInstanceId,
  protectedInstanceIds,
  itemRefs,
  onSelect,
  onKeyDown,
}: {
  readonly node: SystemComposerTreeNode;
  readonly selectedInstanceId?: string;
  readonly protectedInstanceIds: ReadonlySet<string>;
  readonly itemRefs: Map<string, HTMLButtonElement>;
  readonly onSelect: (instanceId: string) => void;
  readonly onKeyDown: (
    event: KeyboardEvent<HTMLButtonElement>,
    node: SystemComposerTreeNode,
  ) => void;
}) {
  const instanceId = String(node.instance.instanceId);
  const selected = instanceId === selectedInstanceId;
  return (
    <li role="none">
      <button
        ref={(element) => {
          if (element) itemRefs.set(instanceId, element);
          else itemRefs.delete(instanceId);
        }}
        type="button"
        role="treeitem"
        aria-level={node.depth}
        aria-selected={selected}
        aria-expanded={node.children.length ? true : undefined}
        tabIndex={
          selected || (!selectedInstanceId && node.depth === 1) ? 0 : -1
        }
        onClick={() => onSelect(instanceId)}
        onKeyDown={(event) => onKeyDown(event, node)}
      >
        <span>
          {node.instance.displayName ?? String(node.instance.definitionRef.id)}
        </span>
        {node.placement ? (
          <small>
            {node.placement.slotId} · {node.placement.order + 1}
          </small>
        ) : (
          <small>System root</small>
        )}
        {protectedInstanceIds.has(instanceId) ? (
          <span className="ui-badge ui-badge--info">Required</span>
        ) : null}
      </button>
      {node.children.length ? (
        <ul role="group">
          {node.children.map((child) => (
            <TreeNode
              key={String(child.instance.instanceId)}
              node={child}
              selectedInstanceId={selectedInstanceId}
              protectedInstanceIds={protectedInstanceIds}
              itemRefs={itemRefs}
              onSelect={onSelect}
              onKeyDown={onKeyDown}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function CanvasNode({
  node,
  catalog,
  selectedInstanceId,
  targetSlot,
  protectedInstanceIds,
  onSelect,
  onTargetSlotChange,
}: {
  readonly node: SystemComposerTreeNode;
  readonly catalog: readonly SystemBuilderComposerAsset[];
  readonly selectedInstanceId?: string;
  readonly targetSlot?: SystemComposerTargetSlot;
  readonly protectedInstanceIds: ReadonlySet<string>;
  readonly onSelect: (instanceId: string) => void;
  readonly onTargetSlotChange: (target: SystemComposerTargetSlot) => void;
}) {
  const instanceId = String(node.instance.instanceId);
  const definition = definitionForInstance(node.instance, catalog);
  return (
    <article
      className="system-composer__canvas-node"
      data-selected={instanceId === selectedInstanceId}
    >
      <button
        type="button"
        className="system-composer__canvas-node-heading"
        aria-pressed={instanceId === selectedInstanceId}
        onClick={() => onSelect(instanceId)}
      >
        <span>
          <strong>
            {node.instance.displayName ??
              String(node.instance.definitionRef.id)}
          </strong>
          <small>
            {String(node.instance.definitionRef.id)}@
            {node.instance.definitionRef.version}
          </small>
        </span>
        {protectedInstanceIds.has(instanceId) ? (
          <span className="ui-badge ui-badge--info">Required</span>
        ) : null}
      </button>
      {definition?.slots.length ? (
        <div className="system-composer__slots">
          {definition.slots.map((slot) => {
            const children = node.children.filter(
              (child) => child.placement?.slotId === slot.slotId,
            );
            const selectedTarget =
              targetSlot?.parentInstanceId === instanceId &&
              targetSlot.slotId === slot.slotId;
            return (
              <section
                key={slot.slotId}
                className="system-composer__slot"
                data-target={selectedTarget}
                aria-label={`${slot.displayName} slot`}
              >
                <header>
                  <strong>{slot.displayName}</strong>
                  <small>
                    {children.length}/{slot.cardinality.maxItems}
                  </small>
                </header>
                <p>{slot.description ?? "Named insertion region"}</p>
                <button
                  type="button"
                  className="ui-button--tertiary"
                  aria-pressed={selectedTarget}
                  disabled={children.length >= slot.cardinality.maxItems}
                  onClick={() =>
                    onTargetSlotChange({
                      parentInstanceId: instanceId,
                      slotId: slot.slotId,
                    })
                  }
                >
                  Add here
                </button>
                {children.map((child) => (
                  <CanvasNode
                    key={String(child.instance.instanceId)}
                    node={child}
                    catalog={catalog}
                    selectedInstanceId={selectedInstanceId}
                    targetSlot={targetSlot}
                    protectedInstanceIds={protectedInstanceIds}
                    onSelect={onSelect}
                    onTargetSlotChange={onTargetSlotChange}
                  />
                ))}
                {children.length === 0 ? (
                  <span className="system-composer__slot-empty">
                    Empty slot
                  </span>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

function definitionForInstance(
  instance: AssetInstance | undefined,
  catalog: readonly SystemBuilderComposerAsset[],
): SystemBuilderComposerAsset | undefined {
  if (!instance) return undefined;
  return catalog.find(
    (asset) =>
      asset.definitionId === String(instance.definitionRef.id) &&
      asset.version === instance.definitionRef.version,
  );
}

function breadcrumbFor(
  selected: SystemComposerTreeNode,
  instances: readonly AssetInstance[],
  placements: readonly AssetPlacement[],
): readonly AssetInstance[] {
  const byId = new Map(
    instances.map((instance) => [String(instance.instanceId), instance]),
  );
  const byChild = new Map(
    placements.map((placement) => [
      String(placement.childInstanceRef.id),
      String(placement.parentInstanceRef.id),
    ]),
  );
  const path: AssetInstance[] = [];
  let currentId: string | undefined = String(selected.instance.instanceId);
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId) && path.length <= 32) {
    seen.add(currentId);
    const instance = byId.get(currentId);
    if (instance) path.unshift(instance);
    currentId = byChild.get(currentId);
  }
  return path;
}

function labelForInstance(
  instanceId: string,
  instances: readonly AssetInstance[],
): string {
  const instance = instances.find(
    (item) => String(item.instanceId) === instanceId,
  );
  return instance?.displayName ?? instanceId;
}
