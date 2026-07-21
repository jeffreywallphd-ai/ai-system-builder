import { useEffect, useMemo, useState } from "react";
import type {
  AssetBinding,
  AssetConfigurationValues,
  AssetInstance,
  AssetPlacement,
  AssetReference,
} from "../../../contracts/asset";
import type {
  SystemBuilderRecord,
  SystemBuilderResult,
  SystemBuilderRevision,
  SystemBuilderTemplateSummary,
  ListSystemBuilderComposerAssetsQuery,
  SystemBuilderComposerCatalog,
  SystemBuilderComposerAsset,
  ListSystemBuilderManagementQuery,
  SystemBuilderManagementPage,
  PreviewSystemBuilderLayoutChangeCommand,
  SystemBuilderLayoutChangePreview,
} from "../../../contracts/system-builder";
import {
  systemBuilderFailure,
  systemBuilderSuccess,
} from "../../../contracts/system-builder";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { EmptyState } from "../components/EmptyState";
import { ModalDialog } from "../components/ModalDialog";
import { SystemCompositionPreview } from "./SystemCompositionPreview";
import {
  SystemComposerStructureEditor,
  SystemLayoutGallery,
  type SystemComposerTargetSlot,
} from "./SystemComposerStructureEditor";
import { SystemComposerInspector } from "./SystemComposerInspector";
import { SystemComposerStylingPanel } from "./SystemComposerStylingPanel";
import {
  bindingKindForSystemComposerEndpoint,
  type SystemComposerPortEndpoint,
} from "./systemComposerInspectorModel";
import {
  addSystemComposerAsset,
  attachUnassignedSystemComposerAsset,
  commitSystemComposerDraft,
  createSystemComposerDraftHistory,
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
  previewLayoutChange(
    input: Omit<
      PreviewSystemBuilderLayoutChangeCommand,
      "actorId" | "workspaceId" | "systemId"
    > & { readonly workspaceId: string; readonly systemId: string },
  ): Promise<SystemBuilderResult<SystemBuilderLayoutChangePreview>>;
}

