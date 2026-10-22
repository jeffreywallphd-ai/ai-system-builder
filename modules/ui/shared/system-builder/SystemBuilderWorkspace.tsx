import { useEffect, useMemo, useRef, useState } from "react";
import {
  normalizeAssetId,
  type AssetBinding,
  type AssetConfigurationValues,
  type AssetInstance,
  type AssetPlacement,
  type AssetReference,
} from "../../../contracts/asset";
import type {
  SystemBuilderRecord,
  SystemBuilderResult,
  SystemBuilderRevision,
  SystemBuilderTemplateSummary,
  ListSystemBuilderComposerAssetsQuery,
  ReadSystemBuilderComposerAssetQuery,
  SystemBuilderComposerCatalog,
  SystemBuilderComposerAsset,
  SystemBuilderComposerAssetDetail,
  ListSystemBuilderManagementQuery,
  SystemBuilderManagementPage,
  PreviewSystemBuilderLayoutChangeCommand,
  SystemBuilderLayoutChangePreview,
  PreviewSystemBuilderFoundationUpgradeCommand,
  UpgradeSystemBuilderFoundationCommand,
  SystemBuilderFoundationUpgradePreview,
  SystemBuilderModelOption,
  SystemBuilderModelOptionCatalog,
} from "../../../contracts/system-builder";
import { TransientNotificationPublisher } from "../notifications/TransientNotificationPublisher";
import {
  SYSTEM_BUILDER_FOUNDATION_UPGRADE_SOURCE_VERSIONS,
  systemBuilderFailure,
  systemBuilderSuccess,
} from "../../../contracts/system-builder";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { ModalDialog } from "../components/ModalDialog";
import { SystemCompositionPreview } from "./SystemCompositionPreview";
import { createSystemComposerDefinitionReader } from "./SystemComposerDefinitionReader";
import {
  SystemComposerStructureEditor,
  type SystemComposerAssetBrowseRequest,
  type SystemComposerSidebarTab,
  type SystemComposerTargetSlot,
} from "./SystemComposerStructureEditor";
import { SystemComposerInspector } from "./SystemComposerInspector";
import { SystemComposerStylingPanel } from "./SystemComposerStylingPanel";
import {
  bindingKindForSystemComposerEndpoint,
  canRepairSystemComposerConversationInteraction,
  sanitizeSystemComposerInstanceConfigurations,
  type SystemComposerPortEndpoint,
} from "./systemComposerInspectorModel";
import {
  addSystemComposerAsset,
  attachUnassignedSystemComposerAsset,
  commitSystemComposerDraft,
  createSystemComposerDraftHistory,
  areSystemComposerDraftsEqual,
  deriveProtectedSystemInstanceIds,
  redoSystemComposerDraft,
  removeSystemComposerSubtree,
  reparentSystemComposerAsset,
  undoSystemComposerDraft,
  type SystemComposerDraft,
} from "./systemComposerDraft";
import { isSystemComposerVisualInstance } from "./systemComposerAssetClassification";

export interface SystemBuilderClient {
  list(input: {
    workspaceId: string;
    includeArchived?: boolean;
  }): Promise<SystemBuilderResult<readonly SystemBuilderRecord[]>>;
  listManagement(
    input: ListSystemBuilderManagementQuery,
  ): Promise<SystemBuilderResult<SystemBuilderManagementPage>>;
  listTemplates(): Promise<
    SystemBuilderResult<readonly SystemBuilderTemplateSummary[]>
  >;
  createFromTemplate(input: {
    workspaceId: string;
    templateId: SystemBuilderTemplateSummary["templateId"];
    name?: string;
  }): Promise<SystemBuilderResult<SystemBuilderRecord>>;
  create(input: {
    workspaceId: string;
    name: string;
    description?: string;
    profile?: "interactive" | "service" | "workflow";
    layoutPresetRef?: AssetReference;
  }): Promise<SystemBuilderResult<SystemBuilderRecord>>;
  readRevision(input: {
    workspaceId: string;
    systemId: string;
    revisionId?: string;
  }): Promise<SystemBuilderResult<SystemBuilderRevision>>;
  saveRevision(input: {
    workspaceId: string;
    systemId: string;
    expectedRecordRevision: number;
    composition: SystemBuilderRevision["composition"];
    instances: readonly AssetInstance[];
    bindings: readonly AssetBinding[];
    structure?: SystemBuilderRevision["structure"];
    placements?: SystemBuilderRevision["placements"];
  }): Promise<SystemBuilderResult<SystemBuilderRevision>>;
  archive(input: {
    workspaceId: string;
    systemId: string;
    expectedRevision: number;
  }): Promise<SystemBuilderResult<SystemBuilderRecord>>;
  restore(input: {
    workspaceId: string;
    systemId: string;
    expectedRevision: number;
  }): Promise<SystemBuilderResult<SystemBuilderRecord>>;
  clone(input: {
    workspaceId: string;
    sourceSystemId: string;
    name: string;
  }): Promise<SystemBuilderResult<SystemBuilderRecord>>;
  listRevisions(input: {
    workspaceId: string;
    systemId: string;
  }): Promise<SystemBuilderResult<readonly SystemBuilderRevision[]>>;
  listComposerAssets(
    input: ListSystemBuilderComposerAssetsQuery,
  ): Promise<SystemBuilderResult<SystemBuilderComposerCatalog>>;
  readComposerAsset?(
    input: ReadSystemBuilderComposerAssetQuery,
  ): Promise<SystemBuilderResult<SystemBuilderComposerAssetDetail>>;
  listModelOptions?(input: {
    workspaceId: string;
  }): Promise<SystemBuilderResult<SystemBuilderModelOptionCatalog>>;
  previewLayoutChange(
    input: Omit<
      PreviewSystemBuilderLayoutChangeCommand,
      "actorId" | "workspaceId" | "systemId"
    > & { readonly workspaceId: string; readonly systemId: string },
  ): Promise<SystemBuilderResult<SystemBuilderLayoutChangePreview>>;
  previewFoundationUpgrade(
    input: Omit<
      PreviewSystemBuilderFoundationUpgradeCommand,
      "actorId" | "workspaceId" | "systemId"
    > & { readonly workspaceId: string; readonly systemId: string },
  ): Promise<SystemBuilderResult<SystemBuilderFoundationUpgradePreview>>;
  upgradeFoundation(
    input: Omit<
      UpgradeSystemBuilderFoundationCommand,
      "actorId" | "workspaceId" | "systemId"
    > & { readonly workspaceId: string; readonly systemId: string },
  ): Promise<SystemBuilderResult<SystemBuilderRevision>>;
}

