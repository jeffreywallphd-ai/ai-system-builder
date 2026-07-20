import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  AssetInstance,
  AssetPlacement,
  AssetReference,
} from "../../../contracts/asset";
import type {
  SystemBuilderComposerAsset,
  SystemBuilderComposerLayoutGeometry,
} from "../../../contracts/system-builder";
import {
  ApplicationIcon,
  type ApplicationIconName,
} from "../components/ApplicationIcon";
import { EmptyState } from "../components/EmptyState";
import { FoundationAssetPreview } from "../foundation-assets";
import {
  buildSystemComposerTree,
  flattenSystemComposerTree,
  type SystemComposerDraft,
  type SystemComposerTreeNode,
} from "./systemComposerDraft";
import {
  describeSystemComposerDragData,
  describeSystemComposerDropData,
  instanceDragData,
  isSystemComposerDragData,
  paletteDragData,
  resolveSystemComposerDrop,
  slotDropData,
  targetForSystemComposerDrop,
  type SystemComposerDragData,
} from "./systemComposerDrag";
import {
  groupSystemComposerUnplacedInstances,
  isSystemComposerVisualAsset,
  systemComposerAssetForInstance,
} from "./systemComposerAssetClassification";

export interface SystemComposerTargetSlot {
  readonly parentInstanceId: string;
  readonly slotId: string;
  readonly order?: number;
}
type SystemComposerSidebarTab = "properties" | "layers";
type SystemComposerResponsivePanel = "library" | "details";
type SystemComposerPanelToggle = "library" | SystemComposerSidebarTab;