export function SystemBuilderWorkspace({
  workspaceId,
  client,
  initialSystemId,
  onBuildAndTest,
}: {
  readonly workspaceId: string;
  readonly client: SystemBuilderClient;
  readonly initialSystemId?: string;
  readonly onBuildAndTest?: (systemId: string) => void;
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
  const [compatibleAssets, setCompatibleAssets] = useState<
    readonly SystemBuilderComposerAsset[]
  >([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string>();
  const [selectedLayoutDefinitionId, setSelectedLayoutDefinitionId] =
    useState<string>();
  const [selectedSystemId, setSelectedSystemId] = useState<string>();
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
  const [targetSlot, setTargetSlot] = useState<SystemComposerTargetSlot>();
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>();
  const [composerMode, setComposerMode] = useState<"design" | "connections">(
    "design",
  );
  const [name, setName] = useState("");
  const [revisions, setRevisions] = useState<readonly SystemBuilderRevision[]>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const selectedSystem = systems.find(
    (system) => String(system.systemId) === selectedSystemId,
  );
  const selectedInstance = instances.find(
    (instance) => String(instance.instanceId) === selectedInstanceId,
  );
  const selectedDefinition = composerCatalog.find(
    (definition) =>
      definition.definitionId === String(selectedInstance?.definitionRef.id) &&
      definition.version === selectedInstance?.definitionRef.version,
  );
  const stylingRootInstanceId = String(
    revision?.composition.rootInstanceRefs[0]?.id ?? "",
  );
  const stylingRootInstance = instances.find(
    (instance) => String(instance.instanceId) === stylingRootInstanceId,
  );
  const stylingRootDefinition = composerCatalog.find(
    (definition) =>
      definition.definitionId ===
        String(stylingRootInstance?.definitionRef.id) &&
      definition.version === stylingRootInstance?.definitionRef.version,
  );
  const draft = useMemo<SystemComposerDraft>(
    () => ({ instances, placements, bindings, structure }),
    [bindings, instances, placements, structure],
  );
  const layoutOptions = useMemo(
    () =>
      composerCatalog.filter(
        (asset) => asset.layoutRole === "application-shell",
      ),
    [composerCatalog],
  );
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
    let active = true;
    setError(undefined);
    setRevision(undefined);
    setStructure(undefined);
    setSelectedSystemId(undefined);
    setDirty(false);
    setCatalogLoading(true);
    setCatalogError(undefined);
    void Promise.all([
      client.list({ workspaceId, includeArchived: true }),
      loadComposerCatalog(client, workspaceId),
      client.listTemplates(),
    ]).then(([systemResult, catalogResult, templateResult]) => {
      if (!active) return;
      if (systemResult.ok) {
        setSystems(systemResult.value);
        setSelectedSystemId(
          String(
            systemResult.value.find((item) => item.status !== "archived")
              ?.systemId ??
              systemResult.value[0]?.systemId ??
              "",
          ) || undefined,
        );
      } else setError(systemResult.error.message);
      if (catalogResult.ok) {
        setComposerCatalog(catalogResult.value.items);
        setSelectedLayoutDefinitionId(
          (current) =>
            current ??
            defaultApplicationLayout(catalogResult.value.items)?.definitionId,
        );
      } else setCatalogError(catalogResult.error.message);
      setCatalogLoading(false);
      if (templateResult.ok) {
        setTemplates(templateResult.value);
        setSelectedTemplateId(
          (current) => current || templateResult.value[0]?.templateId || "",
        );
      } else setError(templateResult.error.message);
    });
    return () => {
      active = false;
    };
  }, [client, workspaceId]);

  useEffect(() => {
    if (!initialSystemId) return;
    const requestedSystem = systems.find(
      (item) =>
        String(item.systemId) === initialSystemId && item.status !== "archived",
    );
    if (requestedSystem) setSelectedSystemId(initialSystemId);
  }, [initialSystemId, systems]);

  useEffect(() => {
    if (!selectedSystemId) {
      setRevision(undefined);
      setInstances([]);
      setBindings([]);
      setPlacements([]);
      setStructure(undefined);
      setUndoDrafts([]);
      setRedoDrafts([]);
      setTargetSlot(undefined);
      return;
    }
    let active = true;
    void Promise.all([
      client.readRevision({ workspaceId, systemId: selectedSystemId }),
      client.listRevisions({ workspaceId, systemId: selectedSystemId }),
    ]).then(([revisionResult, historyResult]) => {
      if (!active) return;
      if (revisionResult.ok) {
        setRevision(revisionResult.value);
        setInstances(revisionResult.value.instances);
        setBindings(revisionResult.value.bindings);
        setPlacements(revisionResult.value.placements ?? []);
        setStructure(revisionResult.value.structure);
        setSelectedLayoutDefinitionId(
          revisionResult.value.structure?.layoutPresetRef
            ? String(revisionResult.value.structure.layoutPresetRef.id)
            : undefined,
        );
        setUndoDrafts([]);
        setRedoDrafts([]);
        setTargetSlot(undefined);
        setSelectedInstanceId(
          String(revisionResult.value.instances[0]?.instanceId ?? "") ||
            undefined,
        );
        setDirty(false);
      } else setError(revisionResult.error.message);
      if (historyResult.ok) setRevisions(historyResult.value);
    });
    return () => {
      active = false;
    };
  }, [client, selectedSystemId, workspaceId]);

  useEffect(() => {
    if (
      !revision ||
      structure ||
      dirty ||
      busy ||
      !isLegacyUiReferenceSystem(revision)
    ) {
      return;
    }
    const layout = defaultApplicationLayout(layoutOptions);
    if (!layout) return;
    void selectLayout(layout);
  }, [busy, dirty, layoutOptions, revision, structure]);

  useEffect(() => {
    if (!revision || composerCatalog.length === 0) return;
    const targetParent = targetSlot
      ? instances.find(
          (instance) =>
            String(instance.instanceId) === targetSlot.parentInstanceId,
        )
      : undefined;
    const targetDefinition = targetParent
      ? composerCatalog.find(
          (asset) =>
            asset.definitionId === String(targetParent.definitionRef.id) &&
            asset.version === targetParent.definitionRef.version,
        )
      : undefined;
    const targetIsAvailable = Boolean(
      targetSlot &&
      targetDefinition?.slots.some(
        (candidate) => candidate.slotId === targetSlot.slotId,
      ),
    );
    if (targetIsAvailable) return;
    setTargetSlot(
      preferredSystemComposerTarget({
        instances,
        placements,
        catalog: composerCatalog,
        activeLayoutDefinitionId: structure?.layoutPresetRef
          ? String(structure.layoutPresetRef.id)
          : undefined,
        selectedInstanceId,
      }),
    );
  }, [
    composerCatalog,
    instances,
    placements,
    revision,
    selectedInstanceId,
    structure?.layoutPresetRef,
    targetSlot,
  ]);

  useEffect(() => {
    if (!targetSlot) {
      setCompatibleAssets([]);
      return;
    }
    const parent = instances.find(
      (instance) => String(instance.instanceId) === targetSlot.parentInstanceId,
    );
    if (!parent) return;
    let active = true;
    setCatalogLoading(true);
    setCatalogError(undefined);
    void listAllComposerAssets(client, {
      workspaceId,
      parentDefinitionRef: parent.definitionRef,
      slotId: targetSlot.slotId,
      compatibleOnly: true,
    }).then((result) => {
      if (!active) return;
      if (result.ok) setCompatibleAssets(result.value.items);
      else setCatalogError(result.error.message);
      setCatalogLoading(false);
    });
    return () => {
      active = false;
    };
  }, [client, instances, targetSlot, workspaceId]);
  async function createSystem() {
    if (!name.trim()) {
      setError("Enter a system name.");
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const layout = layoutOptions.find(
      (asset) => asset.definitionId === selectedLayoutDefinitionId,
    );
    if (!layout) {
      setError("Choose an application layout before creating the system.");
      setBusy(false);
      return;
    }
    const result = await client.create({
      workspaceId,
      name,
      profile: "interactive",
      layoutPresetRef: layout.definitionRef,
    });
    if (result.ok) {
      setSystems((current) => [result.value, ...current]);
      setSelectedSystemId(String(result.value.systemId));
      setName("");
      setDirty(false);
      setNotice(
        `${layout.displayName} system created. Drag assets into its canvas regions.`,
      );
    } else setError(result.error.message);
    setBusy(false);
  }

  async function createReferenceSystem() {
    const template = templates.find(
      (item) => item.templateId === selectedTemplateId,
    );
    if (!template) {
      setError("No supported reference-system template is available.");
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await client.createFromTemplate({
      workspaceId,
      templateId: template.templateId,
      ...(name.trim() ? { name: name.trim() } : {}),
    });
    if (result.ok) {
      setSystems((current) => [result.value, ...current]);
      setSelectedSystemId(String(result.value.systemId));
      setName("");
      setDirty(false);
      setNotice(
        `${template.displayName} created and validated from canonical assets.`,
      );
    } else setError(result.error.message);
    setBusy(false);
  }

  function applyDraftHistory(
    history: ReturnType<typeof createSystemComposerDraftHistory>,
    message?: string,
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
    setDirty(history.past.length > 0);
    setError(undefined);
    setNotice(message);
  }

  function commitDraft(next: SystemComposerDraft, message?: string) {
    applyDraftHistory(
      commitSystemComposerDraft(
        { past: undoDrafts, present: draft, future: redoDrafts },
        next,
      ),
      message,
    );
  }

  function undoDraft() {
    applyDraftHistory(
      undoSystemComposerDraft({
        past: undoDrafts,
        present: draft,
        future: redoDrafts,
      }),
      "Last composition change undone.",
    );
  }

  function redoDraft() {
    applyDraftHistory(
      redoSystemComposerDraft({
        past: undoDrafts,
        present: draft,
        future: redoDrafts,
      }),
      "Composition change restored.",
    );
  }

  function addAsset(
    asset: SystemBuilderComposerAsset,
    target: SystemComposerTargetSlot,
  ) {
    if (!revision) return;
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
    commitDraft(
      result.value,
      "Asset added locally. Save the revision to validate and persist it.",
    );
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
    commitDraft(result.value, "Selected asset subtree removed locally.");
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
    commitDraft(
      result.value,
      "Asset moved to the selected canvas region locally.",
    );
    setSelectedInstanceId(instanceId);
  }
  function discardDraft() {
    if (!revision) return;
    setInstances(revision.instances);
    setBindings(revision.bindings);
    setPlacements(revision.placements ?? []);
    setStructure(revision.structure);
    setSelectedLayoutDefinitionId(
      revision.structure?.layoutPresetRef
        ? String(revision.structure.layoutPresetRef.id)
        : undefined,
    );
    setUndoDrafts([]);
    setRedoDrafts([]);
    setTargetSlot(undefined);
    setSelectedInstanceId(
      String(revision.instances[0]?.instanceId ?? "") || undefined,
    );
    setDirty(false);
    setError(undefined);
    setNotice("Unsaved changes discarded.");
  }

  function removeBinding(bindingId: string) {
    commitDraft(
      {
        ...draft,
        bindings: draft.bindings.filter(
          (binding) => String(binding.bindingId) !== bindingId,
        ),
      },
      "Connection removed locally.",
    );
  }
  function updateSelectedConfiguration(values: AssetConfigurationValues) {
    if (!selectedInstanceId) return;
    updateInstanceConfiguration(
      selectedInstanceId,
      values,
      "Configuration updated locally. Save the revision to persist it.",
    );
  }

  function updateRootStyling(values: AssetConfigurationValues) {
    if (!stylingRootInstanceId) return;
    updateInstanceConfiguration(
      stylingRootInstanceId,
      values,
      "System styling updated locally. Save the revision to persist it.",
    );
  }

  function updateInstanceConfiguration(
    instanceId: string,
    values: AssetConfigurationValues,
    message: string,
  ) {
    commitDraft(
      {
        ...draft,
        instances: draft.instances.map((item) =>
          String(item.instanceId) === instanceId
            ? { ...item, selectedConfiguration: values }
            : item,
        ),
      },
      message,
    );
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
    commitDraft(
      { ...draft, bindings: [...draft.bindings, binding] },
      "Typed connection added locally.",
    );
    setError(undefined);
  }

  async function selectLayout(layout: SystemBuilderComposerAsset) {
    if (!selectedSystem || !revision) {
      setSelectedLayoutDefinitionId(layout.definitionId);
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
    setBusy(true);
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
    if (result.ok) {
      const unassignedIds = new Set(
        result.value.unassignedInstanceRefs.map((reference) =>
          String(reference.id),
        ),
      );
      const unplaced = result.value.instances.filter((instance) =>
        unassignedIds.has(String(instance.instanceId)),
      );
      const unassignedVisualCount = unplaced.filter((instance) =>
        isSystemComposerVisualInstance(instance, composerCatalog),
      ).length;
      const systemResourceCount = unplaced.length - unassignedVisualCount;
      commitDraft(
        {
          instances: result.value.instances,
          placements: result.value.placements,
          bindings: result.value.bindings,
          structure: result.value.structure,
        },
        layoutSelectionNotice(
          layout.displayName,
          unassignedVisualCount,
          systemResourceCount,
        ),
      );
      setSelectedLayoutDefinitionId(layout.definitionId);
    } else setError(result.error.message);
    setBusy(false);
  }

  async function save() {
    if (!revision || !selectedSystem) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const instanceRefs = instances.map(
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
      instances,
      bindings,
      structure,
      placements,
    });
    if (result.ok) {
      setRevision(result.value);
      setInstances(result.value.instances);
      setBindings(result.value.bindings);
      setPlacements(result.value.placements ?? []);
      setStructure(result.value.structure);
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
    setBusy(false);
  }

  async function changeArchiveState() {
    if (!selectedSystem) return;
    setBusy(true);
    setError(undefined);
    const input = {
      workspaceId,
      systemId: String(selectedSystem.systemId),
      expectedRevision: selectedSystem.revision,
    };
    const result =
      selectedSystem.status === "archived"
        ? await client.restore(input)
        : await client.archive(input);
    if (result.ok) {
      setSystems((current) =>
        current.map((item) =>
          String(item.systemId) === selectedSystemId ? result.value : item,
        ),
      );
      setNotice(
        result.value.status === "archived"
          ? "System archived."
          : "System restored.",
      );
    } else setError(result.error.message);
    setBusy(false);
  }

  async function cloneSystem() {
    if (!selectedSystem) return;
    const cloneName = `${selectedSystem.name} copy`;
    setBusy(true);
    setError(undefined);
    const result = await client.clone({
      workspaceId,
      sourceSystemId: String(selectedSystem.systemId),
      name: cloneName,
    });
    if (result.ok) {
      setSystems((current) => [result.value, ...current]);
      setSelectedSystemId(String(result.value.systemId));
      setDirty(false);
      setNotice(`Created ${cloneName}.`);
    } else setError(result.error.message);
    setBusy(false);
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
          {error ? (
            <p className="ui-status ui-status--error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="ui-status ui-status--success" role="status">
              {notice}
            </p>
          ) : null}
          <div className="system-builder__toolbar">
            <label>
              System
              <select
                value={selectedSystemId ?? ""}
                onChange={(event) => {
                  if (dirty) {
                    setError(
                      "Save or discard unsaved changes before switching systems.",
                    );
                    return;
                  }
                  setSelectedSystemId(event.currentTarget.value || undefined);
                }}
              >
                <option value="">Choose a system</option>
                {systems.map((system) => (
                  <option
                    key={String(system.systemId)}
                    value={String(system.systemId)}
                  >
                    {system.name}
                    {system.status === "archived" ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              New system name
              <input
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                placeholder="Customer portal"
              />
            </label>
            <button
              type="button"
              onClick={() => void createSystem()}
              disabled={busy || !selectedLayoutDefinitionId}
            >
              <ApplicationIcon name="add" />
              <span>Create system</span>
            </button>
            {selectedSystem ? (
              <>
                <button
                  type="button"
                  className="ui-button--secondary"
                  onClick={() => void cloneSystem()}
                  disabled={busy || dirty}
                >
                  <ApplicationIcon name="copy" />
                  <span>Clone</span>
                </button>
                <button
                  type="button"
                  className="ui-button--secondary"
                  onClick={() => void changeArchiveState()}
                  disabled={busy || dirty}
                >
                  <ApplicationIcon
                    name={
                      selectedSystem.status === "archived"
                        ? "refresh"
                        : "archive"
                    }
                  />
                  <span>
                    {selectedSystem.status === "archived"
                      ? "Restore"
                      : "Archive"}
                  </span>
                </button>
              </>
            ) : null}
            <label>
              Reference template
              <select
                aria-label="Reference template"
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
                  <option key={template.templateId} value={template.templateId}>
                    {template.displayName}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="ui-button--secondary"
              onClick={() => void createReferenceSystem()}
              disabled={busy || !selectedTemplateId}
            >
              <ApplicationIcon name="systems" />
              <span>Create reference system</span>
            </button>
            <button
              type="button"
              className="ui-button--secondary"
              onClick={() => setPreviewOpen(true)}
              disabled={
                busy || !selectedSystem || !revision || instances.length === 0
              }
              aria-haspopup="dialog"
            >
              <ApplicationIcon name="play" />
              <span>Preview UI</span>
            </button>
            {onBuildAndTest && selectedSystem ? (
              <button
                type="button"
                className="ui-button--secondary"
                onClick={() => onBuildAndTest(String(selectedSystem.systemId))}
                disabled={busy || dirty || selectedSystem.status === "archived"}
              >
                <ApplicationIcon name="systems" />
                <span>Build &amp; test</span>
              </button>
            ) : null}
          </div>
          {layoutOptions.length && (!selectedSystem || !revision) ? (
            <SystemLayoutGallery
              layouts={layoutOptions}
              selectedDefinitionId={selectedLayoutDefinitionId}
              disabled={busy}
              mode={selectedSystem && revision ? "change" : "create"}
              onSelect={(layout) => void selectLayout(layout)}
            />
          ) : catalogLoading ? (
            <p className="ui-text-muted" role="status">
              Loading application layouts...
            </p>
          ) : null}
          {!selectedSystem || !revision ? (
            <EmptyState
              title="Create or choose a system"
              description="Systems keep configuration and connections in immutable workspace-scoped revisions."
              icon="systems"
            />
          ) : (
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
              {composerMode === "design" ? (
                <SystemComposerStructureEditor
                  draft={draft}
                  rootInstanceRefs={revision.composition.rootInstanceRefs}
                  catalog={composerCatalog}
                  compatibleAssets={compatibleAssets}
                  layoutOptions={layoutOptions}
                  selectedLayoutDefinitionId={selectedLayoutDefinitionId}
                  layoutSelectionDisabled={busy}
                  selectedInstanceId={selectedInstanceId}
                  targetSlot={targetSlot}
                  protectedInstanceIds={protectedInstanceIds}
                  propertiesPanel={
                    <SystemComposerInspector
                      mode="configuration"
                      selectedInstance={selectedInstance}
                      selectedDefinition={selectedDefinition}
                      instances={instances}
                      catalog={composerCatalog}
                      bindings={bindings}
                      onConfigurationChange={updateSelectedConfiguration}
                      onAddConnection={connectDeclaredPorts}
                      onRemoveConnection={removeBinding}
                    />
                  }
                  stylingPanel={
                    <SystemComposerStylingPanel
                      rootInstance={stylingRootInstance}
                      rootDefinition={stylingRootDefinition}
                      catalog={composerCatalog}
                      onChange={updateRootStyling}
                    />
                  }
                  catalogLoading={catalogLoading}
                  catalogError={catalogError}
                  canUndo={undoDrafts.length > 0}
                  canRedo={redoDrafts.length > 0}
                  onSelect={setSelectedInstanceId}
                  onTargetSlotChange={setTargetSlot}
                  onSelectLayout={(layout) => void selectLayout(layout)}
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
                  onConfigurationChange={updateSelectedConfiguration}
                  onAddConnection={connectDeclaredPorts}
                  onRemoveConnection={removeBinding}
                />
              )}
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
                      className="ui-button--secondary"
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
                      busy || !dirty || selectedSystem.status === "archived"
                    }
                  >
                    <ApplicationIcon name="save" />
                    <span>Save and validate revision</span>
                  </button>
                </div>
              </footer>
            </>
          )}
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
            includesUnsavedChanges={dirty}
          />
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

function layoutSelectionNotice(
  layoutName: string,
  unassignedVisualCount: number,
  systemResourceCount: number,
): string {
  const prefix = `${layoutName} selected. The Canvas updated automatically.`;
  const details: string[] = [];
  if (unassignedVisualCount) {
    details.push(
      `${unassignedVisualCount} visual asset${unassignedVisualCount === 1 ? " is" : "s are"} available under Unassigned visual assets`,
    );
  }
  if (systemResourceCount) {
    details.push(
      `${systemResourceCount} nonvisual asset${systemResourceCount === 1 ? " remains" : "s remain"} under System resources & logic`,
    );
  }
  return details.length ? `${prefix} ${details.join("; ")}.` : prefix;
}

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

async function loadComposerCatalog(
  client: Pick<SystemBuilderClient, "listComposerAssets">,
  workspaceId: string,
): Promise<SystemBuilderResult<SystemBuilderComposerCatalog>> {
  const [catalog, applicationLayouts] = await Promise.all([
    listAllComposerAssets(client, { workspaceId }),
    listAllComposerAssets(client, {
      workspaceId,
      searchText: APPLICATION_LAYOUT_CATALOG_QUERY,
    }),
  ]);
  if (!catalog.ok) return catalog;
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
    if (!nextCursor) {
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
