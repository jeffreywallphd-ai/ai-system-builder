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
} from "../../../contracts/system-builder";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { EmptyState } from "../components/EmptyState";
import { ModalDialog } from "../components/ModalDialog";
import { SystemCompositionPreview } from "./SystemCompositionPreview";
import {
  SystemComposerStructureEditor,
  SystemLayoutGallery,
  type SystemComposerWrapCompatibility,
  type SystemComposerTargetSlot,
} from "./SystemComposerStructureEditor";
import {
  SystemComposerInspector,
  type SystemComposerInspectorMode,
} from "./SystemComposerInspector";
import {
  bindingKindForSystemComposerEndpoint,
  type SystemComposerPortEndpoint,
} from "./systemComposerInspectorModel";
import {
  addSystemComposerAsset,
  commitSystemComposerDraft,
  createSystemComposerDraftHistory,
  deriveProtectedSystemInstanceIds,
  moveSystemComposerPlacement,
  redoSystemComposerDraft,
  removeSystemComposerSubtree,
  reparentSystemComposerAsset,
  undoSystemComposerDraft,
  wrapSystemComposerAsset,
  type SystemComposerDraft,
} from "./systemComposerDraft";

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
}

export function SystemBuilderWorkspace({
  workspaceId,
  client,
  initialSystemId,
}: {
  readonly workspaceId: string;
  readonly client: SystemBuilderClient;
  readonly initialSystemId?: string;
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
  const [undoDrafts, setUndoDrafts] = useState<readonly SystemComposerDraft[]>(
    [],
  );
  const [redoDrafts, setRedoDrafts] = useState<readonly SystemComposerDraft[]>(
    [],
  );
  const [targetSlot, setTargetSlot] = useState<SystemComposerTargetSlot>();
  const [wrapTarget, setWrapTarget] = useState<{
    readonly wrapper: SystemBuilderComposerAsset;
    readonly slotId: string;
  }>();
  const [wrapCompatibility, setWrapCompatibility] =
    useState<SystemComposerWrapCompatibility>({ status: "idle" });
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>();
  const [composerMode, setComposerMode] = useState<
    "structure" | SystemComposerInspectorMode
  >("structure");
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
  const draft = useMemo<SystemComposerDraft>(
    () => ({ instances, placements, bindings }),
    [bindings, instances, placements],
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
    setSelectedSystemId(undefined);
    setDirty(false);
    setCatalogLoading(true);
    setCatalogError(undefined);
    void Promise.all([
      client.list({ workspaceId, includeArchived: true }),
      client.listComposerAssets({ workspaceId, limit: 200 }),
      client.listTemplates(),
    ]).then(([systemResult, catalogResult, templateResult]) => {
      if (!active) return;
      if (systemResult.ok) {
        setSystems(systemResult.value);
        const requestedSystem = initialSystemId
          ? systemResult.value.find(
              (item) =>
                String(item.systemId) === initialSystemId &&
                item.status !== "archived",
            )
          : undefined;
        setSelectedSystemId(
          String(
            requestedSystem?.systemId ??
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
            catalogResult.value.items.find(
              (asset) => asset.layoutRole === "application-shell",
            )?.definitionId,
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
  }, [client, initialSystemId, workspaceId]);

  useEffect(() => {
    if (!selectedSystemId) {
      setRevision(undefined);
      setInstances([]);
      setBindings([]);
      setPlacements([]);
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
    if (!revision || composerCatalog.length === 0) return;
    const targetIsAvailable = targetSlot
      ? instances.some(
          (instance) =>
            String(instance.instanceId) === targetSlot.parentInstanceId,
        )
      : false;
    if (targetIsAvailable) return;
    const preferred =
      selectedInstance ??
      instances.find((instance) =>
        revision.composition.rootInstanceRefs.some(
          (reference) => String(reference.id) === String(instance.instanceId),
        ),
      );
    const definition = composerCatalog.find(
      (asset) =>
        asset.definitionId === String(preferred?.definitionRef.id) &&
        asset.version === preferred?.definitionRef.version,
    );
    const slot = definition?.slots[0];
    if (preferred && slot) {
      setTargetSlot({
        parentInstanceId: String(preferred.instanceId),
        slotId: slot.slotId,
      });
    }
  }, [composerCatalog, instances, revision, selectedInstance, targetSlot]);

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
    void client
      .listComposerAssets({
        workspaceId,
        parentDefinitionRef: parent.definitionRef,
        slotId: targetSlot.slotId,
        limit: 200,
      })
      .then((result) => {
        if (!active) return;
        if (result.ok) setCompatibleAssets(result.value.items);
        else setCatalogError(result.error.message);
        setCatalogLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, instances, targetSlot, workspaceId]);
  useEffect(() => {
    if (!wrapTarget || !selectedInstance) {
      setWrapCompatibility({ status: "idle" });
      return;
    }
    let active = true;
    setWrapCompatibility({ status: "checking" });
    void client
      .listComposerAssets({
        workspaceId,
        parentDefinitionRef: wrapTarget.wrapper.definitionRef,
        slotId: wrapTarget.slotId,
        searchText: String(selectedInstance.definitionRef.id),
        compatibleOnly: false,
        limit: 200,
      })
      .then(
        (result) => {
          if (!active) return;
          if (!result.ok) {
            setWrapCompatibility({
              status: "incompatible",
              reason: result.error.message,
            });
            return;
          }
          const candidate = result.value.items.find(
            (item) =>
              item.definitionId === String(selectedInstance.definitionRef.id) &&
              item.version === selectedInstance.definitionRef.version,
          );
          setWrapCompatibility(
            candidate?.compatibility.status === "compatible"
              ? { status: "compatible" }
              : {
                  status: "incompatible",
                  reason:
                    candidate?.compatibility.reason ??
                    "The selected asset is not accepted by this wrapper slot.",
                },
          );
        },
        () => {
          if (active) {
            setWrapCompatibility({
              status: "incompatible",
              reason: "Unable to verify wrapper compatibility.",
            });
          }
        },
      );
    return () => {
      active = false;
    };
  }, [client, selectedInstance, workspaceId, wrapTarget]);

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
        `${layout.displayName} system created. Choose a slot to add content.`,
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

  function moveSelected(offset: -1 | 1) {
    if (!selectedInstanceId) return;
    const result = moveSystemComposerPlacement(
      draft,
      selectedInstanceId,
      offset,
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }
    commitDraft(result.value, "Asset order updated locally.");
  }

  function reparentSelected(target: SystemComposerTargetSlot) {
    if (!selectedInstanceId) return;
    const result = reparentSystemComposerAsset(draft, {
      instanceId: selectedInstanceId,
      ...target,
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    commitDraft(result.value, "Asset moved to the selected slot locally.");
  }

  function selectWrapTarget(
    wrapper: SystemBuilderComposerAsset | undefined,
    slotId: string | undefined,
  ) {
    if (!wrapper || !slotId) {
      setWrapTarget(undefined);
      setWrapCompatibility({ status: "idle" });
      return;
    }
    setWrapTarget({ wrapper, slotId });
  }

  function wrapSelected(
    wrapper: SystemBuilderComposerAsset,
    wrapperSlotId: string,
  ) {
    if (!selectedInstanceId || !revision) return;
    const wrapperInstanceId = `instance.${safeId(wrapper.definitionId)}.${uniqueId()}`;
    const result = wrapSystemComposerAsset(draft, {
      instanceId: selectedInstanceId,
      wrapper,
      wrapperInstanceId,
      wrapperSlotId,
      compositionId: String(revision.composition.compositionId),
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    commitDraft(result.value, "Selected asset wrapped in a container locally.");
    setSelectedInstanceId(wrapperInstanceId);
    setTargetSlot({
      parentInstanceId: wrapperInstanceId,
      slotId: wrapperSlotId,
    });
    setWrapTarget(undefined);
    setWrapCompatibility({ status: "idle" });
  }

  function discardDraft() {
    if (!revision) return;
    setInstances(revision.instances);
    setBindings(revision.bindings);
    setPlacements(revision.placements ?? []);
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
    commitDraft(
      {
        ...draft,
        instances: draft.instances.map((item) =>
          String(item.instanceId) === selectedInstanceId
            ? { ...item, selectedConfiguration: values }
            : item,
        ),
      },
      "Configuration updated locally. Save the revision to persist it.",
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
      structure: revision.structure,
      placements,
    });
    if (result.ok) {
      setRevision(result.value);
      setInstances(result.value.instances);
      setBindings(result.value.bindings);
      setPlacements(result.value.placements ?? []);
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
          </div>
          {layoutOptions.length ? (
            <SystemLayoutGallery
              layouts={layoutOptions}
              selectedDefinitionId={selectedLayoutDefinitionId}
              disabled={busy}
              onSelect={(layout) =>
                setSelectedLayoutDefinitionId(layout.definitionId)
              }
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
                {(["structure", "configuration", "connections"] as const).map(
                  (mode) => (
                    <button
                      key={mode}
                      type="button"
                      role="tab"
                      aria-selected={composerMode === mode}
                      className="ui-button--secondary"
                      onClick={() => setComposerMode(mode)}
                    >
                      {mode === "structure"
                        ? "Structure"
                        : mode === "configuration"
                          ? "Configure"
                          : "Connections"}
                    </button>
                  ),
                )}
              </div>
              {composerMode === "structure" ? (
                <SystemComposerStructureEditor
                  draft={draft}
                  rootInstanceRefs={revision.composition.rootInstanceRefs}
                  catalog={composerCatalog}
                  compatibleAssets={compatibleAssets}
                  selectedInstanceId={selectedInstanceId}
                  targetSlot={targetSlot}
                  protectedInstanceIds={protectedInstanceIds}
                  catalogLoading={catalogLoading}
                  catalogError={catalogError}
                  wrapCompatibility={wrapCompatibility}
                  onWrapTargetChange={selectWrapTarget}
                  canUndo={undoDrafts.length > 0}
                  canRedo={redoDrafts.length > 0}
                  onSelect={setSelectedInstanceId}
                  onTargetSlotChange={setTargetSlot}
                  onAdd={addAsset}
                  onMove={moveSelected}
                  onReparent={reparentSelected}
                  onWrap={wrapSelected}
                  onRemove={removeSelected}
                  onUndo={undoDraft}
                  onRedo={redoDraft}
                />
              ) : (
                <SystemComposerInspector
                  mode={composerMode}
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

const safeId = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 48);
const uniqueId = () =>
  (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  ).replace(/-/g, "");