export interface SystemComposerStructureEditorProps {
  readonly draft: SystemComposerDraft;
  readonly rootInstanceRefs: readonly AssetReference[];
  readonly catalog: readonly SystemBuilderComposerAsset[];
  readonly compatibleAssets: readonly SystemBuilderComposerAsset[];
  readonly layoutOptions?: readonly SystemBuilderComposerAsset[];
  readonly selectedLayoutDefinitionId?: string;
  readonly layoutSelectionDisabled?: boolean;
  readonly selectedInstanceId?: string;
  readonly targetSlot?: SystemComposerTargetSlot;
  readonly protectedInstanceIds: ReadonlySet<string>;
  readonly propertiesPanel?: ReactNode;
  readonly catalogLoading?: boolean;
  readonly catalogError?: string;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onSelect: (instanceId: string) => void;
  readonly onTargetSlotChange: (target: SystemComposerTargetSlot) => void;
  readonly onSelectLayout?: (layout: SystemBuilderComposerAsset) => void;
  readonly onAdd: (
    asset: SystemBuilderComposerAsset,
    target: SystemComposerTargetSlot,
  ) => void;
  readonly onPlace: (
    instanceId: string,
    target: SystemComposerTargetSlot,
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
  layoutOptions = [],
  selectedLayoutDefinitionId,
  layoutSelectionDisabled = false,
  selectedInstanceId,
  targetSlot,
  protectedInstanceIds,
  propertiesPanel,
  catalogLoading = false,
  catalogError,
  canUndo,
  canRedo,
  onSelect,
  onTargetSlotChange,
  onSelectLayout,
  onAdd,
  onPlace,
  onRemove,
  onUndo,
  onRedo,
}: SystemComposerStructureEditorProps) {
  const [search, setSearch] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [activeDrag, setActiveDrag] = useState<SystemComposerDragData>();
  const [dragNotice, setDragNotice] = useState<string>();
  const [responsivePanel, setResponsivePanel] =
    useState<SystemComposerResponsivePanel>();
  const [sidebarTab, setSidebarTab] =
    useState<SystemComposerSidebarTab>("properties");
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const [collapsedInstanceIds, setCollapsedInstanceIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const panelRefs = useRef(
    new Map<SystemComposerResponsivePanel, HTMLElement>(),
  );
  const panelToggleRefs = useRef(
    new Map<SystemComposerPanelToggle, HTMLButtonElement>(),
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const treeItemRefs = useRef(new Map<string, HTMLButtonElement>());
  const tree = useMemo(
    () => buildSystemComposerTree(draft, rootInstanceRefs),
    [draft, rootInstanceRefs],
  );
  const flatTree = useMemo(() => flattenSystemComposerTree(tree), [tree]);
  const {
    unplacedInstances,
    unassignedVisualInstances,
    systemResourceInstances,
  } = useMemo(
    () =>
      groupSystemComposerUnplacedInstances({
        instances: draft.instances,
        placements: draft.placements,
        rootInstanceRefs,
        catalog,
      }),
    [catalog, draft.instances, draft.placements, rootInstanceRefs],
  );
  const visibleTreeItems = useMemo(
    () => flattenVisibleSystemComposerTree(tree, collapsedInstanceIds),
    [collapsedInstanceIds, tree],
  );
  const selectedNode =
    flatTree.find(
      (node) => String(node.instance.instanceId) === selectedInstanceId,
    ) ??
    unplacedInstances
      .filter((instance) => String(instance.instanceId) === selectedInstanceId)
      .map(
        (instance) =>
          ({ instance, depth: 1, children: [] }) as SystemComposerTreeNode,
      )[0];
  const paletteSource = targetSlot ? compatibleAssets : catalog;
  const palette = paletteSource.filter((asset) => {
    const query = search.trim().toLowerCase();
    return (
      (!targetSlot || asset.compatibility.status === "compatible") &&
      isSystemComposerVisualAsset(asset) &&
      (!query ||
        `${asset.displayName} ${asset.definitionId} ${asset.assetType}`
          .toLowerCase()
          .includes(query))
    );
  });
  const breadcrumb = selectedNode
    ? breadcrumbFor(selectedNode, draft.instances, draft.placements)
    : [];
  const visualCanvasTree = useMemo(
    () => systemComposerVisualCanvasRoots(tree, catalog),
    [catalog, tree],
  );
  const canvasTree =
    focusMode && selectedNode ? [selectedNode] : visualCanvasTree;
  const activeCanvasLayout = definitionForInstance(
    visualCanvasTree[0]?.instance,
    catalog,
  );

  const moveTreeFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    node: SystemComposerTreeNode,
  ) => {
    const id = String(node.instance.instanceId);
    const index = visibleTreeItems.findIndex(
      (item) => String(item.instance.instanceId) === id,
    );
    let nextId: string | undefined;
    if (event.key === "ArrowDown") {
      nextId = visibleTreeItems[index + 1]
        ? String(visibleTreeItems[index + 1]?.instance.instanceId)
        : undefined;
    } else if (event.key === "ArrowUp") {
      nextId = visibleTreeItems[index - 1]
        ? String(visibleTreeItems[index - 1]?.instance.instanceId)
        : undefined;
    } else if (event.key === "Home") {
      nextId = visibleTreeItems[0]
        ? String(visibleTreeItems[0]?.instance.instanceId)
        : undefined;
    } else if (event.key === "End") {
      nextId = visibleTreeItems[visibleTreeItems.length - 1]
        ? String(
            visibleTreeItems[visibleTreeItems.length - 1]?.instance.instanceId,
          )
        : undefined;
    } else if (event.key === "ArrowRight" && node.children[0]) {
      if (collapsedInstanceIds.has(id)) {
        setCollapsedInstanceIds(
          withCollapsedInstance(collapsedInstanceIds, id, false),
        );
        event.preventDefault();
        return;
      }
      nextId = String(node.children[0].instance.instanceId);
    } else if (event.key === "ArrowLeft") {
      if (node.children.length && !collapsedInstanceIds.has(id)) {
        setCollapsedInstanceIds(
          withCollapsedInstance(collapsedInstanceIds, id, true),
        );
        event.preventDefault();
        return;
      }
      nextId = node.placement
        ? String(node.placement.parentInstanceRef.id)
        : undefined;
    }
    if (!nextId) return;
    event.preventDefault();
    onSelect(nextId);
    treeItemRefs.current.get(nextId)?.focus();
  };

  const updateDragTarget = (event: DragOverEvent) => {
    const target = targetForSystemComposerDrop(
      event.over?.data.current,
      draft.placements,
    );
    if (
      target &&
      (target.parentInstanceId !== targetSlot?.parentInstanceId ||
        target.slotId !== targetSlot.slotId)
    ) {
      onTargetSlotChange(target);
    }
  };

  const finishDrag = (event: DragEndEvent) => {
    setActiveDrag(undefined);
    if (!event.over) {
      setDragNotice("Drag cancelled. No composition changes were made.");
      return;
    }
    const resolution = resolveSystemComposerDrop({
      source: event.active.data.current,
      destination: event.over.data.current,
      draft,
      catalog,
      compatibleAssets,
      compatibilityTarget: targetSlot,
      protectedInstanceIds,
    });
    if (!resolution.ok) {
      setDragNotice(resolution.message);
      return;
    }
    if (resolution.value.kind === "add") {
      onAdd(resolution.value.asset, resolution.value.target);
    } else {
      onPlace(resolution.value.instanceId, resolution.value.target);
    }
    setDragNotice(resolution.value.announcement);
  };

  const openPanel = (panel: SystemComposerPanelToggle) => {
    if (panel === "library") {
      setLibraryCollapsed(false);
      setResponsivePanel("library");
      globalThis.setTimeout(() => panelRefs.current.get("library")?.focus(), 0);
      return;
    }
    setDetailsCollapsed(false);
    setSidebarTab(panel);
    setResponsivePanel("details");
    globalThis.setTimeout(() => panelRefs.current.get("details")?.focus(), 0);
  };
  const closePanel = (panel: SystemComposerPanelToggle) => {
    setResponsivePanel(undefined);
    globalThis.setTimeout(() => panelToggleRefs.current.get(panel)?.focus(), 0);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event: DragStartEvent) => {
        const data = event.active.data.current;
        setActiveDrag(isSystemComposerDragData(data) ? data : undefined);
        setDragNotice(undefined);
      }}
      onDragOver={updateDragTarget}
      onDragEnd={finishDrag}
      onDragCancel={() => {
        setActiveDrag(undefined);
        setDragNotice("Drag cancelled. No composition changes were made.");
      }}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "Press Space to pick up an asset. Use arrow keys to move over a canvas region or asset, press Space to drop, or Escape to cancel.",
        },
        announcements: {
          onDragStart({ active }) {
            return `Picked up ${describeSystemComposerDragData(active.data.current)}.`;
          },
          onDragOver({ active, over }) {
            return over
              ? `${describeSystemComposerDragData(active.data.current)} is over ${describeSystemComposerDropData(over.data.current)}.`
              : `${describeSystemComposerDragData(active.data.current)} is not over an available canvas region.`;
          },
          onDragEnd({ active, over }) {
            return over
              ? `${describeSystemComposerDragData(active.data.current)} was dropped on ${describeSystemComposerDropData(over.data.current)}.`
              : "Drag cancelled. No composition changes were made.";
          },
          onDragCancel({ active }) {
            return `Cancelled moving ${describeSystemComposerDragData(active.data.current)}. No composition changes were made.`;
          },
        },
      }}
    >
      <div className="system-composer ui-stack ui-stack--md">
        <div
          className="system-composer__toolbar"
          role="toolbar"
          aria-label="Composition history"
        >
          <button
            type="button"
            className="system-composer__flat-control"
            onClick={onUndo}
            disabled={!canUndo}
          >
            <ApplicationIcon name="switch" />
            <span>Undo</span>
          </button>
          <button
            type="button"
            className="system-composer__flat-control"
            onClick={onRedo}
            disabled={!canRedo}
          >
            <ApplicationIcon name="refresh" />
            <span>Redo</span>
          </button>
          <button
            type="button"
            className="system-composer__flat-control"
            aria-pressed={focusMode}
            onClick={() => setFocusMode((current) => !current)}
            disabled={!selectedNode}
          >
            <ApplicationIcon name="expand" />
            <span>
              {focusMode ? "Show full canvas" : "Focus selected branch"}
            </span>
          </button>
          <div
            className="system-composer__panel-controls"
            role="group"
            aria-label="Responsive composer panels"
          >
            {(["library", "properties", "layers"] as const).map((panel) => (
              <button
                key={panel}
                ref={(element) => {
                  if (element) panelToggleRefs.current.set(panel, element);
                  else panelToggleRefs.current.delete(panel);
                }}
                type="button"
                className="system-composer__flat-control"
                aria-controls={
                  panel === "library"
                    ? "system-composer-library-panel"
                    : "system-composer-details-panel"
                }
                aria-expanded={
                  panel === "library"
                    ? responsivePanel === "library"
                    : responsivePanel === "details" && sidebarTab === panel
                }
                onClick={() =>
                  responsivePanel === panel
                    ? closePanel(panel)
                    : openPanel(panel)
                }
              >
                {panel === "library"
                  ? "Assets"
                  : panel[0]!.toUpperCase() + panel.slice(1)}
              </button>
            ))}
          </div>
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
                    className="system-composer__link-control"
                    onClick={() => onSelect(String(instance.instanceId))}
                  >
                    {instance.displayName ?? String(instance.definitionRef.id)}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}

        <div
          className="system-composer__workspace"
          data-library-collapsed={libraryCollapsed}
          data-details-collapsed={detailsCollapsed}
        >
          <aside
            id="system-composer-library-panel"
            ref={(element) => {
              if (element) panelRefs.current.set("library", element);
              else panelRefs.current.delete("library");
            }}
            tabIndex={-1}
            className="system-composer__panel system-composer__panel--library"
            data-responsive-panel="library"
            data-panel-open={responsivePanel === "library"}
            data-collapsed={libraryCollapsed}
            aria-labelledby="composer-library-title"
          >
            <header className="system-composer__panel-heading">
              <h3 id="composer-library-title">Asset Palette</h3>
              <button
                type="button"
                className="system-composer__flat-control system-composer__sidebar-collapse"
                aria-label={`${libraryCollapsed ? "Expand" : "Collapse"} Asset Palette sidebar`}
                aria-expanded={!libraryCollapsed}
                title={`${libraryCollapsed ? "Expand" : "Collapse"} Asset Palette sidebar`}
                onClick={() => setLibraryCollapsed((current) => !current)}
              >
                <ApplicationIcon
                  name={libraryCollapsed ? "expand" : "collapse"}
                />
                <span>{libraryCollapsed ? "Expand" : "Collapse"}</span>
              </button>
            </header>
            {onSelectLayout ? (
              <SystemLayoutGallery
                layouts={layoutOptions}
                selectedDefinitionId={selectedLayoutDefinitionId}
                disabled={layoutSelectionDisabled}
                mode="change"
                compact
                loading={catalogLoading}
                error={catalogError}
                onSelect={onSelectLayout}
              />
            ) : null}
            <p className="ui-text-muted">
              {targetSlot
                ? "Drag a compatible asset tile onto the highlighted Canvas region."
                : "Browse visual assets. Select a Canvas region to filter by compatibility."}
            </p>
            <label>
              {targetSlot ? "Search compatible assets" : "Search assets"}
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
                description="Try another canvas region or search term."
                icon="assets"
              />
            ) : null}
            <ul className="system-composer__palette">
              {palette.map((asset) => (
                <PaletteAssetItem
                  key={`${asset.definitionId}@${asset.version}`}
                  asset={asset}
                >
                  <span className="system-composer__palette-icon">
                    <ApplicationIcon name={iconForComposerAsset(asset)} />
                  </span>
                  <strong>{asset.displayName}</strong>
                  <span>
                    {asset.assetType} · v{asset.version}
                  </span>
                </PaletteAssetItem>
              ))}
            </ul>
            {unassignedVisualInstances.length ? (
              <section
                className="system-composer__unassigned system-composer__unassigned--palette"
                aria-labelledby="system-composer-unassigned-title"
              >
                <h4 id="system-composer-unassigned-title">
                  Unassigned visual assets
                </h4>
                <p className="ui-text-muted">
                  Visual assets preserved during a layout change. Drag each
                  asset into a compatible named region.
                </p>
                <ul>
                  {unassignedVisualInstances.map((instance, order) => (
                    <UnassignedAssetItem
                      key={String(instance.instanceId)}
                      instance={instance}
                      order={order}
                      selected={
                        String(instance.instanceId) === selectedInstanceId
                      }
                      onSelect={onSelect}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
            {systemResourceInstances.length ? (
              <section
                className="system-composer__resources system-composer__resources--palette"
                aria-labelledby="system-composer-resources-title"
              >
                <h4 id="system-composer-resources-title">
                  System resources &amp; logic
                </h4>
                <p className="ui-text-muted">
                  Nonvisual assets remain part of the system and are configured
                  through Properties or Connections. They are not Canvas
                  elements.
                </p>
                <ul>
                  {systemResourceInstances.map((instance) => (
                    <SystemResourceItem
                      key={String(instance.instanceId)}
                      instance={instance}
                      definition={systemComposerAssetForInstance(
                        instance,
                        catalog,
                      )}
                      selected={
                        String(instance.instanceId) === selectedInstanceId
                      }
                      onSelect={onSelect}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </aside>

          <section
            className="system-composer__panel system-composer__panel--canvas"
            aria-labelledby="composer-canvas-title"
            data-active-layout={activeCanvasLayout?.definitionId}
          >
            <div className="system-composer__panel-heading">
              <div>
                <h3 id="composer-canvas-title">Canvas</h3>
                <p className="ui-text-muted">
                  {activeCanvasLayout?.layoutGeometry
                    ? `${activeCanvasLayout.displayName} exposes ${activeCanvasLayout.slots.length} fixed named ${activeCanvasLayout.slots.length === 1 ? "region" : "regions"}. `
                    : ""}
                  Drag assets into fixed named regions or use the explicit
                  keyboard drag path. Canonical semantic order is preserved.
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
                description="This historical revision needs an explicit upgrade before visual layout editing."
                icon="systems"
              />
            )}
          </section>

          <aside
            id="system-composer-details-panel"
            ref={(element) => {
              if (element) panelRefs.current.set("details", element);
              else panelRefs.current.delete("details");
            }}
            tabIndex={-1}
            className="system-composer__panel system-composer__panel--details"
            data-responsive-panel="details"
            data-panel-open={responsivePanel === "details"}
            data-collapsed={detailsCollapsed}
            aria-label="Composer details"
          >
            <header className="system-composer__sidebar-header">
              <div
                className="system-composer__sidebar-tabs"
                role="tablist"
                aria-label="Composer details"
              >
                <button
                  id="system-composer-sidebar-tab-properties"
                  type="button"
                  role="tab"
                  className="system-composer__flat-control"
                  aria-selected={sidebarTab === "properties"}
                  aria-controls="system-composer-properties-panel"
                  onClick={() => setSidebarTab("properties")}
                >
                  Properties
                </button>
                <button
                  id="system-composer-sidebar-tab-layers"
                  type="button"
                  role="tab"
                  className="system-composer__flat-control"
                  aria-selected={sidebarTab === "layers"}
                  aria-controls="system-composer-layers-panel"
                  onClick={() => setSidebarTab("layers")}
                >
                  Layers &amp; Structure
                </button>
              </div>
              <button
                type="button"
                className="system-composer__flat-control system-composer__sidebar-collapse"
                aria-label={`${detailsCollapsed ? "Expand" : "Collapse"} Properties and Layers sidebar`}
                aria-expanded={!detailsCollapsed}
                title={`${detailsCollapsed ? "Expand" : "Collapse"} Properties and Layers sidebar`}
                onClick={() => setDetailsCollapsed((current) => !current)}
              >
                <ApplicationIcon
                  name={detailsCollapsed ? "expand" : "collapse"}
                />
                <span>{detailsCollapsed ? "Expand" : "Collapse"}</span>
              </button>
            </header>
            <section
              id="system-composer-properties-panel"
              role="tabpanel"
              aria-labelledby="system-composer-sidebar-tab-properties"
              hidden={sidebarTab !== "properties"}
              className="system-composer__sidebar-panel system-composer__sidebar-panel--properties"
            >
              {propertiesPanel ?? (
                <EmptyState
                  compact
                  title="Select an asset"
                  description="Choose a canvas node or layer to edit its declared properties."
                  icon="settings"
                />
              )}
            </section>

            <section
              id="system-composer-layers-panel"
              role="tabpanel"
              aria-labelledby="system-composer-sidebar-tab-layers"
              hidden={sidebarTab !== "layers"}
              className="system-composer__sidebar-panel system-composer__sidebar-panel--layers"
            >
              <p id="composer-tree-help" className="ui-text-muted">
                Use arrow keys, Home, and End to navigate. Enter or click
                selects.
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
                    collapsedInstanceIds={collapsedInstanceIds}
                    itemRefs={treeItemRefs.current}
                    onSelect={onSelect}
                    onKeyDown={moveTreeFocus}
                    onToggle={(instanceId) =>
                      setCollapsedInstanceIds(
                        withCollapsedInstance(
                          collapsedInstanceIds,
                          instanceId,
                          !collapsedInstanceIds.has(instanceId),
                        ),
                      )
                    }
                  />
                ))}
              </ul>
              {unassignedVisualInstances.length ? (
                <section className="system-composer__unassigned-layers">
                  <h4>Unassigned visual assets</h4>
                  <ul>
                    {unassignedVisualInstances.map((instance) => (
                      <li key={String(instance.instanceId)}>
                        <button
                          type="button"
                          className="system-composer__link-control"
                          aria-current={
                            String(instance.instanceId) === selectedInstanceId
                              ? "true"
                              : undefined
                          }
                          onClick={() => onSelect(String(instance.instanceId))}
                        >
                          {instance.displayName ??
                            String(instance.definitionRef.id)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {systemResourceInstances.length ? (
                <section className="system-composer__resources-layers">
                  <h4>System resources &amp; logic</h4>
                  <ul>
                    {systemResourceInstances.map((instance) => (
                      <li key={String(instance.instanceId)}>
                        <button
                          type="button"
                          className="system-composer__link-control"
                          aria-current={
                            String(instance.instanceId) === selectedInstanceId
                              ? "true"
                              : undefined
                          }
                          onClick={() => onSelect(String(instance.instanceId))}
                        >
                          {instance.displayName ??
                            String(instance.definitionRef.id)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

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
                  <button
                    type="button"
                    className="system-composer__flat-control system-composer__flat-control--danger"
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
            </section>
          </aside>
        </div>
        {dragNotice ? (
          <p
            className="system-composer__drag-notice"
            role="status"
            aria-live="polite"
          >
            {dragNotice}
          </p>
        ) : null}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeDrag ? (
          <div className="system-composer__drag-overlay">
            <ApplicationIcon name="menu" />
            <span>{activeDrag.label}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export function SystemLayoutGallery({
  layouts,
  selectedDefinitionId,
  disabled = false,
  mode = "create",
  compact = false,
  loading = false,
  error,
  onSelect,
}: {
  readonly layouts: readonly SystemBuilderComposerAsset[];
  readonly selectedDefinitionId?: string;
  readonly disabled?: boolean;
  readonly mode?: "create" | "change";
  readonly compact?: boolean;
  readonly loading?: boolean;
  readonly error?: string;
  readonly onSelect: (asset: SystemBuilderComposerAsset) => void;
}) {
  return (
    <fieldset
      className="system-layout-gallery"
      data-compact={compact}
      disabled={disabled}
    >
      <legend>{compact ? "Layout" : "Application layout"}</legend>
      <p className="ui-text-muted">
        {mode === "change"
          ? "Choose a predefined fixed region configuration. The local Canvas updates immediately and remains undoable until saved."
          : "Choose a predefined responsive region configuration for the new interaction system."}
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
              style={layoutThumbnailStyle(layout)}
            >
              {layoutThumbnailSlots(layout).map((slot) => (
                <span
                  key={slot.slotId}
                  data-layout-area={slot.slotId}
                  style={{ gridArea: slot.slotId }}
                >
                  {slot.displayName}
                </span>
              ))}
            </span>
            <strong>{layout.displayName}</strong>
            <small>
              {layout.slots.map((slot) => slot.displayName).join(" · ")}
            </small>
          </label>
        ))}
      </div>
      {loading && layouts.length === 0 ? (
        <p className="ui-text-muted" role="status">
          Loading predefined layouts...
        </p>
      ) : null}
      {!loading && error && layouts.length === 0 ? (
        <p className="ui-status ui-status--error" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && layouts.length === 0 ? (
        <p className="ui-text-muted" role="status">
          No predefined layouts are available in this workspace.
        </p>
      ) : null}
    </fieldset>
  );
}

function PaletteAssetItem({
  asset,
  children,
}: {
  readonly asset: SystemBuilderComposerAsset;
  readonly children: ReactNode;
}) {
  const draggable = useDraggable({
    id: `palette:${asset.definitionId}@${asset.version}`,
    data: paletteDragData(asset),
  });
  return (
    <li ref={draggable.setNodeRef} data-dragging={draggable.isDragging}>
      <button
        type="button"
        className="system-composer__palette-tile"
        aria-label={`Drag ${asset.displayName}`}
        {...draggable.attributes}
        {...draggable.listeners}
      >
        {children}
      </button>
    </li>
  );
}

function UnassignedAssetItem({
  instance,
  order,
  selected,
  onSelect,
}: {
  readonly instance: AssetInstance;
  readonly order: number;
  readonly selected: boolean;
  readonly onSelect: (instanceId: string) => void;
}) {
  const instanceId = String(instance.instanceId);
  const draggable = useDraggable({
    id: `unassigned:${instanceId}`,
    data: {
      kind: "instance",
      instanceId,
      definitionId: String(instance.definitionRef.id),
      version: instance.definitionRef.version ?? "",
      label: instance.displayName ?? String(instance.definitionRef.id),
      parentInstanceId: "unassigned",
      slotId: "unassigned",
      order,
    } satisfies SystemComposerDragData,
  });
  return (
    <li ref={draggable.setNodeRef} data-selected={selected}>
      <button
        type="button"
        className="system-composer__link-control"
        onClick={() => onSelect(instanceId)}
      >
        {instance.displayName ?? String(instance.definitionRef.id)}
      </button>
      <button
        type="button"
        className="system-composer__drag-handle"
        aria-label={`Drag ${instance.displayName ?? String(instance.definitionRef.id)} from Unassigned assets`}
        {...draggable.attributes}
        {...draggable.listeners}
      >
        <ApplicationIcon name="menu" />
      </button>
    </li>
  );
}

function SystemResourceItem({
  instance,
  definition,
  selected,
  onSelect,
}: {
  readonly instance: AssetInstance;
  readonly definition?: SystemBuilderComposerAsset;
  readonly selected: boolean;
  readonly onSelect: (instanceId: string) => void;
}) {
  const instanceId = String(instance.instanceId);
  return (
    <li data-selected={selected}>
      <button
        type="button"
        className="system-composer__link-control"
        onClick={() => onSelect(instanceId)}
      >
        {instance.displayName ?? String(instance.definitionRef.id)}
      </button>
      <small>{definition?.assetType ?? "nonvisual resource"}</small>
    </li>
  );
}

function TreeNode({
  node,
  selectedInstanceId,
  protectedInstanceIds,
  collapsedInstanceIds,
  itemRefs,
  onSelect,
  onKeyDown,
  onToggle,
}: {
  readonly node: SystemComposerTreeNode;
  readonly selectedInstanceId?: string;
  readonly protectedInstanceIds: ReadonlySet<string>;
  readonly collapsedInstanceIds: ReadonlySet<string>;
  readonly itemRefs: Map<string, HTMLButtonElement>;
  readonly onSelect: (instanceId: string) => void;
  readonly onKeyDown: (
    event: KeyboardEvent<HTMLButtonElement>,
    node: SystemComposerTreeNode,
  ) => void;
  readonly onToggle: (instanceId: string) => void;
}) {
  const instanceId = String(node.instance.instanceId);
  const selected = instanceId === selectedInstanceId;
  const expanded = node.children.length
    ? !collapsedInstanceIds.has(instanceId)
    : undefined;
  return (
    <li role="none">
      <div className="system-composer__tree-row" role="none">
        {node.children.length ? (
          <button
            type="button"
            className="system-composer__tree-toggle"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${node.instance.displayName ?? instanceId}`}
            data-expanded={expanded}
            tabIndex={-1}
            onClick={() => onToggle(instanceId)}
          >
            <ApplicationIcon name="chevron" />
          </button>
        ) : (
          <span className="system-composer__tree-toggle-placeholder" />
        )}
        <button
          ref={(element) => {
            if (element) itemRefs.set(instanceId, element);
            else itemRefs.delete(instanceId);
          }}
          type="button"
          role="treeitem"
          aria-level={node.depth}
          aria-selected={selected}
          aria-expanded={expanded}
          tabIndex={
            selected || (!selectedInstanceId && node.depth === 1) ? 0 : -1
          }
          onClick={() => onSelect(instanceId)}
          onKeyDown={(event) => onKeyDown(event, node)}
        >
          <span>
            {node.instance.displayName ??
              String(node.instance.definitionRef.id)}
          </span>
          {node.placement ? (
            <small>
              Region {node.placement.slotId} · layer {node.placement.order + 1}
            </small>
          ) : (
            <small>System root</small>
          )}
          {protectedInstanceIds.has(instanceId) ? (
            <span className="ui-badge ui-badge--info">Required</span>
          ) : null}
        </button>
      </div>
      {node.children.length && expanded ? (
        <ul role="group">
          {node.children.map((child) => (
            <TreeNode
              key={String(child.instance.instanceId)}
              node={child}
              selectedInstanceId={selectedInstanceId}
              protectedInstanceIds={protectedInstanceIds}
              collapsedInstanceIds={collapsedInstanceIds}
              itemRefs={itemRefs}
              onSelect={onSelect}
              onKeyDown={onKeyDown}
              onToggle={onToggle}
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
  const protectedInstance = protectedInstanceIds.has(instanceId);
  const definitionVersion =
    node.instance.definitionRef.version ?? definition?.version;
  const fixedLayout = Boolean(definition?.layoutRole);
  const layoutStyle = definition?.layoutGeometry
    ? layoutGridStyle(definition.layoutGeometry, fixedLayout)
    : undefined;
  const sortable = useSortable({
    id: `instance:${instanceId}`,
    disabled: !node.placement || protectedInstance || !definitionVersion,
    data:
      node.placement && definitionVersion
        ? instanceDragData({
            instanceId,
            definitionId: String(node.instance.definitionRef.id),
            version: definitionVersion,
            label:
              node.instance.displayName ??
              String(node.instance.definitionRef.id),
            placement: node.placement,
          })
        : undefined,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.42 : undefined,
  };
  return (
    <article
      ref={sortable.setNodeRef}
      style={style}
      className="system-composer__canvas-node"
      data-instance-id={instanceId}
      data-selected={instanceId === selectedInstanceId}
      data-dragging={sortable.isDragging}
      data-layout-container={fixedLayout}
      data-containment-container={Boolean(definition?.slots.length)}
    >
      <div className="system-composer__canvas-node-heading">
        <button
          type="button"
          className="system-composer__canvas-node-select"
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
          {protectedInstance ? (
            <span className="ui-badge ui-badge--info">Required</span>
          ) : null}
        </button>
        {node.placement && !protectedInstance && definitionVersion ? (
          <button
            type="button"
            className="system-composer__drag-handle"
            aria-label={`Drag ${node.instance.displayName ?? instanceId}`}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <ApplicationIcon name="menu" />
            <span>Drag</span>
          </button>
        ) : null}
      </div>
      {definition?.previewAvailability === "trusted-declarative" &&
      !definition.layoutRole &&
      definition.slots.length === 0 ? (
        <div
          className="system-composer__editable-preview"
          aria-label={`${node.instance.displayName ?? definition.displayName} safe visual preview`}
        >
          <FoundationAssetPreview
            definitionId={definition.definitionId}
            version={definition.version}
            displayName={node.instance.displayName ?? definition.displayName}
            configuration={node.instance.selectedConfiguration}
            presentation="composed"
          />
        </div>
      ) : null}
      {definition?.slots.length ? (
        <div className="system-composer__slots" style={layoutStyle}>
          {definition.slots.map((slot) => (
            <CanvasSlot
              key={slot.slotId}
              parentInstanceId={instanceId}
              slot={slot}
              childrenNodes={node.children.filter(
                (child) => child.placement?.slotId === slot.slotId,
              )}
              catalog={catalog}
              selectedInstanceId={selectedInstanceId}
              targetSlot={targetSlot}
              protectedInstanceIds={protectedInstanceIds}
              onSelect={onSelect}
              onTargetSlotChange={onTargetSlotChange}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function CanvasSlot({
  parentInstanceId,
  slot,
  childrenNodes,
  catalog,
  selectedInstanceId,
  targetSlot,
  protectedInstanceIds,
  onSelect,
  onTargetSlotChange,
}: {
  readonly parentInstanceId: string;
  readonly slot: SystemBuilderComposerAsset["slots"][number];
  readonly childrenNodes: readonly SystemComposerTreeNode[];
  readonly catalog: readonly SystemBuilderComposerAsset[];
  readonly selectedInstanceId?: string;
  readonly targetSlot?: SystemComposerTargetSlot;
  readonly protectedInstanceIds: ReadonlySet<string>;
  readonly onSelect: (instanceId: string) => void;
  readonly onTargetSlotChange: (target: SystemComposerTargetSlot) => void;
}) {
  const selectedTarget =
    targetSlot?.parentInstanceId === parentInstanceId &&
    targetSlot.slotId === slot.slotId;
  const droppable = useDroppable({
    id: `slot:${parentInstanceId}:${slot.slotId}`,
    data: slotDropData({
      parentInstanceId,
      slotId: slot.slotId,
      label: `${slot.displayName} region`,
    }),
  });
  return (
    <section
      ref={droppable.setNodeRef}
      className="system-composer__slot"
      data-target={selectedTarget}
      data-drag-over={droppable.isOver}
      data-slot-id={slot.slotId}
      style={{ gridArea: slot.slotId }}
      aria-label={`${slot.displayName} region`}
    >
      <header>
        <button
          type="button"
          className="system-composer__region-selector"
          aria-label={`Select ${slot.displayName} region`}
          aria-pressed={selectedTarget}
          onClick={() =>
            onTargetSlotChange({
              parentInstanceId,
              slotId: String(slot.slotId),
            })
          }
        >
          <strong>{slot.displayName}</strong>
        </button>
        <small>
          {childrenNodes.length}/{slot.cardinality.maxItems}
        </small>
      </header>
      <p>{slot.description ?? "Canvas drop region"}</p>
      <SortableContext
        items={childrenNodes.map(
          (child) => `instance:${String(child.instance.instanceId)}`,
        )}
        strategy={verticalListSortingStrategy}
      >
        {childrenNodes.map((child) => (
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
      </SortableContext>
      {childrenNodes.length === 0 ? (
        <span className="system-composer__slot-empty">Drop assets here</span>
      ) : null}
    </section>
  );
}

function withCollapsedInstance(
  current: ReadonlySet<string>,
  instanceId: string,
  collapsed: boolean,
): ReadonlySet<string> {
  const next = new Set(current);
  if (collapsed) next.add(instanceId);
  else next.delete(instanceId);
  return next;
}

function flattenVisibleSystemComposerTree(
  tree: readonly SystemComposerTreeNode[],
  collapsedInstanceIds: ReadonlySet<string>,
): readonly SystemComposerTreeNode[] {
  const visible: SystemComposerTreeNode[] = [];
  const visit = (node: SystemComposerTreeNode) => {
    visible.push(node);
    if (collapsedInstanceIds.has(String(node.instance.instanceId))) return;
    node.children.forEach(visit);
  };
  tree.forEach(visit);
  return visible;
}

function definitionForInstance(
  instance: AssetInstance | undefined,
  catalog: readonly SystemBuilderComposerAsset[],
): SystemBuilderComposerAsset | undefined {
  return systemComposerAssetForInstance(instance, catalog);
}

function layoutGridStyle(
  geometry: SystemBuilderComposerLayoutGeometry,
  fixedLayout = true,
): CSSProperties {
  return {
    gridTemplateAreas: geometry.areas
      .map((row) => `"${row.join(" ")}"`)
      .join(" "),
    gridTemplateColumns:
      geometry.columnPattern === "single"
        ? "minmax(0, 1fr)"
        : geometry.columnPattern === "three-panel"
          ? "minmax(7rem, 0.3fr) minmax(12rem, 1fr) minmax(7rem, 0.3fr)"
          : geometry.columnPattern === "equal-split"
            ? "repeat(2, minmax(10rem, 1fr))"
            : geometry.columnPattern === "start-content"
              ? "minmax(8rem, 0.32fr) minmax(14rem, 1fr)"
              : "minmax(14rem, 1fr) minmax(8rem, 0.32fr)",
    gridTemplateRows: fixedLayout
      ? geometry.areas
          .map((row) =>
            row.every((area) =>
              ["top-bar", "page-header", "footer"].includes(area),
            )
              ? "4rem"
              : "minmax(14rem, 1fr)",
          )
          .join(" ")
      : geometry.areas.map(() => "minmax(5rem, auto)").join(" "),
  };
}

function layoutThumbnailStyle(
  layout: SystemBuilderComposerAsset,
): CSSProperties | undefined {
  const geometry = layout.layoutGeometry;
  if (!geometry) return undefined;
  return {
    gridTemplateAreas: geometry.areas
      .map((row) => `"${row.join(" ")}"`)
      .join(" "),
    gridTemplateColumns:
      geometry.columnPattern === "three-panel"
        ? "0.55fr 1.4fr 0.55fr"
        : geometry.columnPattern === "start-content"
          ? "0.65fr 1.35fr"
          : geometry.columnPattern === "content-end"
            ? "1.35fr 0.65fr"
            : geometry.columnPattern === "equal-split"
              ? "repeat(2, 1fr)"
              : "1fr",
    gridTemplateRows: `repeat(${geometry.areas.length}, minmax(0.7rem, 1fr))`,
  };
}

function layoutThumbnailSlots(
  layout: SystemBuilderComposerAsset,
): readonly SystemBuilderComposerAsset["slots"][number][] {
  const sourceOrder = layout.layoutGeometry?.sourceOrder;
  if (!sourceOrder) return layout.slots;
  const byId = new Map(layout.slots.map((slot) => [String(slot.slotId), slot]));
  return sourceOrder.flatMap((slotId) => {
    const slot = byId.get(String(slotId));
    return slot ? [slot] : [];
  });
}

function iconForComposerAsset(
  asset: SystemBuilderComposerAsset,
): ApplicationIconName {
  const identity =
    `${asset.definitionId} ${asset.assetType} ${asset.assetFamily}`.toLowerCase();
  if (identity.includes("security") || identity.includes("policy")) {
    return "security";
  }
  if (identity.includes("image")) return "image-generation";
  if (
    identity.includes("data") ||
    identity.includes("table") ||
    identity.includes("form") ||
    identity.includes("record")
  ) {
    return "dataset";
  }
  if (identity.includes("navigation") || identity.includes("menu")) {
    return "menu";
  }
  if (identity.includes("link") || identity.includes("connection")) {
    return "link";
  }
  if (identity.includes("model")) return "models";
  if (identity.includes("system")) return "systems";
  if (
    identity.includes("page") ||
    identity.includes("layout") ||
    identity.includes("container") ||
    identity.includes("card")
  ) {
    return "library";
  }
  return "assets";
}

function systemComposerVisualCanvasRoots(
  tree: readonly SystemComposerTreeNode[],
  catalog: readonly SystemBuilderComposerAsset[],
): readonly SystemComposerTreeNode[] {
  const applicationLayouts = tree.flatMap((root) =>
    root.children.filter(
      (child) =>
        definitionForInstance(child.instance, catalog)?.layoutRole ===
        "application-shell",
    ),
  );
  return applicationLayouts.length ? applicationLayouts : tree;
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
