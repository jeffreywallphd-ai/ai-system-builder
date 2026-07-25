import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type {
  AssetInstance,
  AssetPlacement,
  AssetReference,
} from "../../../contracts/asset";
import type {
  SystemBuilderComposerAsset,
  SystemBuilderComposerCatalog,
  SystemBuilderComposerLayoutGeometry,
  SystemBuilderResult,
} from "../../../contracts/system-builder";
import {
  ApplicationIcon,
  type ApplicationIconName,
} from "../components/ApplicationIcon";
import { EmptyState } from "../components/EmptyState";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { ModalDialog } from "../components/ModalDialog";
import { FoundationAssetPreview } from "../foundation-assets";
import {
  buildSystemComposerTree,
  flattenSystemComposerTree,
  type SystemComposerDraft,
  type SystemComposerTreeNode,
} from "./systemComposerDraft";
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

export type SystemComposerSidebarTab = "properties" | "styling" | "layers";

export interface SystemComposerAssetBrowseRequest {
  readonly searchText?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

interface SystemComposerCanvasSlot {
  readonly slot: SystemBuilderComposerAsset["slots"][number];
  readonly editable: boolean;
}

interface AssetPickerState {
  readonly parentInstanceId: string;
  readonly slotId: string;
}

interface MoveTarget {
  readonly key: string;
  readonly label: string;
  readonly target: SystemComposerTargetSlot;
}

const EMPTY_COMPOSER_ASSETS: readonly SystemBuilderComposerAsset[] = [];

type ComposerAssetBrowseCategoryId =
  | "containers"
  | "navigation"
  | "forms"
  | "actions"
  | "content"
  | "feedback"
  | "conversation"
  | "other";

interface ComposerAssetBrowseCategory {
  readonly id: ComposerAssetBrowseCategoryId;
  readonly label: string;
  readonly description: string;
}

const COMPOSER_ASSET_BROWSE_CATEGORIES: readonly ComposerAssetBrowseCategory[] =
  [
    {
      id: "containers",
      label: "Containers and layout",
      description:
        "Pages, cards, panels, and other elements that contain content.",
    },
    {
      id: "navigation",
      label: "Navigation",
      description: "Menus, links, tabs, breadcrumbs, and navigation regions.",
    },
    {
      id: "forms",
      label: "Forms and inputs",
      description: "Forms, fields, inputs, selectors, and validation controls.",
    },
    {
      id: "actions",
      label: "Actions and controls",
      description: "Buttons, action groups, and interactive controls.",
    },
    {
      id: "content",
      label: "Content and data display",
      description: "Text, tables, lists, metrics, media, and data previews.",
    },
    {
      id: "feedback",
      label: "Status and feedback",
      description: "Loading, empty, error, success, and status elements.",
    },
    {
      id: "conversation",
      label: "Conversation",
      description: "Messages, prompts, responses, and conversational surfaces.",
    },
    {
      id: "other",
      label: "Other UI",
      description: "Other compatible visual elements.",
    },
  ];

export interface SystemComposerStructureEditorProps {
  readonly draft: SystemComposerDraft;
  readonly rootInstanceRefs: readonly AssetReference[];
  readonly catalog: readonly SystemBuilderComposerAsset[];
  readonly compatibleAssets?: readonly SystemBuilderComposerAsset[];
  readonly layoutOptions?: readonly SystemBuilderComposerAsset[];
  readonly selectedLayoutDefinitionId?: string;
  readonly layoutSelectionDisabled?: boolean;
  readonly selectedInstanceId?: string;
  readonly targetSlot?: SystemComposerTargetSlot;
  readonly protectedInstanceIds: ReadonlySet<string>;
  readonly propertiesPanel?: ReactNode;
  readonly stylingPanel?: ReactNode;
  readonly catalogLoading?: boolean;
  readonly catalogError?: string;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onSelect: (instanceId: string) => void;
  readonly onTargetSlotChange?: (target: SystemComposerTargetSlot) => void;
  readonly onSelectLayout?: (layout: SystemBuilderComposerAsset) => void;
  readonly loadLayouts?: () => Promise<
    SystemBuilderResult<SystemBuilderComposerCatalog>
  >;
  readonly loadCompatibleAssets?: (
    target: SystemComposerTargetSlot,
    query: SystemComposerAssetBrowseRequest,
  ) => Promise<SystemBuilderResult<SystemBuilderComposerCatalog>>;
  readonly onSidebarTabChange?: (tab: SystemComposerSidebarTab) => void;
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
  compatibleAssets = EMPTY_COMPOSER_ASSETS,
  layoutOptions = EMPTY_COMPOSER_ASSETS,
  selectedLayoutDefinitionId,
  layoutSelectionDisabled = false,
  selectedInstanceId,
  protectedInstanceIds,
  propertiesPanel,
  stylingPanel,
  catalogLoading = false,
  catalogError,
  canUndo,
  canRedo,
  onSelect,
  onTargetSlotChange,
  onSelectLayout,
  loadLayouts,
  loadCompatibleAssets,
  onSidebarTabChange,
  onAdd,
  onPlace,
  onRemove,
  onUndo,
  onRedo,
}: SystemComposerStructureEditorProps) {
  const [focusMode, setFocusMode] = useState(false);
  const [sidebarTab, setSidebarTab] =
    useState<SystemComposerSidebarTab>("properties");
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const [responsiveDetailsOpen, setResponsiveDetailsOpen] = useState(false);
  const [layoutsExpanded, setLayoutsExpanded] = useState(false);
  const [layoutsLoading, setLayoutsLoading] = useState(false);
  const [layoutsLoaded, setLayoutsLoaded] = useState(false);
  const [loadedLayouts, setLoadedLayouts] = useState<
    readonly SystemBuilderComposerAsset[]
  >([]);
  const [layoutError, setLayoutError] = useState<string>();
  const [assetPicker, setAssetPicker] = useState<AssetPickerState>();
  const [assetSearch, setAssetSearch] = useState("");
  const [assetCategoryId, setAssetCategoryId] = useState<
    ComposerAssetBrowseCategoryId | "all"
  >("all");
  const deferredAssetSearch = useDeferredValue(assetSearch);
  const [assetResults, setAssetResults] = useState<
    readonly SystemBuilderComposerAsset[]
  >([]);
  const [assetNextCursor, setAssetNextCursor] = useState<string>();
  const [assetLoading, setAssetLoading] = useState(false);
  const [assetError, setAssetError] = useState<string>();
  const [moveTargetKey, setMoveTargetKey] = useState("");
  const [collapsedInstanceIds, setCollapsedInstanceIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const treeItemRefs = useRef(new Map<string, HTMLButtonElement>());
  const detailsPanelRef = useRef<HTMLElement>(null);
  const detailsToggleRefs = useRef(
    new Map<SystemComposerSidebarTab, HTMLButtonElement>(),
  );
  const canvasRef = useRef<HTMLDivElement>(null);
  const loadLayoutsRef = useRef(loadLayouts);
  const loadCompatibleAssetsRef = useRef(loadCompatibleAssets);
  const sidebarChangeRef = useRef(onSidebarTabChange);
  loadLayoutsRef.current = loadLayouts;
  loadCompatibleAssetsRef.current = loadCompatibleAssets;
  sidebarChangeRef.current = onSidebarTabChange;

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
  const breadcrumb = selectedNode
    ? breadcrumbFor(selectedNode, draft.instances, draft.placements)
    : [];
  const visualCanvasTree = useMemo(
    () => systemComposerVisualCanvasRoots(tree, catalog),
    [catalog, tree],
  );
  const selectedVisualNode = selectedNode
    ? flatTree.find(
        (node) =>
          String(node.instance.instanceId) ===
          String(selectedNode.instance.instanceId),
      )
    : undefined;
  const canvasTree =
    focusMode && selectedVisualNode ? [selectedVisualNode] : visualCanvasTree;
  const activeCanvasLayout = definitionForInstance(
    visualCanvasTree[0]?.instance,
    catalog,
  );
  const pickerParentNode = assetPicker
    ? flatTree.find(
        (node) =>
          String(node.instance.instanceId) === assetPicker.parentInstanceId,
      )
    : undefined;
  const pickerParentDefinition = definitionForInstance(
    pickerParentNode?.instance,
    catalog,
  );
  const pickerSlots = pickerParentNode
    ? canvasSlotsForNode(pickerParentNode, pickerParentDefinition).filter(
        ({ editable }) => editable,
      )
    : [];
  const activePickerSlot = pickerSlots.find(
    ({ slot }) => String(slot.slotId) === assetPicker?.slotId,
  )?.slot;
  const activePickerTarget =
    assetPicker && activePickerSlot
      ? {
          parentInstanceId: assetPicker.parentInstanceId,
          slotId: String(activePickerSlot.slotId),
        }
      : undefined;
  const compatibleDefinitionKeys = useMemo(
    () =>
      new Set(
        assetResults.map((asset) => `${asset.definitionId}@${asset.version}`),
      ),
    [assetResults],
  );
  const compatibleUnassigned = unassignedVisualInstances.filter((instance) =>
    compatibleDefinitionKeys.has(
      `${String(instance.definitionRef.id)}@${instance.definitionRef.version ?? ""}`,
    ),
  );
  const assetResultGroups = useMemo(
    () => groupComposerAssetsForBrowse(assetResults),
    [assetResults],
  );
  const visibleAssetResultGroups =
    assetCategoryId === "all"
      ? assetResultGroups
      : assetResultGroups.filter(
          (group) => group.category.id === assetCategoryId,
        );
  const visibleAssetResultCount = visibleAssetResultGroups.reduce(
    (count, group) => count + group.items.length,
    0,
  );
  const visibleCompatibleUnassigned = compatibleUnassigned.filter(
    (instance) => {
      if (assetCategoryId === "all") return true;
      const definition = definitionForInstance(instance, catalog);
      return (
        definition !== undefined &&
        categoryForComposerAsset(definition).id === assetCategoryId
      );
    },
  );
  const moveTargets = useMemo(
    () =>
      selectedNode
        ? buildMoveTargets(selectedNode, flatTree, catalog, draft.placements)
        : [],
    [catalog, draft.placements, flatTree, selectedNode],
  );
  const selectedMoveTarget =
    moveTargets.find((entry) => entry.key === moveTargetKey) ?? moveTargets[0];
  const selectedPlacement = selectedNode?.placement;
  const selectedSiblingCount = selectedPlacement
    ? draft.placements.filter(
        (placement) =>
          String(placement.parentInstanceRef.id) ===
            String(selectedPlacement.parentInstanceRef.id) &&
          String(placement.slotId) === String(selectedPlacement.slotId),
      ).length
    : 0;

  useEffect(() => {
    sidebarChangeRef.current?.(sidebarTab);
  }, [sidebarTab]);

  useEffect(() => {
    setMoveTargetKey(moveTargets[0]?.key ?? "");
  }, [selectedInstanceId, moveTargets]);

  useEffect(() => {
    if (!selectedInstanceId) return;
    const frame = globalThis.requestAnimationFrame?.(() => {
      const element = Array.from(
        canvasRef.current?.querySelectorAll<HTMLElement>(
          "[data-instance-id]",
        ) ?? [],
      ).find(
        (candidate) => candidate.dataset.instanceId === selectedInstanceId,
      );
      if (typeof element?.scrollIntoView === "function") {
        element.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
    return () => {
      if (frame !== undefined) globalThis.cancelAnimationFrame?.(frame);
    };
  }, [draft.instances.length, draft.placements, selectedInstanceId]);

  useEffect(() => {
    if (!layoutsExpanded || layoutsLoaded || layoutsLoading) return;
    let active = true;
    setLayoutsLoading(true);
    setLayoutError(undefined);
    const loader = loadLayoutsRef.current;
    if (!loader) {
      setLoadedLayouts(layoutOptions);
      setLayoutsLoaded(true);
      setLayoutsLoading(false);
      return;
    }
    void loader().then((result) => {
      if (!active) return;
      if (result.ok) {
        setLoadedLayouts(
          result.value.items.filter(
            (asset) => asset.layoutRole === "application-shell",
          ),
        );
        setLayoutsLoaded(true);
      } else {
        setLayoutError(result.error.message);
      }
      setLayoutsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [layoutOptions, layoutsExpanded, layoutsLoaded]);

  useEffect(() => {
    if (!activePickerTarget) {
      setAssetResults([]);
      setAssetNextCursor(undefined);
      setAssetLoading(false);
      setAssetError(undefined);
      return;
    }
    onTargetSlotChange?.(activePickerTarget);
    let active = true;
    setAssetLoading(true);
    setAssetError(undefined);
    const loader = loadCompatibleAssetsRef.current;
    if (!loader) {
      const query = deferredAssetSearch.trim().toLowerCase();
      setAssetResults(
        compatibleAssets.filter(
          (asset) =>
            asset.compatibility.status === "compatible" &&
            isSystemComposerVisualAsset(asset) &&
            (!query ||
              `${asset.displayName} ${asset.definitionId} ${asset.assetType}`
                .toLowerCase()
                .includes(query)),
        ),
      );
      setAssetNextCursor(undefined);
      setAssetLoading(false);
      return;
    }
    void loader(activePickerTarget, {
      ...(deferredAssetSearch.trim()
        ? { searchText: deferredAssetSearch.trim() }
        : {}),
      limit: 48,
    }).then((result) => {
      if (!active) return;
      if (result.ok) {
        setAssetResults(result.value.items.filter(isSystemComposerVisualAsset));
        setAssetNextCursor(result.value.nextCursor);
      } else {
        setAssetResults([]);
        setAssetNextCursor(undefined);
        setAssetError(result.error.message);
      }
      setAssetLoading(false);
    });
    return () => {
      active = false;
    };
  }, [
    activePickerTarget?.parentInstanceId,
    activePickerTarget?.slotId,
    compatibleAssets,
    deferredAssetSearch,
    onTargetSlotChange,
  ]);

  const loadMoreAssets = async () => {
    if (!activePickerTarget || !assetNextCursor || assetLoading) return;
    const loader = loadCompatibleAssetsRef.current;
    if (!loader) return;
    setAssetLoading(true);
    setAssetError(undefined);
    const result = await loader(activePickerTarget, {
      ...(deferredAssetSearch.trim()
        ? { searchText: deferredAssetSearch.trim() }
        : {}),
      cursor: assetNextCursor,
      limit: 48,
    });
    if (result.ok) {
      const merged = new Map(
        assetResults.map((asset) => [
          `${asset.definitionId}@${asset.version}`,
          asset,
        ]),
      );
      for (const asset of result.value.items.filter(
        isSystemComposerVisualAsset,
      )) {
        merged.set(`${asset.definitionId}@${asset.version}`, asset);
      }
      setAssetResults([...merged.values()]);
      setAssetNextCursor(result.value.nextCursor);
    } else {
      setAssetError(result.error.message);
    }
    setAssetLoading(false);
  };

  const openAssetPicker = (node: SystemComposerTreeNode) => {
    const definition = definitionForInstance(node.instance, catalog);
    const firstAvailable = canvasSlotsForNode(node, definition).find(
      ({ slot, editable }) =>
        editable &&
        node.children.filter(
          (child) => String(child.placement?.slotId) === String(slot.slotId),
        ).length < slot.cardinality.maxItems,
    );
    if (!firstAvailable) return;
    setAssetSearch("");
    setAssetCategoryId("all");
    setAssetResults([]);
    setAssetNextCursor(undefined);
    setAssetError(undefined);
    setAssetPicker({
      parentInstanceId: String(node.instance.instanceId),
      slotId: String(firstAvailable.slot.slotId),
    });
  };

  const closeAssetPicker = () => {
    setAssetPicker(undefined);
    setAssetSearch("");
    setAssetCategoryId("all");
    setAssetResults([]);
    setAssetNextCursor(undefined);
    setAssetError(undefined);
  };

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

  const openDetails = (tab: SystemComposerSidebarTab) => {
    setDetailsCollapsed(false);
    setSidebarTab(tab);
    setResponsiveDetailsOpen(true);
    globalThis.setTimeout(() => detailsPanelRef.current?.focus(), 0);
  };

  const availableLayouts = layoutsLoaded ? loadedLayouts : [];

  return (
    <div className="system-composer system-composer--click ui-stack ui-stack--md">
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
          disabled={!selectedVisualNode}
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
          {(["properties", "styling", "layers"] as const).map((tab) => (
            <button
              key={tab}
              ref={(element) => {
                if (element) detailsToggleRefs.current.set(tab, element);
                else detailsToggleRefs.current.delete(tab);
              }}
              type="button"
              className="system-composer__flat-control"
              aria-controls="system-composer-details-panel"
              aria-expanded={responsiveDetailsOpen && sidebarTab === tab}
              onClick={() =>
                responsiveDetailsOpen && sidebarTab === tab
                  ? setResponsiveDetailsOpen(false)
                  : openDetails(tab)
              }
            >
              {tab[0]!.toUpperCase() + tab.slice(1)}
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

      {onSelectLayout ? (
        <section
          className="system-composer__layout-bar"
          aria-labelledby="system-composer-layout-bar-title"
        >
          <h3 id="system-composer-layout-bar-title">
            <button
              type="button"
              className="system-composer__layout-bar-toggle"
              aria-label={layoutsExpanded ? "Hide layouts" : "Show layouts"}
              aria-expanded={layoutsExpanded}
              aria-controls="system-composer-layout-bar-content"
              onClick={() => setLayoutsExpanded((current) => !current)}
            >
              <ApplicationIcon name="chevron" />
              <span>Layouts</span>
              <small>Choose a predefined Canvas structure</small>
            </button>
          </h3>
          <div
            id="system-composer-layout-bar-content"
            className="system-composer__layout-bar-content"
            hidden={!layoutsExpanded}
          >
            {layoutsExpanded ? (
              <SystemLayoutGallery
                layouts={availableLayouts}
                selectedDefinitionId={selectedLayoutDefinitionId}
                disabled={layoutSelectionDisabled}
                mode="change"
                compact
                hideLegend
                loading={layoutsLoading}
                error={layoutError}
                onSelect={onSelectLayout}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      <div
        className="system-composer__workspace system-composer__workspace--without-library"
        data-details-collapsed={detailsCollapsed}
      >
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
                Select a container and use Add element. Canonical semantic order
                is preserved.
              </p>
            </div>
          </div>
          {canvasTree.length ? (
            <div ref={canvasRef} className="system-composer__canvas">
              {canvasTree.map((node) => (
                <CanvasNode
                  key={String(node.instance.instanceId)}
                  node={node}
                  catalog={catalog}
                  selectedInstanceId={selectedInstanceId}
                  protectedInstanceIds={protectedInstanceIds}
                  onSelect={onSelect}
                  onAddElement={openAssetPicker}
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
          ref={detailsPanelRef}
          tabIndex={-1}
          className="system-composer__panel system-composer__panel--details"
          data-responsive-panel="details"
          data-panel-open={responsiveDetailsOpen}
          data-collapsed={detailsCollapsed}
          aria-label="Composer details"
        >
          <div
            className="system-composer__sidebar-tabs ui-tabbed-panel__tablist"
            role="tablist"
            aria-label="Composer details"
            aria-orientation="horizontal"
          >
            {(["properties", "styling", "layers"] as const).map((tab) => (
              <button
                key={tab}
                id={`system-composer-sidebar-tab-${tab}`}
                type="button"
                role="tab"
                className={`ui-tabbed-panel__tab${sidebarTab === tab ? " ui-tabbed-panel__tab--active" : ""}`}
                aria-selected={sidebarTab === tab}
                aria-controls={`system-composer-${tab}-panel`}
                tabIndex={sidebarTab === tab ? 0 : -1}
                onClick={() => setSidebarTab(tab)}
              >
                {tab === "layers"
                  ? "Layers"
                  : tab[0]!.toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <header className="system-composer__sidebar-header">
            <div className="system-composer__sidebar-heading">
              <h3>
                Configure{" "}
                {selectedNode?.instance.displayName ?? "selected asset"}
              </h3>
              {selectedNode ? (
                <p>
                  {String(selectedNode.instance.definitionRef.id)}@
                  {selectedNode.instance.definitionRef.version}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="system-composer__flat-control system-composer__sidebar-collapse"
              aria-label={`${detailsCollapsed ? "Expand" : "Collapse"} Composer details sidebar`}
              aria-expanded={!detailsCollapsed}
              title={`${detailsCollapsed ? "Expand" : "Collapse"} Composer details sidebar`}
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
            {sidebarTab === "properties"
              ? (propertiesPanel ?? (
                  <EmptyState
                    compact
                    title="Select an asset"
                    description="Choose a Canvas node or layer to edit its declared properties."
                    icon="settings"
                  />
                ))
              : null}
          </section>
          <section
            id="system-composer-styling-panel"
            role="tabpanel"
            aria-labelledby="system-composer-sidebar-tab-styling"
            hidden={sidebarTab !== "styling"}
            className="system-composer__sidebar-panel system-composer__sidebar-panel--styling"
          >
            {sidebarTab === "styling"
              ? (stylingPanel ?? (
                  <EmptyState
                    compact
                    title="System styling is unavailable"
                    description="Load a system with a declared reusable style profile."
                    icon="settings"
                  />
                ))
              : null}
          </section>
          <section
            id="system-composer-layers-panel"
            role="tabpanel"
            aria-labelledby="system-composer-sidebar-tab-layers"
            hidden={sidebarTab !== "layers"}
            className="system-composer__sidebar-panel system-composer__sidebar-panel--layers"
          >
            {sidebarTab === "layers" ? (
              <>
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
                {systemResourceInstances.length ? (
                  <section
                    className="system-composer__resources"
                    aria-labelledby="system-composer-resource-heading"
                  >
                    <h4 id="system-composer-resource-heading">
                      System resources &amp; logic
                    </h4>
                    <p className="ui-text-muted">
                      Nonvisual assets remain part of the system but do not
                      occupy Canvas space.
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
                    {selectedPlacement &&
                    !protectedInstanceIds.has(
                      String(selectedNode.instance.instanceId),
                    ) ? (
                      <>
                        <label>
                          Move to region
                          <select
                            value={selectedMoveTarget?.key ?? ""}
                            onChange={(event) =>
                              setMoveTargetKey(event.currentTarget.value)
                            }
                          >
                            {moveTargets.map((entry) => (
                              <option key={entry.key} value={entry.key}>
                                {entry.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className="system-composer__flat-control"
                          disabled={!selectedMoveTarget}
                          onClick={() => {
                            if (selectedMoveTarget) {
                              onPlace(
                                String(selectedNode.instance.instanceId),
                                selectedMoveTarget.target,
                              );
                            }
                          }}
                        >
                          <ApplicationIcon name="switch" />
                          <span>Move selected asset</span>
                        </button>
                        <div
                          className="ui-inline-actions"
                          role="group"
                          aria-label="Selected asset order"
                        >
                          <button
                            type="button"
                            className="system-composer__flat-control"
                            disabled={selectedPlacement.order <= 0}
                            onClick={() =>
                              onPlace(
                                String(selectedNode.instance.instanceId),
                                {
                                  parentInstanceId: String(
                                    selectedPlacement.parentInstanceRef.id,
                                  ),
                                  slotId: String(selectedPlacement.slotId),
                                  order: selectedPlacement.order - 1,
                                },
                              )
                            }
                          >
                            Move up
                          </button>
                          <button
                            type="button"
                            className="system-composer__flat-control"
                            disabled={
                              selectedPlacement.order >=
                              selectedSiblingCount - 1
                            }
                            onClick={() =>
                              onPlace(
                                String(selectedNode.instance.instanceId),
                                {
                                  parentInstanceId: String(
                                    selectedPlacement.parentInstanceRef.id,
                                  ),
                                  slotId: String(selectedPlacement.slotId),
                                  order: selectedPlacement.order + 1,
                                },
                              )
                            }
                          >
                            Move down
                          </button>
                        </div>
                      </>
                    ) : null}
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
              </>
            ) : null}
          </section>
        </aside>
      </div>

      <ModalDialog
        open={Boolean(assetPicker && pickerParentNode)}
        title={`Add an element to ${
          pickerParentNode?.instance.displayName ??
          pickerParentDefinition?.displayName ??
          "container"
        }`}
        onClose={closeAssetPicker}
        closeLabel="Close asset selection"
        descriptionId="system-composer-asset-picker-description"
        dialogClassName="system-composer__asset-picker-dialog"
        bodyClassName="system-composer__asset-picker"
      >
        <p
          id="system-composer-asset-picker-description"
          className="ui-text-muted"
        >
          Choose a destination region, then select a compatible element. The
          element will be inserted, selected, and revealed on the Canvas.
        </p>
        {pickerSlots.length > 1 ? (
          <label>
            Destination region
            <select
              value={assetPicker?.slotId ?? ""}
              onChange={(event) => {
                if (!assetPicker) return;
                setAssetPicker({
                  ...assetPicker,
                  slotId: event.currentTarget.value,
                });
                setAssetResults([]);
                setAssetNextCursor(undefined);
              }}
            >
              {pickerSlots.map(({ slot }) => (
                <option key={String(slot.slotId)} value={String(slot.slotId)}>
                  {slot.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Search compatible elements
          <input
            data-modal-initial-focus
            type="search"
            value={assetSearch}
            onChange={(event) => setAssetSearch(event.currentTarget.value)}
            placeholder="Card, navigation, form..."
          />
        </label>
        <label>
          Filter elements by type
          <select
            aria-label="Filter elements by type"
            value={assetCategoryId}
            onChange={(event) =>
              setAssetCategoryId(
                event.currentTarget.value as
                  ComposerAssetBrowseCategoryId | "all",
              )
            }
          >
            <option value="all">All element types</option>
            {COMPOSER_ASSET_BROWSE_CATEGORIES.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </label>
        {assetError || catalogError ? (
          <p className="ui-status ui-status--error" role="alert">
            {assetError ?? catalogError}
          </p>
        ) : null}
        {visibleCompatibleUnassigned.length ? (
          <section
            className="system-composer__asset-picker-section"
            aria-labelledby="system-composer-unassigned-picker-heading"
          >
            <h3 id="system-composer-unassigned-picker-heading">
              Unassigned visual assets
            </h3>
            <p className="ui-text-muted">
              Reuse an existing visual asset preserved during a layout change.
            </p>
            <ul className="system-composer__asset-picker-grid">
              {visibleCompatibleUnassigned.map((instance) => (
                <li key={String(instance.instanceId)}>
                  <button
                    type="button"
                    className="system-composer__asset-picker-card"
                    onClick={() => {
                      if (!activePickerTarget) return;
                      onPlace(String(instance.instanceId), activePickerTarget);
                      closeAssetPicker();
                    }}
                  >
                    <ApplicationIcon name="assets" />
                    <strong>
                      {instance.displayName ??
                        String(instance.definitionRef.id)}
                    </strong>
                    <span>Existing unassigned element</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section
          className="system-composer__asset-picker-section"
          aria-labelledby="system-composer-new-picker-heading"
        >
          <h3 id="system-composer-new-picker-heading">Add a new element</h3>
          {assetLoading && assetResults.length === 0 ? (
            <div className="system-composer__asset-picker-loading">
              <LoadingSpinner label="Loading compatible elements" />
              <span>Loading compatible elements...</span>
            </div>
          ) : null}
          {!assetLoading &&
          !assetError &&
          !catalogError &&
          visibleAssetResultCount === 0 ? (
            <EmptyState
              compact
              title={
                assetCategoryId === "all"
                  ? "No compatible elements"
                  : "No compatible elements in this type"
              }
              description="Try another type, destination region, or search term."
              icon="assets"
            />
          ) : null}
          <div className="system-composer__asset-picker-categories">
            {visibleAssetResultGroups.map(({ category, items }) => (
              <section
                key={category.id}
                className="system-composer__asset-picker-category"
                aria-labelledby={`system-composer-category-${category.id}`}
              >
                <div className="system-composer__asset-picker-category-heading">
                  <h4 id={`system-composer-category-${category.id}`}>
                    {category.label}
                  </h4>
                  <span aria-label={`${items.length} compatible elements`}>
                    {items.length}
                  </span>
                </div>
                <p className="ui-text-muted">{category.description}</p>
                <ul className="system-composer__asset-picker-grid">
                  {items.map((asset) => (
                    <li key={`${asset.definitionId}@${asset.version}`}>
                      <button
                        type="button"
                        className="system-composer__asset-picker-card"
                        onClick={() => {
                          if (!activePickerTarget) return;
                          onAdd(asset, activePickerTarget);
                          closeAssetPicker();
                        }}
                      >
                        <ApplicationIcon name={iconForComposerAsset(asset)} />
                        <strong>{asset.displayName}</strong>
                        <span>
                          {asset.assetType} / v{asset.version}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {assetNextCursor ? (
            <button
              type="button"
              className="ui-button ui-button--outline"
              disabled={assetLoading}
              onClick={() => void loadMoreAssets()}
            >
              {assetLoading ? (
                <LoadingSpinner label="Loading more elements" />
              ) : null}
              <span>Load more</span>
            </button>
          ) : null}
        </section>
      </ModalDialog>
    </div>
  );
}

export function SystemLayoutGallery({
  layouts,
  selectedDefinitionId,
  disabled = false,
  mode = "create",
  compact = false,
  hideLegend = false,
  loading = false,
  error,
  onSelect,
}: {
  readonly layouts: readonly SystemBuilderComposerAsset[];
  readonly selectedDefinitionId?: string;
  readonly disabled?: boolean;
  readonly mode?: "create" | "change";
  readonly compact?: boolean;
  readonly hideLegend?: boolean;
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
      <legend className={hideLegend ? "ui-visually-hidden" : undefined}>
        {compact ? "Layout" : "Application layout"}
      </legend>
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
                  key={String(slot.slotId)}
                  data-layout-area={slot.slotId}
                  style={{ gridArea: slot.slotId }}
                >
                  {slot.displayName}
                </span>
              ))}
            </span>
            <strong>{layout.displayName}</strong>
            <small>
              {layout.slots.map((slot) => slot.displayName).join(" / ")}
            </small>
          </label>
        ))}
      </div>
      {loading && layouts.length === 0 ? (
        <div className="system-composer__layout-loading" role="status">
          <LoadingSpinner label="Loading predefined layouts" />
          <span>Loading predefined layouts...</span>
        </div>
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
              Region {node.placement.slotId} / layer {node.placement.order + 1}
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
  protectedInstanceIds,
  onSelect,
  onAddElement,
}: {
  readonly node: SystemComposerTreeNode;
  readonly catalog: readonly SystemBuilderComposerAsset[];
  readonly selectedInstanceId?: string;
  readonly protectedInstanceIds: ReadonlySet<string>;
  readonly onSelect: (instanceId: string) => void;
  readonly onAddElement: (node: SystemComposerTreeNode) => void;
}) {
  const instanceId = String(node.instance.instanceId);
  const definition = definitionForInstance(node.instance, catalog);
  const protectedInstance = protectedInstanceIds.has(instanceId);
  const fixedLayout = Boolean(definition?.layoutRole);
  const layoutStyle = definition?.layoutGeometry
    ? layoutGridStyle(definition.layoutGeometry, fixedLayout)
    : undefined;
  const canvasSlots = canvasSlotsForNode(node, definition);
  const hasAvailableSlot = canvasSlots.some(
    ({ slot, editable }) =>
      editable &&
      node.children.filter(
        (child) => String(child.placement?.slotId) === String(slot.slotId),
      ).length < slot.cardinality.maxItems,
  );
  return (
    <article
      className="system-composer__canvas-node"
      data-instance-id={instanceId}
      data-selected={instanceId === selectedInstanceId}
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
        {definition?.slots.length ? (
          <button
            type="button"
            className="system-composer__flat-control system-composer__add-element"
            aria-label={`Add an element inside ${
              node.instance.displayName ?? definition.displayName
            }`}
            aria-haspopup="dialog"
            disabled={!hasAvailableSlot}
            title={
              hasAvailableSlot
                ? "Add an internal element"
                : "All declared regions are full"
            }
            onClick={() => onAddElement(node)}
          >
            <ApplicationIcon name="add" />
            <span>Add element</span>
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
      {canvasSlots.length ? (
        <div className="system-composer__slots" style={layoutStyle}>
          {canvasSlots.map(({ slot, editable }) => (
            <CanvasSlot
              key={String(slot.slotId)}
              parentInstanceId={instanceId}
              slot={slot}
              childrenNodes={node.children.filter(
                (child) =>
                  String(child.placement?.slotId) === String(slot.slotId),
              )}
              editable={editable}
              catalog={catalog}
              selectedInstanceId={selectedInstanceId}
              protectedInstanceIds={protectedInstanceIds}
              onSelect={onSelect}
              onAddElement={onAddElement}
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
  editable,
  catalog,
  selectedInstanceId,
  protectedInstanceIds,
  onSelect,
  onAddElement,
}: {
  readonly parentInstanceId: string;
  readonly slot: SystemBuilderComposerAsset["slots"][number];
  readonly childrenNodes: readonly SystemComposerTreeNode[];
  readonly editable: boolean;
  readonly catalog: readonly SystemBuilderComposerAsset[];
  readonly selectedInstanceId?: string;
  readonly protectedInstanceIds: ReadonlySet<string>;
  readonly onSelect: (instanceId: string) => void;
  readonly onAddElement: (node: SystemComposerTreeNode) => void;
}) {
  const collapsible = String(slot.slotId) === "states";
  const [collapsed, setCollapsed] = useState(true);
  const contentId = `system-composer-slot-${parentInstanceId}-${String(slot.slotId)}-content`;
  return (
    <section
      className="system-composer__slot"
      data-slot-id={slot.slotId}
      data-collapsible={collapsible}
      data-collapsed={collapsible && collapsed}
      data-structural-only={!editable}
      style={editable ? { gridArea: slot.slotId } : undefined}
      aria-label={`${slot.displayName} region`}
    >
      <header>
        <strong>{slot.displayName}</strong>
        <span className="system-composer__slot-summary">
          <small>
            {childrenNodes.length}/{slot.cardinality.maxItems}
          </small>
          {collapsible ? (
            <button
              type="button"
              className="system-composer__region-collapse"
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${slot.displayName} region`}
              aria-expanded={!collapsed}
              aria-controls={contentId}
              data-expanded={!collapsed}
              onClick={() => setCollapsed((current) => !current)}
            >
              <ApplicationIcon name="chevron" />
            </button>
          ) : null}
        </span>
      </header>
      <div
        id={contentId}
        className="system-composer__slot-content"
        hidden={collapsible && collapsed}
      >
        {collapsible && collapsed ? null : (
          <>
            <p>
              {slot.description ??
                (editable ? "Container region" : "Saved canonical region")}
            </p>
            {childrenNodes.map((child) => (
              <CanvasNode
                key={String(child.instance.instanceId)}
                node={child}
                catalog={catalog}
                selectedInstanceId={selectedInstanceId}
                protectedInstanceIds={protectedInstanceIds}
                onSelect={onSelect}
                onAddElement={onAddElement}
              />
            ))}
            {childrenNodes.length === 0 ? (
              <span className="system-composer__slot-empty">
                {editable ? "No elements assigned" : "No assigned assets"}
              </span>
            ) : null}
          </>
        )}
      </div>
    </section>
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

function canvasSlotsForNode(
  node: SystemComposerTreeNode,
  definition: SystemBuilderComposerAsset | undefined,
): readonly SystemComposerCanvasSlot[] {
  const slots = new Map<string, SystemComposerCanvasSlot>(
    (definition?.slots ?? []).map((slot) => [
      String(slot.slotId),
      { slot, editable: true },
    ]),
  );
  const childCountBySlot = new Map<string, number>();
  for (const child of node.children) {
    const slotId = child.placement?.slotId;
    if (!slotId) continue;
    const key = String(slotId);
    childCountBySlot.set(key, (childCountBySlot.get(key) ?? 0) + 1);
    if (slots.has(key)) continue;
    slots.set(key, {
      slot: {
        schemaVersion: "asset-slot-definition.v1",
        slotId,
        displayName: structuralSlotDisplayName(key),
        description:
          "Saved canonical region. Its exact container definition is unavailable, so existing descendants remain visible but this region cannot accept new elements.",
        cardinality: { minItems: 0, maxItems: 1 },
      },
      editable: false,
    });
  }
  return [...slots.entries()].map(([slotId, value]) => {
    if (value.editable) return value;
    const count = childCountBySlot.get(slotId) ?? 1;
    return {
      ...value,
      slot: {
        ...value.slot,
        cardinality: { minItems: 0, maxItems: Math.max(1, count) },
      },
    };
  });
}

function buildMoveTargets(
  selectedNode: SystemComposerTreeNode,
  nodes: readonly SystemComposerTreeNode[],
  catalog: readonly SystemBuilderComposerAsset[],
  placements: readonly AssetPlacement[],
): readonly MoveTarget[] {
  const selectedId = String(selectedNode.instance.instanceId);
  const excluded = new Set(
    flattenSystemComposerTree([selectedNode]).map((node) =>
      String(node.instance.instanceId),
    ),
  );
  return nodes.flatMap((node) => {
    const parentId = String(node.instance.instanceId);
    if (excluded.has(parentId)) return [];
    const definition = definitionForInstance(node.instance, catalog);
    return (definition?.slots ?? []).flatMap((slot) => {
      const currentChildren = placements.filter(
        (placement) =>
          String(placement.parentInstanceRef.id) === parentId &&
          String(placement.slotId) === String(slot.slotId),
      );
      const selectedAlreadyHere = currentChildren.some(
        (placement) => String(placement.childInstanceRef.id) === selectedId,
      );
      if (
        !selectedAlreadyHere &&
        currentChildren.length >= slot.cardinality.maxItems
      ) {
        return [];
      }
      const key = `${parentId}|${String(slot.slotId)}`;
      return [
        {
          key,
          label: `${
            node.instance.displayName ?? String(node.instance.definitionRef.id)
          } / ${slot.displayName}`,
          target: {
            parentInstanceId: parentId,
            slotId: String(slot.slotId),
          },
        },
      ];
    });
  });
}

function structuralSlotDisplayName(slotId: string): string {
  return slotId
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
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
              ? "minmax(7rem, max-content)"
              : "minmax(14rem, max-content)",
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

function groupComposerAssetsForBrowse(
  assets: readonly SystemBuilderComposerAsset[],
): readonly {
  readonly category: ComposerAssetBrowseCategory;
  readonly items: readonly SystemBuilderComposerAsset[];
}[] {
  const grouped = new Map<
    ComposerAssetBrowseCategoryId,
    SystemBuilderComposerAsset[]
  >();
  for (const asset of assets) {
    const category = categoryForComposerAsset(asset);
    const items = grouped.get(category.id) ?? [];
    items.push(asset);
    grouped.set(category.id, items);
  }
  return COMPOSER_ASSET_BROWSE_CATEGORIES.flatMap((category) => {
    const items = grouped.get(category.id);
    return items?.length ? [{ category, items }] : [];
  });
}

function categoryForComposerAsset(
  asset: SystemBuilderComposerAsset,
): ComposerAssetBrowseCategory {
  const sourceCategory = asset.categoryId?.trim().toLowerCase();
  const identity =
    `${asset.definitionId} ${asset.displayName} ${asset.assetType} ${asset.assetFamily}`.toLowerCase();
  let id: ComposerAssetBrowseCategoryId;
  if (/\b(navigation|menu|breadcrumb|tabs?|link)\b/.test(identity)) {
    id = "navigation";
  } else if (/\b(button|action|submit|trigger|toolbar)\b/.test(identity)) {
    id = "actions";
  } else if (
    sourceCategory === "forms-fields" ||
    /\b(form|input|field|select|checkbox|radio|textarea|picker|upload)\b/.test(
      identity,
    )
  ) {
    id = "forms";
  } else if (
    sourceCategory === "state-messages" ||
    /\b(state|status|loading|empty|error|success|warning|progress|alert|badge)\b/.test(
      identity,
    )
  ) {
    id = "feedback";
  } else if (
    sourceCategory === "conversational-systems" ||
    /\b(conversation|message|chat|prompt|response|assistant)\b/.test(identity)
  ) {
    id = "conversation";
  } else if (
    sourceCategory === "data-display" ||
    sourceCategory === "artifact-preview" ||
    /\b(text|heading|content|table|list|metric|chart|media|image|data|record|preview|avatar|divider)\b/.test(
      identity,
    )
  ) {
    id = "content";
  } else if (
    asset.slots.length > 0 ||
    sourceCategory === "page-feature-shells" ||
    sourceCategory === "workflow-system-shells" ||
    asset.assetType === "page" ||
    asset.assetType === "subsystem" ||
    asset.assetType === "system"
  ) {
    id = "containers";
  } else {
    id = "other";
  }
  return (
    COMPOSER_ASSET_BROWSE_CATEGORIES.find((category) => category.id === id) ??
    COMPOSER_ASSET_BROWSE_CATEGORIES[
      COMPOSER_ASSET_BROWSE_CATEGORIES.length - 1
    ]!
  );
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