export function SystemBuilderWorkspace({
  workspaceId,
  client,
  initialSystemId,
  activeSystemsRevision = 0,
  onBuildAndTest,
}: {
  readonly workspaceId: string;
  readonly client: SystemBuilderClient;
  readonly initialSystemId?: string;
  readonly activeSystemsRevision?: number;
  readonly onBuildAndTest?: (input: {
    readonly system: SystemBuilderRecord;
    readonly revision: SystemBuilderRevision;
  }) => void;
}) {
  const [systems, setSystems] = useState<readonly SystemBuilderRecord[]>([]);
  const [templates, setTemplates] = useState<
    readonly SystemBuilderTemplateSummary[]
  >([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<
    SystemBuilderTemplateSummary["templateId"] | ""
  >("");
  const [composerCatalog, setComposerCatalog] = useState<
    readonly SystemBuilderComposerAsset[]
  >([]);
  const catalogRequestInFlight = useRef(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string>();
  const [selectedLayoutDefinitionId, setSelectedLayoutDefinitionId] =
    useState<string>();
  const [existingSystemId, setExistingSystemId] = useState("");
  const [selectedSystemId, setSelectedSystemId] = useState<string>();
  const [catalogLoadRequest, setCatalogLoadRequest] = useState<{
    readonly workspaceId: string;
    readonly attempt: number;
  }>();
  const [revision, setRevision] = useState<SystemBuilderRevision>();
  const [instances, setInstances] = useState<readonly AssetInstance[]>([]);
  const [bindings, setBindings] = useState<readonly AssetBinding[]>([]);
  const [placements, setPlacements] = useState<readonly AssetPlacement[]>([]);
  const [structure, setStructure] =
    useState<SystemBuilderRevision["structure"]>();
  const [undoDrafts, setUndoDrafts] = useState<readonly SystemComposerDraft[]>(
    [],
  );
  const [redoDrafts, setRedoDrafts] = useState<readonly SystemComposerDraft[]>(
    [],
  );
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>();
  const [activeSidebarTab, setActiveSidebarTab] =
    useState<SystemComposerSidebarTab>("properties");
  const [selectedAssetDetail, setSelectedAssetDetail] =
    useState<SystemBuilderComposerAssetDetail>();
  const [selectedAssetDetailLoading, setSelectedAssetDetailLoading] =
    useState(false);
  const [selectedAssetDetailError, setSelectedAssetDetailError] =
    useState<string>();
  const [modelOptions, setModelOptions] = useState<
    readonly SystemBuilderModelOption[]
  >([]);
  const [modelOptionsLoading, setModelOptionsLoading] = useState(false);
  const [modelOptionsLoaded, setModelOptionsLoaded] = useState(false);
  const [modelOptionsError, setModelOptionsError] = useState<string>();
  const [stylingRootDetail, setStylingRootDetail] =
    useState<SystemBuilderComposerAssetDetail>();
  const [stylingRootDetailLoading, setStylingRootDetailLoading] =
    useState(false);
  const [stylingRootDetailError, setStylingRootDetailError] =
    useState<string>();
  const [composerMode, setComposerMode] = useState<"design" | "connections">(
    "design",
  );
  const [newSystemName, setNewSystemName] = useState("");
  const [referenceSystemName, setReferenceSystemName] = useState("");
  const [revisions, setRevisions] = useState<readonly SystemBuilderRevision[]>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisionError, setRevisionError] = useState<string>();
  const [historyError, setHistoryError] = useState<string>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const savedDraft = useRef<SystemComposerDraft | undefined>(undefined);
  const appliedInitialSystem = useRef<string | undefined>(undefined);
  const scope = useMemo(() => ({ client, workspaceId }), [client, workspaceId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const currentSystem = useRef(selectedSystemId);
  currentSystem.current = selectedSystemId;
  const operation = useRef<object | undefined>(undefined);
  const [definitionReader] = useState(createSystemComposerDefinitionReader);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const contextualNotice = Boolean(
    notice?.includes("already the active layout"),
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [foundationUpgradeOpen, setFoundationUpgradeOpen] = useState(false);
  const [foundationUpgradePreview, setFoundationUpgradePreview] =
    useState<SystemBuilderFoundationUpgradePreview>();
  const selectedSystem = systems.find(
    (system) => String(system.systemId) === selectedSystemId,
  );
  const existingSystemIsLoaded = Boolean(
    selectedSystem && revision && String(revision.systemId) === selectedSystemId && String(revision.targetWorkspaceId) === workspaceId && existingSystemId === selectedSystemId,
  );
  const selectedInstance = instances.find(
    (instance) => String(instance.instanceId) === selectedInstanceId,
  );
  const selectedDefinitionSummary = composerCatalog.find(
    (definition) =>
      definition.definitionId === String(selectedInstance?.definitionRef.id) &&
      definition.version === selectedInstance?.definitionRef.version,
  );
  const selectedDefinition = selectedAssetDetail ?? selectedDefinitionSummary;
  const canUpgradeFoundation = Boolean(
    revision && usesUpgradeableFoundationVersion(revision),
  );
  const stylingRootInstanceId = String(
    revision?.composition.rootInstanceRefs[0]?.id ?? "",
  );
  const stylingRootInstance = instances.find(
    (instance) => String(instance.instanceId) === stylingRootInstanceId,
  );
  const stylingRootDefinitionSummary = composerCatalog.find(
    (definition) =>
      definition.definitionId ===
      String(stylingRootInstance?.definitionRef.id) &&
      definition.version === stylingRootInstance?.definitionRef.version,
  );
  const stylingRootDefinition =
    stylingRootDetail ?? stylingRootDefinitionSummary;
  const draft = useMemo<SystemComposerDraft>(
    () => ({ instances, placements, bindings, structure }),
    [bindings, instances, placements, structure],
  );
  const canRepairConversationInteraction = useMemo(
    () => canRepairSystemComposerConversationInteraction(instances, bindings),
    [bindings, instances],
  );
  const layoutOptions = useMemo(
    () =>
      composerCatalog.filter(
        (asset) => asset.layoutRole === "application-shell",
      ),
    [composerCatalog],
  );
  const componentsReady = useMemo(() => {
    const available = new Set(composerCatalog.map(asset => `${asset.definitionId}@${asset.version}`));
    return instances.every(instance => available.has(`${String(instance.definitionRef.id)}@${instance.definitionRef.version ?? ""}`));
  }, [instances, composerCatalog]);
  const protectedInstanceIds = useMemo(
    () =>
      deriveProtectedSystemInstanceIds(
        draft,
        revision?.composition.rootInstanceRefs ?? [],
        composerCatalog,
      ),
    [composerCatalog, draft, revision?.composition.rootInstanceRefs],
  );

  useEffect(() => {
    operation.current = undefined;
    setBusy(false);
    return () => { operation.current = undefined; };
  }, [scope, selectedSystemId]);

  function requestComposerCatalog() {
    if (catalogRequestInFlight.current) return;
    catalogRequestInFlight.current = true;
    setCatalogLoadRequest((current) => ({
      workspaceId,
      attempt: current?.workspaceId === workspaceId ? current.attempt + 1 : 1,
    }));
  }

  useEffect(() => {
    let active = true;
    operation.current = undefined;
    appliedInitialSystem.current = undefined;
    savedDraft.current = undefined;
    setBusy(false);
    setRevisionError(undefined);
    setHistoryError(undefined);
    setError(undefined);
    setRevision(undefined);
    setStructure(undefined);
    setExistingSystemId("");
    setSelectedSystemId(undefined);
    setCatalogLoadRequest(undefined);
    setComposerCatalog([]);
    setSelectedLayoutDefinitionId(undefined);
    setFoundationUpgradeOpen(false);
    setFoundationUpgradePreview(undefined);
    setDirty(false);
    catalogRequestInFlight.current = false;
    setCatalogLoading(false);
    setCatalogError(undefined);
    setSelectedAssetDetail(undefined);
    setSelectedAssetDetailLoading(false);
    setSelectedAssetDetailError(undefined);
    setModelOptions([]);
    setModelOptionsLoading(false);
    setModelOptionsLoaded(false);
    setModelOptionsError(undefined);
    setStylingRootDetail(undefined);
    setStylingRootDetailLoading(false);
    setStylingRootDetailError(undefined);
    setSystems([]);
    void Promise.resolve().then(() => client.listTemplates()).then((templateResult) => {
      if (!active) return;
      if (templateResult.ok) {
        setTemplates(templateResult.value);
        setSelectedTemplateId(
          (current) => current || templateResult.value[0]?.templateId || "",
        );
      } else setError(templateResult.error.message);
    }).catch(() => { if (active) setError("System templates are unavailable. Retry opening the workspace."); });
    return () => {
      active = false;
    };
  }, [client, workspaceId]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => client.list({ workspaceId, includeArchived: false }))
      .then((systemResult) => {
        if (!active) return;
        if (!systemResult.ok) {
          setError(systemResult.error.message);
          return;
        }
        const activeSystems = systemResult.value.filter(
          (item) => item.status !== "archived",
        );
        const activeSystemIds = new Set(
          activeSystems.map((item) => String(item.systemId)),
        );
        setSystems(activeSystems);
        setExistingSystemId((current) =>
          current && !activeSystemIds.has(current) ? "" : current,
        );
        setSelectedSystemId((current) =>
          current && !activeSystemIds.has(current) ? undefined : current,
        );
      }).catch(() => { if (active) setError("Systems are unavailable. Retry opening the workspace."); });
    return () => {
      active = false;
    };
  }, [activeSystemsRevision, client, workspaceId]);

  const draftDefinitionKey = useMemo(() => [...new Set(instances.map(instance => `${String(instance.definitionRef.id)}@${instance.definitionRef.version ?? ""}`))].sort().join("|"), [instances]);
  useEffect(() => {
    if (catalogLoadRequest?.workspaceId !== workspaceId || !revision || String(revision.systemId) !== selectedSystemId) return;
    let active = true;
    setCatalogLoading(true);
    setCatalogError(undefined);
    void loadDraftComposerCatalog(client, workspaceId, instances, composerCatalog, () => active, definitionReader).then((catalogResult) => {
      if (!active) return;
      if (catalogResult.ok) {
        setComposerCatalog(catalogResult.value.items);
        setSelectedLayoutDefinitionId(current => current ?? defaultApplicationLayout(catalogResult.value.items)?.definitionId);
      } else setCatalogError(catalogResult.error.message);
    }).catch(() => {
      if (active) setCatalogError("The component catalog is unavailable. Retry opening this system.");
    }).finally(() => {
      if (active) { catalogRequestInFlight.current = false; setCatalogLoading(false); }
    });
    return () => { active = false; catalogRequestInFlight.current = false; };
  }, [catalogLoadRequest, client, workspaceId, selectedSystemId, draftDefinitionKey, Boolean(revision)]);

  useEffect(() => {
    if (!initialSystemId || appliedInitialSystem.current === initialSystemId) return;
    if (dirty) {
      setError("Save or discard unsaved changes before switching systems.");
      return;
    }
    const requestedSystem = systems.find(
      (item) =>
        String(item.systemId) === initialSystemId && item.status !== "archived",
    );
    if (requestedSystem) {
      appliedInitialSystem.current = initialSystemId;
      setExistingSystemId(initialSystemId);
      setSelectedSystemId(initialSystemId);
      requestComposerCatalog();
    }
  }, [initialSystemId, systems, dirty]);

  useEffect(() => {
    if (!selectedSystemId) {
      setRevisionLoading(false);
      setRevision(undefined);
      setInstances([]);
      setBindings([]);
      setPlacements([]);
      setStructure(undefined);
      setUndoDrafts([]);
      setRedoDrafts([]);
      setFoundationUpgradeOpen(false);
      setFoundationUpgradePreview(undefined);
      return;
    }
    let active = true;
    setRevisionLoading(true);
    setRevision(undefined);
    setInstances([]);
    setBindings([]);
    setPlacements([]);
    setStructure(undefined);
    setRevisions([]);
    setRevisionError(undefined);
    setHistoryError(undefined);
    const acceptRevision = (value: SystemBuilderRevision) => {
      if (String(value.systemId) !== selectedSystemId || String(value.targetWorkspaceId) !== workspaceId) {
        setRevisionError("The loaded revision does not belong to this system. Retry loading it.");
        return;
      }
      setRevision(value);
      installSavedDraft(value);
      setSelectedLayoutDefinitionId(value.structure?.layoutPresetRef ? String(value.structure.layoutPresetRef.id) : undefined);
      setUndoDrafts([]);
      setRedoDrafts([]);
      setFoundationUpgradeOpen(false);
      setFoundationUpgradePreview(undefined);
      setSelectedInstanceId(String(value.instances[0]?.instanceId ?? "") || undefined);
      setDirty(false);
    };
    // Optional history never gates the usable current Canvas.
    void Promise.resolve().then(() => client.readRevision({ workspaceId, systemId: selectedSystemId }))
      .then(result => {
        if (!active) return;
        if (result.ok) acceptRevision(result.value);
        else setRevisionError("Unable to load this system revision. Retry loading it.");
      }).catch(() => { if (active) setRevisionError("Unable to load this system revision. Retry loading it."); })
      .finally(() => { if (active) setRevisionLoading(false); });
    void Promise.resolve().then(() => client.listRevisions({ workspaceId, systemId: selectedSystemId }))
      .then(result => {
        if (!active) return;
        if (result.ok) setRevisions(current => {
          const owned = result.value.filter(item => String(item.systemId) === selectedSystemId && String(item.targetWorkspaceId) === workspaceId);
          const byId = new Map([...owned, ...current].map(item => [String(item.revisionId), item]));
          return [...byId.values()].sort((a, b) => b.revisionNumber - a.revisionNumber);
        });
        else setHistoryError("Revision history is unavailable. Your current Canvas is ready.");
      }).catch(() => { if (active) setHistoryError("Revision history is unavailable. Your current Canvas is ready."); });
    return () => { active = false; };
  }, [client, selectedSystemId, workspaceId, loadAttempt]);

  useEffect(() => {
    if (
      !revision ||
      structure ||
      dirty ||
      busy ||
      canUpgradeFoundation ||
      !isLegacyUiReferenceSystem(revision)
    ) {
      return;
    }
    const layout = defaultApplicationLayout(layoutOptions);
    if (!layout) return;
    void selectLayout(layout);
  }, [busy, canUpgradeFoundation, dirty, layoutOptions, revision, structure]);

  useEffect(() => {
    setSelectedAssetDetail(undefined);
    setSelectedAssetDetailError(undefined);
    if (
      composerMode !== "design" ||
      activeSidebarTab !== "properties" ||
      !selectedInstance
    ) {
      setSelectedAssetDetailLoading(false);
      return;
    }
    if (!client.readComposerAsset) {
      setSelectedAssetDetail(selectedDefinitionSummary);
      setSelectedAssetDetailLoading(false);
      return;
    }
    let active = true;
    setSelectedAssetDetailLoading(true);
    void definitionReader.read(client, { workspaceId, definitionRef: selectedInstance.definitionRef }, () => active)
      .then((result) => {
        if (!active) return;
        if (result.ok) setSelectedAssetDetail(result.value);
        else setSelectedAssetDetailError(result.error.message);
        setSelectedAssetDetailLoading(false);
      }).catch(() => {
        if (!active) return;
        setSelectedAssetDetailError("Asset properties are unavailable. Select the asset again to retry.");
        setSelectedAssetDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    activeSidebarTab,
    client,
    composerMode,
    selectedInstance?.definitionRef.id,
    selectedInstance?.definitionRef.version,
    selectedInstanceId,
    selectedDefinitionSummary,
    workspaceId,
  ]);

  useEffect(() => {
    if (
      composerMode !== "design" ||
      activeSidebarTab !== "properties" ||
      selectedDefinition?.definitionId !== "conversation.message-composer" ||
      modelOptionsLoaded
    ) {
      return;
    }
    if (!client.listModelOptions) {
      setModelOptionsError("Compatible models are unavailable.");
      return;
    }
    let active = true;
    setModelOptionsLoading(true);
    setModelOptionsError(undefined);
    void Promise.resolve().then(() => client.listModelOptions!({ workspaceId })).then((result) => {
      if (!active) return;
      if (result.ok) {
        setModelOptions(result.value.options);
        setModelOptionsLoaded(true);
      } else {
        setModelOptionsError(result.error.message);
      }
      setModelOptionsLoading(false);
    }).catch(() => {
      if (!active) return;
      setModelOptionsLoading(false);
      setModelOptionsError("Compatible models are unavailable. Select the composer again to retry.");
    });
    return () => {
      active = false;
    };
  }, [
    activeSidebarTab,
    client,
    composerMode,
    modelOptionsLoaded,
    selectedDefinition?.definitionId,
    workspaceId,
  ]);

  useEffect(() => {
    setStylingRootDetail(undefined);
    setStylingRootDetailError(undefined);
    if (
      composerMode !== "design" ||
      activeSidebarTab !== "styling" ||
      !stylingRootInstance
    ) {
      setStylingRootDetailLoading(false);
      return;
    }
    if (!client.readComposerAsset) {
      setStylingRootDetail(stylingRootDefinitionSummary);
      setStylingRootDetailLoading(false);
      return;
    }
    let active = true;
    setStylingRootDetailLoading(true);
    void definitionReader.read(client, { workspaceId, definitionRef: stylingRootInstance.definitionRef }, () => active)
      .then((result) => {
        if (!active) return;
        if (result.ok) setStylingRootDetail(result.value);
        else setStylingRootDetailError(result.error.message);
        setStylingRootDetailLoading(false);
      }).catch(() => {
        if (!active) return;
        setStylingRootDetailError("Asset properties are unavailable. Select the asset again to retry.");
        setStylingRootDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    activeSidebarTab,
    client,
    composerMode,
    stylingRootDefinitionSummary,
    stylingRootInstance?.definitionRef.id,
    stylingRootInstance?.definitionRef.version,
    workspaceId,
  ]);

  function loadLayoutsOnDemand() {
    return listAllComposerAssets(client, {
      workspaceId,
      searchText: APPLICATION_LAYOUT_CATALOG_QUERY,
    });
  }

  function loadCompatibleAssetsOnDemand(
    target: SystemComposerTargetSlot,
    query: SystemComposerAssetBrowseRequest,
  ): Promise<SystemBuilderResult<SystemBuilderComposerCatalog>> {
    const parent = instances.find(
      (instance) => String(instance.instanceId) === target.parentInstanceId,
    );
    if (!parent?.definitionRef.version) {
      return Promise.resolve(
        systemBuilderFailure(
          "system-builder.composer-parent-not-found",
          "The selected parent asset is unavailable in this system.",
        ),
      );
    }
    return client.listComposerAssets({
      workspaceId,
      parentDefinitionRef: parent.definitionRef,
      slotId: target.slotId,
      compatibleOnly: true,
      ...(query.searchText ? { searchText: query.searchText } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    });
  }

  function installSavedDraft(value: SystemBuilderRevision) {
    const checkpoint = createSystemComposerDraftHistory({ instances: value.instances, bindings: value.bindings, placements: value.placements ?? [], structure: value.structure }).present;
    savedDraft.current = checkpoint;
    setInstances(checkpoint.instances);
    setBindings(checkpoint.bindings);
    setPlacements(checkpoint.placements);
    setStructure(checkpoint.structure);
  }

  async function transact(action: (isCurrent: () => boolean) => Promise<void>) {
    if (operation.current) return;
    const token = {};
    const targetSystem = selectedSystemId;
    operation.current = token;
    const isCurrent = () => operation.current === token && currentScope.current === scope && currentSystem.current === targetSystem;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try { await action(isCurrent); }
    catch {
      if (isCurrent()) {
        catalogRequestInFlight.current = false;
        setCatalogLoading(false);
        setError("The system operation could not be completed. Your draft is preserved. Retry the action.");
      }
    }
    finally {
      if (operation.current === token) { operation.current = undefined; setBusy(false); }
    }
  }

  function editExistingSystem() {
    if (!existingSystemId || operation.current) return;
    if (dirty && existingSystemId !== selectedSystemId) {
      setError("Save or discard unsaved changes before switching systems.");
      return;
    }
    setError(undefined);
    setSelectedSystemId(existingSystemId);
    requestComposerCatalog();
  }

  async function createSystem() {
    if (operation.current) return;
    if (dirty) {
      setError("Save or discard unsaved changes before creating another system.");
      return;
    }
    if (!newSystemName.trim()) {
      setError("Enter a system name.");
      return;
    }
    return transact(async (isCurrent) => {
      setError(undefined);
      setNotice(undefined);
      let catalogItems = composerCatalog;
      if (!catalogItems.some(asset => asset.definitionId === DEFAULT_APPLICATION_LAYOUT_DEFINITION_ID && asset.layoutRole === "application-shell")) {
        catalogRequestInFlight.current = true;
        setCatalogLoading(true);
        setCatalogError(undefined);
        const catalogResult = await listAllComposerAssets(client, { workspaceId, searchText: DEFAULT_APPLICATION_LAYOUT_DEFINITION_ID }, items => items.some(asset => asset.definitionId === DEFAULT_APPLICATION_LAYOUT_DEFINITION_ID && asset.layoutRole === "application-shell"));
        if (!isCurrent()) return;
        catalogRequestInFlight.current = false;
        setCatalogLoading(false);
        if (!catalogResult.ok) {
          setCatalogError(catalogResult.error.message);
          setError(catalogResult.error.message);
          return;
        }
        catalogItems = catalogResult.value.items;
        setComposerCatalog(catalogItems);
      }
      const layout = catalogItems.find(asset => asset.definitionId === DEFAULT_APPLICATION_LAYOUT_DEFINITION_ID && asset.layoutRole === "application-shell");
      if (!layout) {
        setError("The required Minimal application layout is unavailable.");
        return;
      }
      setSelectedLayoutDefinitionId(layout.definitionId);
      const result = await client.create({
        workspaceId,
        name: newSystemName.trim(),
        profile: "interactive",
        layoutPresetRef: layout.definitionRef,
      });
      if (!isCurrent()) return;
      if (result.ok && String(result.value.targetWorkspaceId) !== workspaceId) {
        setError("The created system does not belong to this workspace.");
        return;
      }
      if (result.ok) {
        setSystems((current) => [result.value, ...current]);
        setExistingSystemId(String(result.value.systemId));
        setSelectedSystemId(String(result.value.systemId));
        requestComposerCatalog();
        setNewSystemName("");
        setDirty(false);
        setNotice(
          `${layout.displayName} system created. Use Add element in a canvas container to compose its contents.`,
        );
      } else setError(result.error.message);
    });
  }

  async function createReferenceSystem() {
    if (operation.current) return;
    if (dirty) {
      setError("Save or discard unsaved changes before creating another system.");
      return;
    }
    const template = templates.find(
      (item) => item.templateId === selectedTemplateId,
    );
    if (!template) {
      setError("No supported reference-system template is available.");
      return;
    }
    if (!referenceSystemName.trim()) {
      setError("Enter a template system name.");
      return;
    }
    return transact(async (isCurrent) => {
      setError(undefined);
      setNotice(undefined);
      const result = await client.createFromTemplate({
        workspaceId,
        templateId: template.templateId,
        name: referenceSystemName.trim(),
      });
      if (!isCurrent()) return;
      if (result.ok && String(result.value.targetWorkspaceId) !== workspaceId) {
        setError("The created system does not belong to this workspace.");
        return;
      }
      if (result.ok) {
        setSystems((current) => [result.value, ...current]);
        requestComposerCatalog();
        setExistingSystemId(String(result.value.systemId));
        setSelectedSystemId(String(result.value.systemId));
        setReferenceSystemName("");
        setDirty(false);
        setNotice(
          `${template.displayName} created and validated from canonical assets.`,
        );
      } else setError(result.error.message);
    });
  }

  function applyDraftHistory(
    history: ReturnType<typeof createSystemComposerDraftHistory>,
  ) {
    setInstances(history.present.instances);
    setPlacements(history.present.placements);
    setBindings(history.present.bindings);
    setStructure(history.present.structure);
    setSelectedLayoutDefinitionId(
      history.present.structure?.layoutPresetRef
        ? String(history.present.structure.layoutPresetRef.id)
        : undefined,
    );
    setUndoDrafts(history.past);
    setRedoDrafts(history.future);
    setDirty(!areSystemComposerDraftsEqual(history.present, savedDraft.current));
    setError(undefined);
    setNotice(undefined);
  }

  function commitDraft(next: SystemComposerDraft) {
    if (operation.current) return;
    applyDraftHistory(
      commitSystemComposerDraft(
        { past: undoDrafts, present: draft, future: redoDrafts },
        next,
      ),
    );
  }

  function undoDraft() {
    if (operation.current) return;
    applyDraftHistory(
      undoSystemComposerDraft({
        past: undoDrafts,
        present: draft,
        future: redoDrafts,
      }),
    );
  }

  function redoDraft() {
    if (operation.current) return;
    applyDraftHistory(
      redoSystemComposerDraft({
        past: undoDrafts,
        present: draft,
        future: redoDrafts,
      }),
    );
  }

  function addAsset(
    asset: SystemBuilderComposerAsset,
    target: SystemComposerTargetSlot,
  ) {
    if (!revision || operation.current) return;
    const instanceId = `instance.${safeId(asset.definitionId)}.${uniqueId()}`;
    const result = addSystemComposerAsset(draft, {
      asset,
      compositionId: String(revision.composition.compositionId),
      parentInstanceId: target.parentInstanceId,
      slotId: target.slotId,
      instanceId,
      order: target.order,
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    commitDraft(result.value);
    setComposerCatalog(current => current.some(item => item.definitionId === asset.definitionId && item.version === asset.version) ? current : [...current, asset]);
    setSelectedInstanceId(instanceId);
  }

  function removeSelected() {
    if (!selectedInstanceId) return;
    const parentId = placements.find(
      (placement) =>
        String(placement.childInstanceRef.id) === selectedInstanceId,
    )?.parentInstanceRef.id;
    const result = removeSystemComposerSubtree(
      draft,
      selectedInstanceId,
      protectedInstanceIds,
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }
    commitDraft(result.value);
    setSelectedInstanceId(parentId ? String(parentId) : undefined);
  }

  function placeAsset(instanceId: string, target: SystemComposerTargetSlot) {
    const hasPlacement = draft.placements.some(
      (placement) => String(placement.childInstanceRef.id) === instanceId,
    );
    const result = hasPlacement
      ? reparentSystemComposerAsset(draft, { instanceId, ...target })
      : attachUnassignedSystemComposerAsset(draft, {
        instanceId,
        ...target,
        rootInstanceIds: new Set(
          revision?.composition.rootInstanceRefs.map((reference) =>
            String(reference.id),
          ) ?? [],
        ),
      });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    commitDraft(result.value);
    setSelectedInstanceId(instanceId);
  }
  function discardDraft() {
    if (operation.current) return;
    if (!revision) return;
    const checkpoint = savedDraft.current;
    if (!checkpoint) return;
    setInstances(checkpoint.instances);
    setBindings(checkpoint.bindings);
    setPlacements(checkpoint.placements);
    setStructure(checkpoint.structure);
    setSelectedLayoutDefinitionId(
      checkpoint.structure?.layoutPresetRef
        ? String(checkpoint.structure.layoutPresetRef.id)
        : undefined,
    );
    setUndoDrafts([]);
    setRedoDrafts([]);
    setSelectedInstanceId(
      String(revision.instances[0]?.instanceId ?? "") || undefined,
    );
    setDirty(false);
    setError(undefined);
    setNotice("Unsaved changes discarded.");
  }

  function removeBinding(bindingId: string) {
    commitDraft({
      ...draft,
      bindings: draft.bindings.filter(
        (binding) => String(binding.bindingId) !== bindingId,
      ),
    });
  }
  function updateSelectedConfiguration(values: AssetConfigurationValues) {
    if (!selectedInstanceId) return;
    updateInstanceConfiguration(
      selectedInstanceId,
      values,
    );
  }

  function updateRootStyling(values: AssetConfigurationValues) {
    if (!stylingRootInstanceId) return;
    updateInstanceConfiguration(
      stylingRootInstanceId,
      values,
    );
  }

  function updateInstanceConfiguration(
    instanceId: string,
    values: AssetConfigurationValues,
  ) {
    commitDraft({
      ...draft,
      instances: draft.instances.map((item) =>
        String(item.instanceId) === instanceId
          ? { ...item, selectedConfiguration: values }
          : item,
      ),
    });
    setError(undefined);
  }

  function connectDeclaredPorts(
    source: SystemComposerPortEndpoint,
    target: SystemComposerPortEndpoint,
  ) {
    const binding: AssetBinding = {
      bindingId: `binding.${uniqueId()}`,
      bindingKind: bindingKindForSystemComposerEndpoint(source),
      sourceRef: {
        kind: "asset-instance",
        id: source.instanceId,
      } as AssetReference,
      targetRef: {
        kind: "asset-instance",
        id: target.instanceId,
      } as AssetReference,
      sourcePortRef: {
        kind: "asset-definition",
        id: source.port.portId,
      } as AssetReference,
      targetPortRef: {
        kind: "asset-definition",
        id: target.port.portId,
      } as AssetReference,
      lifecycleStatus: "draft",
      provenance: { sourceKind: "human-authored" },
    };
    commitDraft({ ...draft, bindings: [...draft.bindings, binding] });
    setError(undefined);
  }

  async function selectLayout(layout: SystemBuilderComposerAsset) {
    if (!selectedSystem || !revision) {
      setSelectedLayoutDefinitionId(layout.definitionId);
      return;
    }
    if (canUpgradeFoundation) {
      setError(
        "Upgrade this historical System Foundation before selecting a layout.",
      );
      return;
    }
    if (
      structure &&
      String(structure.layoutPresetRef?.id) === layout.definitionId &&
      structure.layoutPresetRef?.version === layout.version
    ) {
      setNotice(`${layout.displayName} is already the active layout.`);
      return;
    }
    return transact(async (isCurrent) => {
      setError(undefined);
      setNotice(undefined);
      const result = await client.previewLayoutChange({
        workspaceId,
        systemId: String(selectedSystem.systemId),
        expectedRecordRevision: selectedSystem.revision,
        targetLayoutPresetRef: layout.definitionRef,
        composition: revision.composition,
        instances,
        bindings,
        placements,
        ...(structure ? { structure } : {}),
      });
      if (!isCurrent()) return;
      if (result.ok) {
        applyDraftHistory(commitSystemComposerDraft({ past: undoDrafts, present: draft, future: redoDrafts }, {
          instances: result.value.instances, placements: result.value.placements,
          bindings: result.value.bindings, structure: result.value.structure,
        }));
        setSelectedLayoutDefinitionId(layout.definitionId);
      } else setError(result.error.message);
    });
  }

  async function save() {
    if (!revision || !selectedSystem) return;
    return transact(async (isCurrent) => {
      setError(undefined);
      setNotice(undefined);
      const saveCatalog: SystemBuilderComposerAsset[] = [
        ...composerCatalog,
        ...(selectedAssetDetail ? [selectedAssetDetail] : []),
        ...(stylingRootDetail ? [stylingRootDetail] : []),
      ];
      if (client.readComposerAsset) {
        const detailedDefinitionKeys = new Set(
          saveCatalog
            .filter((definition) => definition.configurationSchema)
            .map(
              (definition) => `${definition.definitionId}@${definition.version}`,
            ),
        );
        const missingConfiguredDefinitionRefs = new Map<string, AssetReference>();
        for (const instance of instances) {
          if (Object.keys(instance.selectedConfiguration ?? {}).length === 0) {
            continue;
          }
          const definitionKey = `${String(instance.definitionRef.id)}@${instance.definitionRef.version ?? ""}`;
          if (!detailedDefinitionKeys.has(definitionKey)) {
            missingConfiguredDefinitionRefs.set(
              definitionKey,
              instance.definitionRef,
            );
          }
        }
        const detailResults = await Promise.all(
          [...missingConfiguredDefinitionRefs.values()].map((definitionRef) =>
            definitionReader.read(client, { workspaceId, definitionRef }, isCurrent),
          ),
        );
        if (!isCurrent()) return;
        const failedDetail = detailResults.find((result) => !result.ok);
        if (failedDetail && !failedDetail.ok) {
          setError(
            `Unable to verify configured asset properties before saving. ${failedDetail.error.message}`,
          );
          return;
        }
        saveCatalog.push(
          ...detailResults
            .filter((result) => result.ok)
            .map((result) => result.value),
        );
      }
      const saveInstances = sanitizeSystemComposerInstanceConfigurations(
        instances,
        saveCatalog,
      );
      const instanceRefs = saveInstances.map(
        (item) =>
          ({ kind: "asset-instance", id: item.instanceId }) as AssetReference,
      );
      const bindingRefs = bindings.map(
        (item) =>
          ({ kind: "asset-binding", id: item.bindingId }) as AssetReference,
      );
      const placementRefs = placements.map(
        (item) =>
          ({ kind: "asset-placement", id: item.placementId }) as AssetReference,
      );
      const composition = {
        ...revision.composition,
        lifecycleStatus: "draft" as const,
        instanceRefs,
        rootInstanceRefs: revision.composition.rootInstanceRefs,
        bindingRefs,
        placementRefs,
      };
      const result = await client.saveRevision({
        workspaceId,
        systemId: String(selectedSystem.systemId),
        expectedRecordRevision: selectedSystem.revision,
        composition,
        instances: saveInstances,
        bindings,
        structure,
        placements,
      });
      if (!isCurrent()) return;
      if (result.ok && (String(result.value.systemId) !== selectedSystemId || String(result.value.targetWorkspaceId) !== workspaceId)) {
        setError("The returned revision does not belong to this system. Your draft is preserved.");
        return;
      }
      if (result.ok) {
        setRevision(result.value);
        installSavedDraft(result.value);
        setUndoDrafts([]);
        setRedoDrafts([]);
        setRevisions((current) => [result.value, ...current]);
        setDirty(false);
        const invalid = result.value.validationIssues.filter(
          (issue) => issue.severity === "error",
        ).length;
        setSystems((current) =>
          current.map((item) =>
            String(item.systemId) === selectedSystemId
              ? {
                ...item,
                revision: item.revision + 1,
                currentRevisionId: result.value.revisionId,
                composition,
                status: invalid
                  ? "blocked"
                  : instances.length
                    ? "validated"
                    : "draft",
              }
              : item,
          ),
        );
        setNotice(
          invalid
            ? `Revision saved with ${invalid} blocking validation issue${invalid === 1 ? "" : "s"}.`
            : "Revision saved and validated.",
        );
      } else setError(result.error.message);
    });
  }

  async function previewFoundationUpgrade() {
    if (!revision || !selectedSystem || dirty) return;
    return transact(async (isCurrent) => {
      setError(undefined);
      setNotice(undefined);
      const result = await client.previewFoundationUpgrade({
        workspaceId,
        systemId: String(selectedSystem.systemId),
        expectedRecordRevision: selectedSystem.revision,
      });
      if (!isCurrent()) return;
      if (result.ok) {
        setFoundationUpgradePreview(result.value);
        setFoundationUpgradeOpen(true);
      } else {
        setError(result.error.message);
      }
    });
  }

  async function confirmFoundationUpgrade() {
    if (
      !revision ||
      !selectedSystem ||
      !foundationUpgradePreview?.eligible ||
      dirty
    ) {
      return;
    }
    return transact(async (isCurrent) => {
      setError(undefined);
      const result = await client.upgradeFoundation({
        workspaceId,
        systemId: String(selectedSystem.systemId),
        expectedRecordRevision: selectedSystem.revision,
        sourceRevisionId: foundationUpgradePreview.sourceRevisionId,
      });
      if (!isCurrent()) return;
      if (result.ok && (String(result.value.systemId) !== selectedSystemId || String(result.value.targetWorkspaceId) !== workspaceId)) {
        setError("The returned revision does not belong to this system. Your draft is preserved.");
        return;
      }
      if (result.ok) {
        setRevision(result.value);
        installSavedDraft(result.value);
        setSelectedLayoutDefinitionId(
          result.value.structure?.layoutPresetRef
            ? String(result.value.structure.layoutPresetRef.id)
            : undefined,
        );
        setSelectedInstanceId(
          String(result.value.instances[0]?.instanceId ?? "") || undefined,
        );
        setUndoDrafts([]);
        setRedoDrafts([]);
        setRevisions((current) => [result.value, ...current]);
        setDirty(false);
        setSystems((current) =>
          current.map((item) =>
            String(item.systemId) === selectedSystemId
              ? {
                ...item,
                revision: item.revision + 1,
                currentRevisionId: result.value.revisionId,
                composition: result.value.composition,
                status: "validated",
              }
              : item,
          ),
        );
        setFoundationUpgradeOpen(false);
        setFoundationUpgradePreview(undefined);
        setNotice(
          "System Foundation upgraded to 3.0.0 in a new immutable revision.",
        );
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <>
      <section
        className="ui-panel ui-panel--sectioned system-builder"
        aria-labelledby="system-builder-workspace-title"
      >
        <header className="ui-panel__section-header">
          <div className="ui-panel-heading ui-panel-heading--blue">
            <span className="ui-panel-heading__icon" aria-hidden="true">
              <ApplicationIcon name="systems" />
            </span>
            <div>
              <h2
                id="system-builder-workspace-title"
                className="ui-panel__title"
              >
                System composition
              </h2>
              <p className="ui-text-muted">
                Compose exact asset versions, configure instances, connect typed
                ports, and save immutable revisions.
              </p>
            </div>
          </div>
        </header>
        <div className="ui-panel__section-body ui-stack ui-stack--md">
          <TransientNotificationPublisher message={error} title="System Composer needs attention" tone="error" source="System Composer" workspaceId={workspaceId} />
          {contextualNotice ? <p className="ui-status" role="status">{notice}</p> : null}
          <TransientNotificationPublisher message={!contextualNotice ? notice : undefined} title="System Composer updated" tone="success" source="System Composer" workspaceId={workspaceId} />
          <p id="system-builder-entry-instructions" className="ui-text-muted">
            Choose an option below to interact with the System Composer.
          </p>
          <div
            className="system-builder__entry-options"
            role="group"
            aria-label="Composer entry options"
            aria-describedby="system-builder-entry-instructions"
          >
            <fieldset className="system-builder__entry-option system-builder__entry-option--existing">
              <legend>1. Edit an existing system</legend>
              <p>Select an active system, then load it into the Composer.</p>
              <div className="system-builder__entry-option-controls">
                <label>
                  System
                  <select
                    value={existingSystemId}
                    onChange={(event) => {
                      setExistingSystemId(event.currentTarget.value);
                    }}
                  >
                    <option value="">Choose a system</option>
                    {systems.map((system) => (
                      <option
                        key={String(system.systemId)}
                        value={String(system.systemId)}
                      >
                        {system.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={editExistingSystem}
                  disabled={!existingSystemId || revisionLoading}
                >
                  {revisionLoading && existingSystemId === selectedSystemId ? (
                    <LoadingSpinner label="Loading system into Composer" />
                  ) : (
                    <ApplicationIcon name="systems" />
                  )}
                  <span>
                    {revisionLoading && existingSystemId === selectedSystemId
                      ? "Loading system..."
                      : "Edit system"}
                  </span>
                </button>
              </div>
            </fieldset>

            <fieldset className="system-builder__entry-option system-builder__entry-option--new">
              <legend>2. Create a new system</legend>
              <p>Start a system with the required default Minimal layout.</p>
              <div className="system-builder__entry-option-controls">
                <label>
                  New system name
                  <input
                    value={newSystemName}
                    onChange={(event) =>
                      setNewSystemName(event.currentTarget.value)
                    }
                    placeholder="Customer portal"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void createSystem()}
                  disabled={busy || !newSystemName.trim()}
                >
                  {busy && catalogLoading ? (
                    <LoadingSpinner label="Loading application layouts" />
                  ) : (
                    <ApplicationIcon name="add" />
                  )}
                  <span>
                    {busy && catalogLoading
                      ? "Preparing system..."
                      : "Create system"}
                  </span>
                </button>
              </div>
            </fieldset>

            <fieldset className="system-builder__entry-option system-builder__entry-option--reference">
              <legend>3. Create from a template</legend>
              <p>Start from a validated built-in system template.</p>
              <div className="system-builder__entry-option-controls">
                <label>
                  System template
                  <select
                    aria-label="System template"
                    value={selectedTemplateId}
                    onChange={(event) =>
                      setSelectedTemplateId(
                        event.currentTarget.value as
                        SystemBuilderTemplateSummary["templateId"] | "",
                      )
                    }
                  >
                    <option value="">Choose a template</option>
                    {templates.map((template) => (
                      <option
                        key={template.templateId}
                        value={template.templateId}
                      >
                        {template.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Template system name
                  <input
                    value={referenceSystemName}
                    onChange={(event) =>
                      setReferenceSystemName(event.currentTarget.value)
                    }
                    placeholder="Use template name"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void createReferenceSystem()}
                  disabled={
                    busy || !selectedTemplateId || !referenceSystemName.trim()
                  }
                >
                  <ApplicationIcon name="systems" />
                  <span>Create from template</span>
                </button>
              </div>
            </fieldset>
          </div>
          {existingSystemIsLoaded && selectedSystem ? (
            <div
              className="system-builder__toolbar"
              role="toolbar"
              aria-label="Loaded system actions"
            >
              {canUpgradeFoundation ? (
                <button
                  type="button"
                  className="ui-button ui-button--outline"
                  onClick={() => void previewFoundationUpgrade()}
                  disabled={busy || dirty}
                  aria-haspopup="dialog"
                >
                  <ApplicationIcon name="refresh" />
                  <span>Upgrade Foundation</span>
                </button>
              ) : null}
              <button
                type="button"
                className="ui-button ui-button--outline"
                onClick={() => setPreviewOpen(true)}
                disabled={busy || !componentsReady || instances.length === 0}
                aria-haspopup="dialog"
              >
                <ApplicationIcon name="play" />
                <span>Preview UI</span>
              </button>
              {onBuildAndTest ? (
                <button
                  type="button"
                  className="ui-button ui-button--outline"
                  onClick={() =>
                    revision &&
                    onBuildAndTest({ system: selectedSystem, revision })
                  }
                  disabled={busy || dirty}
                >
                  <ApplicationIcon name="systems" />
                  <span>Build &amp; test</span>
                </button>
              ) : null}
            </div>
          ) : null}
          {revisionError ? <div role="alert"><p>{revisionError}</p><button type="button" onClick={() => setLoadAttempt(value => value + 1)}>Retry loading system</button></div> : null}
          {selectedSystem && revision && existingSystemIsLoaded ? (
            <>
              <div className="system-builder__status">
                <span
                  className={`ui-badge ui-badge--${selectedSystem.status === "blocked" ? "danger" : "info"}`}
                >
                  {selectedSystem.status}
                </span>
                {dirty ? (
                  <span className="ui-badge ui-badge--warning">
                    Unsaved changes
                  </span>
                ) : null}
                <span>Revision {revision.revisionNumber}</span>
                <span>{instances.length} assets</span>
                <span>{bindings.length} connections</span>
              </div>
              <div
                className="system-composer__modes"
                role="tablist"
                aria-label="Composer mode"
              >
                {(["design", "connections"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={composerMode === mode}
                    className="system-composer__flat-control"
                    onClick={() => setComposerMode(mode)}
                  >
                    {mode === "design" ? "Design" : "Connections"}
                  </button>
                ))}
              </div>
              {catalogError ? <div role="alert"><p>{catalogError}</p><button type="button" onClick={requestComposerCatalog}>Retry component definitions</button></div> : null}
              <fieldset disabled={busy || !componentsReady} aria-busy={!componentsReady && !catalogError} aria-label="System draft editor" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                {composerMode === "design" ? (
                  <SystemComposerStructureEditor
                    browseScopeKey={workspaceId}
                    draft={draft}
                    rootInstanceRefs={revision.composition.rootInstanceRefs}
                    catalog={composerCatalog}
                    selectedLayoutDefinitionId={selectedLayoutDefinitionId}
                    layoutSelectionDisabled={busy}
                    selectedInstanceId={selectedInstanceId}
                    protectedInstanceIds={protectedInstanceIds}
                    propertiesPanel={
                      selectedAssetDetailLoading ? (
                        <div className="system-composer__detail-loading">
                          <LoadingSpinner label="Loading selected asset properties" />
                          <span>Loading selected asset properties...</span>
                        </div>
                      ) : selectedAssetDetailError ? (
                        <p className="ui-status ui-status--error" role="alert">
                          {selectedAssetDetailError}
                        </p>
                      ) : (
                        <SystemComposerInspector
                          mode="configuration"
                          embedded
                          selectedInstance={selectedInstance}
                          selectedDefinition={selectedDefinition}
                          instances={instances}
                          catalog={composerCatalog}
                          bindings={bindings}
                          modelOptions={modelOptions}
                          modelOptionsLoading={modelOptionsLoading}
                          modelOptionsError={modelOptionsError}
                          onConfigurationChange={updateSelectedConfiguration}
                          onAddConnection={connectDeclaredPorts}
                          onRemoveConnection={removeBinding}
                        />
                      )
                    }
                    stylingPanel={
                      stylingRootDetailLoading ? (
                        <div className="system-composer__detail-loading">
                          <LoadingSpinner label="Loading system styling" />
                          <span>Loading system styling...</span>
                        </div>
                      ) : stylingRootDetailError ? (
                        <p className="ui-status ui-status--error" role="alert">
                          {stylingRootDetailError}
                        </p>
                      ) : (
                        <SystemComposerStylingPanel
                          rootInstance={stylingRootInstance}
                          rootDefinition={stylingRootDefinition}
                          catalog={composerCatalog}
                          onChange={updateRootStyling}
                        />
                      )
                    }
                    catalogLoading={catalogLoading}
                    catalogError={catalogError}
                    canUndo={undoDrafts.length > 0}
                    canRedo={redoDrafts.length > 0}
                    onSelect={setSelectedInstanceId}
                    onSelectLayout={(layout) => void selectLayout(layout)}
                    loadLayouts={loadLayoutsOnDemand}
                    loadCompatibleAssets={loadCompatibleAssetsOnDemand}
                    onSidebarTabChange={setActiveSidebarTab}
                    onAdd={addAsset}
                    onPlace={placeAsset}
                    onRemove={removeSelected}
                    onUndo={undoDraft}
                    onRedo={redoDraft}
                  />
                ) : (
                  <SystemComposerInspector
                    mode="connections"
                    selectedInstance={selectedInstance}
                    selectedDefinition={selectedDefinition}
                    instances={instances}
                    catalog={composerCatalog}
                    bindings={bindings}
                    modelOptions={modelOptions}
                    modelOptionsLoading={modelOptionsLoading}
                    modelOptionsError={modelOptionsError}
                    onConfigurationChange={updateSelectedConfiguration}
                    onAddConnection={connectDeclaredPorts}
                    onRemoveConnection={removeBinding}
                  />
                )}
              </fieldset>
              {revision.validationIssues.length ? (
                <section
                  className="system-builder__diagnostics"
                  aria-labelledby="system-builder-diagnostics-title"
                >
                  <h3 id="system-builder-diagnostics-title">
                    Validation diagnostics
                  </h3>
                  <ul>
                    {revision.validationIssues.map((issue, index) => (
                      <li
                        key={`${issue.category}-${index}`}
                        className={`ui-status ui-status--${issue.severity === "error" ? "error" : "warning"}`}
                      >
                        <strong>
                          {issue.severity === "error" ? "Blocking" : "Review"}
                        </strong>
                        <span>{issue.message}</span>
                        {issue.path?.length ? (
                          <code>{issue.path.join(".")}</code>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <footer className="system-builder__footer">
                <div>
                  <strong>Revision history</strong>
                  {historyError ? <span role="status">{historyError}</span> : null}
                  <span>
                    {revisions
                      .map((item) => `r${item.revisionNumber}`)
                      .join(" · ")}
                  </span>
                </div>
                <div className="ui-inline-actions">
                  {dirty ? (
                    <button
                      type="button"
                      className="ui-button ui-button--outline"
                      onClick={discardDraft}
                      disabled={busy}
                    >
                      Discard changes
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={
                      busy ||
                      (!dirty &&
                        selectedSystem.status !== "blocked" &&
                        !canRepairConversationInteraction) ||
                      selectedSystem.status === "archived"
                    }
                  >
                    <ApplicationIcon name="save" />
                    <span>Save and validate revision</span>
                  </button>
                </div>
              </footer>
            </>
          ) : null}
        </div>
      </section>
      <ModalDialog
        open={previewOpen && Boolean(selectedSystem && revision)}
        title={`${selectedSystem?.name ?? "System"} UI preview`}
        onClose={() => setPreviewOpen(false)}
        closeLabel="Close system UI preview"
        dialogClassName="system-composition-preview-dialog"
      >
        {selectedSystem ? (
          <SystemCompositionPreview
            systemName={selectedSystem.name}
            instances={instances}
            placements={placements}
            rootInstanceRefs={revision?.composition.rootInstanceRefs ?? []}
            catalog={composerCatalog}
          />
        ) : null}
      </ModalDialog>
      <ModalDialog
        open={foundationUpgradeOpen && Boolean(foundationUpgradePreview)}
        title="Upgrade System Foundation"
        onClose={() => {
          if (!busy) setFoundationUpgradeOpen(false);
        }}
        closeLabel="Close System Foundation upgrade preview"
      >
        {foundationUpgradePreview ? (
          <div className="ui-stack ui-stack--md">
            <p>
              This creates a new immutable Foundation 3.0.0 revision. The exact
              Foundation {foundationUpgradePreview.sourceVersion} source
              revision remains available in revision history.
            </p>
            <dl>
              <dt>Source revision</dt>
              <dd>{foundationUpgradePreview.sourceRevisionId}</dd>
              <dt>Mapped Foundation instances</dt>
              <dd>{foundationUpgradePreview.mappedInstanceCount}</dd>
              <dt>Mapped configuration fields</dt>
              <dd>{foundationUpgradePreview.mappedConfigurationFieldCount}</dd>
            </dl>
            {foundationUpgradePreview.issues.length > 0 ? (
              <div className="ui-status ui-status--error" role="alert">
                <strong>Upgrade blocked by unmapped data.</strong>
                <ul>
                  {foundationUpgradePreview.issues.map((issue, index) => (
                    <li key={`${issue.code}-${index}`}>{issue.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {foundationUpgradePreview.validationIssues.length > 0 ? (
              <div
                className={
                  foundationUpgradePreview.validationStatus === "invalid"
                    ? "ui-status ui-status--error"
                    : "ui-status ui-status--warning"
                }
                role={
                  foundationUpgradePreview.validationStatus === "invalid"
                    ? "alert"
                    : "status"
                }
              >
                <strong>Candidate validation</strong>
                <ul>
                  {foundationUpgradePreview.validationIssues.map(
                    (issue, index) => (
                      <li key={`${issue.category}-${index}`}>
                        {issue.message}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            ) : null}
            {foundationUpgradePreview.eligible ? (
              <p className="ui-status ui-status--success" role="status">
                The candidate maps without data loss and passes validation.
              </p>
            ) : null}
            <div className="ui-inline-actions">
              <button
                type="button"
                className="ui-button ui-button--outline"
                onClick={() => setFoundationUpgradeOpen(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmFoundationUpgrade()}
                disabled={busy || !foundationUpgradePreview.eligible}
              >
                <ApplicationIcon name="refresh" />
                <span>Create upgraded revision</span>
              </button>
            </div>
          </div>
        ) : null}
      </ModalDialog>
    </>
  );
}

const COMPOSER_CATALOG_PAGE_LIMIT = 200;
const COMPOSER_CATALOG_MAX_PAGES = 10;
const APPLICATION_LAYOUT_CATALOG_QUERY = "builtin.layout.application";
const DEFAULT_APPLICATION_LAYOUT_DEFINITION_ID =
  "builtin.layout.application.minimal";

function defaultApplicationLayout(
  assets: readonly SystemBuilderComposerAsset[],
): SystemBuilderComposerAsset | undefined {
  return (
    assets.find(
      (asset) =>
        asset.layoutRole === "application-shell" &&
        asset.definitionId === DEFAULT_APPLICATION_LAYOUT_DEFINITION_ID,
    ) ?? assets.find((asset) => asset.layoutRole === "application-shell")
  );
}

function usesUpgradeableFoundationVersion(
  revision: SystemBuilderRevision,
): boolean {
  return revision.instances.some(
    (instance) =>
      instance.definitionRef.kind === "asset-definition-version" &&
      SYSTEM_BUILDER_FOUNDATION_UPGRADE_SOURCE_VERSIONS.some(
        (version) => version === instance.definitionRef.version,
      ),
  );
}

function isLegacyUiReferenceSystem(revision: SystemBuilderRevision): boolean {
  if (revision.structure) return false;
  return revision.instances.some((instance) => {
    const kind = instance.metadata?.referenceSystemKind;
    return (
      kind === "secured-data-entry" ||
      kind === "controlled-chatbot" ||
      kind === "secured-data-review"
    );
  });
}

export function preferredSystemComposerTarget({
  instances,
  placements,
  catalog,
  activeLayoutDefinitionId,
  selectedInstanceId,
}: {
  readonly instances: readonly AssetInstance[];
  readonly placements: readonly AssetPlacement[];
  readonly catalog: readonly SystemBuilderComposerAsset[];
  readonly activeLayoutDefinitionId?: string;
  readonly selectedInstanceId?: string;
}): SystemComposerTargetSlot | undefined {
  const byInstanceId = new Map(
    instances.map((instance) => [String(instance.instanceId), instance]),
  );
  const definitionFor = (instance: AssetInstance) =>
    catalog.find(
      (asset) =>
        asset.definitionId === String(instance.definitionRef.id) &&
        asset.version === instance.definitionRef.version,
    );
  const placedPageLayouts = [...placements]
    .sort(
      (left, right) =>
        left.order - right.order ||
        String(left.placementId).localeCompare(String(right.placementId)),
    )
    .flatMap((placement) => {
      const instance = byInstanceId.get(String(placement.childInstanceRef.id));
      return instance && definitionFor(instance)?.layoutRole === "page-layout"
        ? [instance]
        : [];
    });
  const selected = selectedInstanceId
    ? byInstanceId.get(selectedInstanceId)
    : undefined;
  const activeLayout = activeLayoutDefinitionId
    ? instances.find(
      (instance) =>
        String(instance.definitionRef.id) === activeLayoutDefinitionId,
    )
    : undefined;
  const orderedCandidates = uniqueInstances([
    ...placedPageLayouts,
    ...(selected ? [selected] : []),
    ...(activeLayout ? [activeLayout] : []),
    ...instances,
  ]);

  for (const instance of orderedCandidates) {
    const definition = definitionFor(instance);
    if (!definition) continue;
    const orderedSlots = [
      ...definition.slots.filter((slot) => slot.slotId === "content"),
      ...definition.slots.filter((slot) => slot.slotId !== "content"),
    ];
    const slot = orderedSlots.find((candidate) => {
      const currentCount = placements.filter(
        (placement) =>
          String(placement.parentInstanceRef.id) ===
          String(instance.instanceId) &&
          placement.slotId === candidate.slotId,
      ).length;
      return currentCount < candidate.cardinality.maxItems;
    });
    if (slot) {
      return {
        parentInstanceId: String(instance.instanceId),
        slotId: slot.slotId,
      };
    }
  }
  return undefined;
}

function uniqueInstances(
  instances: readonly AssetInstance[],
): readonly AssetInstance[] {
  const seen = new Set<string>();
  return instances.filter((instance) => {
    const id = String(instance.instanceId);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}


async function loadDraftComposerCatalog(
  client: SystemBuilderClient, workspaceId: string, instances: readonly AssetInstance[], known: readonly SystemBuilderComposerAsset[], active: () => boolean, reader: ReturnType<typeof createSystemComposerDefinitionReader>,
): Promise<SystemBuilderResult<SystemBuilderComposerCatalog>> {
  if (!client.readComposerAsset) return loadComposerCatalog(client, workspaceId);
  const needed = new Map<string, AssetReference>();
  for (const instance of instances) needed.set(`${String(instance.definitionRef.id)}@${instance.definitionRef.version ?? ""}`, instance.definitionRef);
  if (needed.size > 512) return systemBuilderFailure("catalog-limit", "This system exceeds the component definition loading limit.");
  const available = new Map(known.map(asset => [`${asset.definitionId}@${asset.version}`, asset]));
  const missing = [...needed.entries()].filter(([key]) => !available.has(key));
  let cursor = 0;
  let failure = false;
  await Promise.all(Array.from({ length: Math.min(8, missing.length) }, async () => {
    while (active() && !failure) {
      const entry = missing[cursor++];
      if (!entry) return;
      const [key, definitionRef] = entry;
      try {
        const result = await reader.readSummary(client, { workspaceId, definitionRef }, active);
        if (!active()) return;
        if (!result.ok || result.value.definitionId !== String(definitionRef.id) || result.value.version !== definitionRef.version) { failure = true; return; }
        available.set(key, result.value);
      } catch { failure = true; return; }
    }
  }));
  if (failure) return systemBuilderFailure("catalog-unavailable", "A required component definition is unavailable. Retry opening this system.");
  return systemBuilderSuccess({ items: [...needed.keys()].flatMap(key => available.has(key) ? [available.get(key)!] : []) });
}

async function loadComposerCatalog(
  client: Pick<SystemBuilderClient, "listComposerAssets">,
  workspaceId: string,
): Promise<SystemBuilderResult<SystemBuilderComposerCatalog>> {
  const catalog = await listAllComposerAssets(client, { workspaceId });
  if (!catalog.ok) return catalog;
  if (
    catalog.value.items.some((item) => item.layoutRole === "application-shell")
  ) {
    return catalog;
  }

  const applicationLayouts = await listAllComposerAssets(client, {
    workspaceId,
    searchText: APPLICATION_LAYOUT_CATALOG_QUERY,
  });
  if (!applicationLayouts.ok) return applicationLayouts;

  const items = new Map<string, SystemBuilderComposerAsset>();
  for (const item of [
    ...catalog.value.items,
    ...applicationLayouts.value.items,
  ]) {
    items.set(`${item.definitionId}@${item.version}`, item);
  }
  const diagnostics = [
    ...(catalog.value.diagnostics ?? []),
    ...(applicationLayouts.value.diagnostics ?? []),
  ];
  return systemBuilderSuccess({
    items: [...items.values()],
    ...(diagnostics.length ? { diagnostics } : {}),
  });
}

async function listAllComposerAssets(
  client: Pick<SystemBuilderClient, "listComposerAssets">,
  query: Omit<ListSystemBuilderComposerAssetsQuery, "cursor" | "limit">,
  stopWhen?: (items: readonly SystemBuilderComposerAsset[]) => boolean,
): Promise<SystemBuilderResult<SystemBuilderComposerCatalog>> {
  const items: SystemBuilderComposerAsset[] = [];
  const diagnostics: NonNullable<
    SystemBuilderComposerCatalog["diagnostics"]
  >[number][] = [];
  const seenDefinitions = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < COMPOSER_CATALOG_MAX_PAGES; page += 1) {
    const result = await client.listComposerAssets({
      ...query,
      limit: COMPOSER_CATALOG_PAGE_LIMIT,
      ...(cursor ? { cursor } : {}),
    });
    if (!result.ok) return result;

    for (const item of result.value.items) {
      const key = `${item.definitionId}@${item.version}`;
      if (seenDefinitions.has(key)) continue;
      seenDefinitions.add(key);
      items.push(item);
    }
    diagnostics.push(...(result.value.diagnostics ?? []));

    const nextCursor = result.value.nextCursor?.trim();
    if (!nextCursor || stopWhen?.(items)) {
      return systemBuilderSuccess({
        items,
        ...(diagnostics.length ? { diagnostics } : {}),
      });
    }
    if (seenCursors.has(nextCursor)) {
      return systemBuilderFailure(
        "system-builder.composer-cursor-cycle",
        "Unable to finish reading compatible assets for this workspace.",
      );
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return systemBuilderFailure(
    "system-builder.composer-page-limit",
    "The compatible asset catalog is too large to load safely.",
  );
}

const safeId = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 48);
const uniqueId = () =>
  (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  ).replace(/-/g, "");
