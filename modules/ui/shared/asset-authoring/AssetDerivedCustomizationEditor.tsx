import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";

import type { AssetReference } from "../../../contracts/asset";
import type {
  AssetCustomizationSourceFileChange,
  AssetDerivedCustomizationDraftRecord,
  AssetDerivedCustomizationSemanticPatch,
  AssetDerivedCustomizationTargetDetail,
  AssetDerivedCustomizationTargetSummary,
} from "../../../contracts/asset-authoring";
import { normalizeAssetDerivedCustomizationDraftRecord, normalizeExactAssetDefinitionReference } from "../../../contracts/asset-authoring";
import type { AssetImplementationBackingResourceRole } from "../../../contracts/asset-implementation";
import { normalizeAssetImplementationBackingResourceBundle, normalizeAssetImplementationReleaseId } from "../../../contracts/asset-implementation";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { EmptyState } from "../components/EmptyState";
import { ModalDialog } from "../components/ModalDialog";
import { WorkflowSequence, WorkflowStep } from "../components/WorkflowSequence";
import { TransientNotificationPublisher } from "../notifications/TransientNotificationPublisher";
import {
  buildAssetCustomizationSubmission,
  buildAssetCustomizationSourceUpdate,
  createAssetCustomizationEditorValues,
  createAssetCustomizationResourceDrafts,
  resourceRoleLabel,
  type AssetCustomizationEditorValues,
  type AssetCustomizationResourceDraft,
} from "./assetDerivedCustomizationEditorModel";

type Result<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
    };

export interface AssetDerivedCustomizationClient {
  listCustomizationTargets(input: {
    workspaceId: string;
    text?: string;
    sourceKind?: string;
    eligibility?: string;
  }): Promise<
    Result<{
      items: readonly AssetDerivedCustomizationTargetSummary[];
      nextCursor?: string;
    }>
  >;
  readCustomizationTarget(input: {
    workspaceId: string;
    definitionRef: AssetReference;
    implementationReleaseId: string;
  }): Promise<Result<AssetDerivedCustomizationTargetDetail>>;
  listDerivedCustomizations(input: {
    workspaceId: string;
    status?: string;
    text?: string;
  }): Promise<
    Result<{
      items: readonly AssetDerivedCustomizationDraftRecord[];
      nextCursor?: string;
    }>
  >;
  createDerivedCustomization(input: {
    workspaceId: string;
    baseDefinitionRef: AssetReference;
    baseImplementationReleaseId: string;
    derivedDefinitionRef: AssetReference;
    semanticPatch: AssetDerivedCustomizationSemanticPatch;
    sourceChanges?: readonly AssetCustomizationSourceFileChange[];
  }): Promise<Result<AssetDerivedCustomizationDraftRecord>>;
  updateDerivedCustomization(input: {
    workspaceId: string;
    customizationId: string;
    expectedRevision: number;
    semanticPatch: AssetDerivedCustomizationSemanticPatch;
    sourceChanges?: readonly AssetCustomizationSourceFileChange[];
    clearSourceOverlay?: boolean;
  }): Promise<Result<AssetDerivedCustomizationDraftRecord>>;
  reviewDerivedCustomization(input: {
    workspaceId: string;
    customizationId: string;
    expectedRevision: number;
  }): Promise<Result<AssetDerivedCustomizationDraftRecord>>;
  publishDerivedCustomization(input: {
    workspaceId: string;
    customizationId: string;
    expectedRevision: number;
  }): Promise<Result<AssetDerivedCustomizationDraftRecord>>;
  abandonDerivedCustomization(input: {
    workspaceId: string;
    customizationId: string;
    expectedRevision: number;
  }): Promise<Result<AssetDerivedCustomizationDraftRecord>>;
}

export interface AssetCustomizationTargetSelection {
  readonly definitionId: string;
  readonly version: string;
}

export interface AssetDerivedCustomizationEditorProps {
  readonly workspaceId: string;
  readonly client: AssetDerivedCustomizationClient;
  readonly initialTarget?: AssetCustomizationTargetSelection;
}

const RESOURCE_ROLES: readonly AssetImplementationBackingResourceRole[] = [
  "frontend-structure",
  "frontend-style",
  "backend-logic",
  "other",
];

const HISTORY_STATUSES = [
  "draft",
  "ready-for-review",
  "reviewed",
  "published",
  "abandoned",
  "conflicted",
  "invalid",
] as const;

function exactReference(value: AssetReference) {
  const reference = normalizeExactAssetDefinitionReference(value);
  if (reference.id !== value.id || reference.version !== value.version) throw new Error("Invalid exact reference.");
  return reference;
}

function targetBackingResources(values: AssetDerivedCustomizationTargetDetail["backingResources"]) {
  if (!Array.isArray(values)) throw new Error("Invalid backing resource list.");
  // Preserve the existing empty-view behavior. Present files must satisfy the
  // established path, role, content, per-file, count and aggregate limits.
  const files = values.length ? normalizeAssetImplementationBackingResourceBundle({ formatVersion: "1.0", files: values }).files : [];
  return files.map((file, index) => {
    const view = values[index];
    if (typeof view.editable !== "boolean" || !Number.isSafeInteger(view.sizeCharacters) || view.sizeCharacters < 0) throw new Error("Invalid backing resource descriptor.");
    return { ...file, editable: view.editable, sizeCharacters: view.sizeCharacters };
  });
}

export function AssetDerivedCustomizationEditor(props: AssetDerivedCustomizationEditorProps) {
  const [scope, setScope] = useState({ workspaceId: props.workspaceId, client: props.client, key: 0 });
  if (scope.workspaceId !== props.workspaceId || scope.client !== props.client) {
    setScope({ workspaceId: props.workspaceId, client: props.client, key: scope.key + 1 });
    return null;
  }
  return <ScopedAssetDerivedCustomizationEditor key={scope.key} {...props} />;
}

function ScopedAssetDerivedCustomizationEditor({
  workspaceId,
  client,
  initialTarget,
}: AssetDerivedCustomizationEditorProps) {
  const [search, setSearch] = useState("");
  const [targets, setTargets] = useState<
    readonly AssetDerivedCustomizationTargetSummary[]
  >([]);
  const [target, setTarget] = useState<AssetDerivedCustomizationTargetDetail>();
  const [values, setValues] = useState<AssetCustomizationEditorValues>();
  const [resources, setResources] = useState<
    readonly AssetCustomizationResourceDraft[]
  >([]);
  const [current, setCurrent] =
    useState<AssetDerivedCustomizationDraftRecord>();
  const [history, setHistory] = useState<
    readonly AssetDerivedCustomizationDraftRecord[]
  >([]);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const [pendingTarget, setPendingTarget] =
    useState<AssetDerivedCustomizationTargetSummary>();
  const [pendingAbandon, setPendingAbandon] =
    useState<AssetDerivedCustomizationDraftRecord>();
  const [busy, setBusy] = useState(false);
  const [loadingTargets, setLoadingTargets] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [editingLocked, setEditingLocked] = useState(false);
  const editGeneration = useRef(0);
  const dirtyRef = useRef(false);
  const editLockOwner = useRef<number | undefined>(undefined);
  function markEdited() {
    editGeneration.current++;
    dirtyRef.current = true;
    setDirty(true);
    setNotice(undefined);
  }
  const contextualNotice = Boolean(notice?.includes("ready to customize"));
  const [newPath, setNewPath] = useState("");
  const [newRole, setNewRole] =
    useState<AssetImplementationBackingResourceRole>("other");
  const [newMediaType, setNewMediaType] = useState("text/typescript");
  const [newContent, setNewContent] = useState("");
  const readOwner = useRef({workspaceId, client});
  const mounted = useRef(true);
  const readGeneration = useRef({targets: 0, history: 0, selection: 0, mutation: 0});
  const selectedOwner = useRef<typeof readOwner.current | undefined>(undefined);
  const mutationActive = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const kind of ["targets", "history", "selection", "mutation"] as const) readGeneration.current[kind]++;
      mutationActive.current = undefined;
      editLockOwner.current = undefined;
    };
  }, []);
  function currentRead(kind: keyof typeof readGeneration.current, generation: number, owner: typeof readOwner.current) {
    return mounted.current && readGeneration.current[kind] === generation && readOwner.current.workspaceId === owner.workspaceId && readOwner.current.client === owner.client;
  }

  async function loadTargets(text = search, preferred?: AssetCustomizationTargetSelection) {
    if (!mounted.current) return;
    const owner = readOwner.current, generation = ++readGeneration.current.targets;
    setLoadingTargets(true);
    setError(undefined);
    try {
      const result = await client.listCustomizationTargets({
        workspaceId,
        text: text.trim() || undefined,
        eligibility: "all",
      });
      if (!currentRead("targets", generation, owner)) return;
      if (!result.ok) {
        setTargets([]);
        setError(result.error.message);
        setLoadingTargets(false);
        return;
      }
      if (!Array.isArray(result.value.items) || result.value.items.some(item => {
        exactReference(item.definitionRef);
        if (item.implementationReleaseId !== undefined && normalizeAssetImplementationReleaseId(item.implementationReleaseId) !== item.implementationReleaseId) return true;
        return item.workspaceId !== workspaceId || typeof item.displayName !== "string" || typeof item.description !== "string" ||
          typeof item.eligibility?.eligible !== "boolean" || typeof item.eligibility.message !== "string" ||
          !Number.isSafeInteger(item.resources?.total) || item.resources.total < 0;
      })) throw new Error("Invalid customization target list.");
      setTargets(result.value.items);
      setLoadingTargets(false);
      if (preferred) {
        const match = result.value.items.find(
          (item) =>
            String(item.definitionRef.id) === preferred.definitionId &&
            item.definitionRef.version === preferred.version,
        );
        if (match) requestTargetSelection(match);
        else
          setError(
            "This asset does not currently have an exact implementation and backing resources available for customization.",
          );
      }
    } catch {
      if (currentRead("targets", generation, owner)) {
        setTargets([]);
        setError("Customization targets are unavailable. Please retry the search.");
      }
    } finally {
      if (currentRead("targets", generation, owner)) setLoadingTargets(false);
    }
  }

  async function loadHistory(text = historySearch, status = historyStatus) {
    if (!mounted.current) return;
    const owner = readOwner.current, generation = ++readGeneration.current.history;
    try {
      const result = await client.listDerivedCustomizations({
        workspaceId,
        text: text.trim() || undefined,
        status: status || undefined,
      });
      if (!currentRead("history", generation, owner)) return;
      if (result.ok) {
        const items = result.value.items.map(item => normalizeAssetDerivedCustomizationDraftRecord(item));
        if (items.some(item => item.workspaceId !== workspaceId) || new Set(items.map(item => item.customizationId)).size !== items.length) throw new Error("Invalid customization history identity.");
        setHistory(items);
      }
      else setError(result.error.message);
    } catch {
      if (currentRead("history", generation, owner)) setError("Customization history is unavailable. Please retry.");
    }
  }

  useEffect(() => {
    const selectionOwnerChanged = selectedOwner.current?.workspaceId !== workspaceId || selectedOwner.current?.client !== client;
    if (!initialTarget || target?.workspaceId !== workspaceId || selectionOwnerChanged) {
      selectedOwner.current = undefined;
      setTarget(undefined);
      setValues(undefined);
      setResources([]);
      setCurrent(undefined);
      editGeneration.current++;
      dirtyRef.current = false;
      setDirty(false);
    }
    setPendingTarget(undefined);
    setPendingAbandon(undefined);
    mutationActive.current = undefined;
    editLockOwner.current = undefined;
    setEditingLocked(false);
    setBusy(false);
    setTargets([]);
    setHistory([]);
    setNotice(undefined);
    const preferred = initialTarget;
    const text = preferred?.definitionId ?? "";
    setSearch(text);
    void Promise.all([loadTargets(text, preferred), loadHistory("", "")]);
    return () => {
      readGeneration.current.targets++;
      readGeneration.current.history++;
      readGeneration.current.selection++;
      readGeneration.current.mutation++;
      mutationActive.current = undefined;
    };
  }, [workspaceId, client, initialTarget?.definitionId, initialTarget?.version]);

  async function selectTarget(summary: AssetDerivedCustomizationTargetSummary) {
    if (!mounted.current) return;
    if (!summary.implementationReleaseId || !summary.eligibility.eligible) {
      setError(summary.eligibility.message);
      return;
    }
    const owner = readOwner.current, generation = ++readGeneration.current.selection;
    const requestedId = String(summary.definitionRef.id), requestedVersion = summary.definitionRef.version, requestedRelease = String(summary.implementationReleaseId);
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await client.readCustomizationTarget({
        workspaceId,
        definitionRef: summary.definitionRef,
        implementationReleaseId: summary.implementationReleaseId,
      });
      if (!currentRead("selection", generation, owner)) return;
      if (!result.ok) setError(result.error.message);
      else {
        const reference = exactReference(result.value.definitionRef);
        if (result.value.workspaceId !== workspaceId || reference.id !== requestedId || reference.version !== requestedVersion || result.value.implementationReleaseId !== requestedRelease ||
            result.value.eligibility?.eligible !== true || typeof result.value.displayName !== "string" || typeof result.value.description !== "string" ||
            !Array.isArray(result.value.backingResources) || !Array.isArray(result.value.protectedFields) || result.value.protectedFields.some(field => typeof field !== "string")) throw new Error("Invalid customization target identity.");
        const accepted = structuredClone({ ...result.value, definitionRef: reference, backingResources: targetBackingResources(result.value.backingResources) });
        const nextValues = createAssetCustomizationEditorValues(accepted);
        const nextResources = createAssetCustomizationResourceDrafts(accepted);
        selectedOwner.current = owner;
        setTarget(accepted);
        setValues(nextValues);
        setResources(nextResources);
        setCurrent(undefined);
        markEdited();
        setNotice(
          `${accepted.displayName} is ready to customize. The base asset will remain unchanged.`,
        );
      }
    } catch {
      if (currentRead("selection", generation, owner)) setError("The customization target is unavailable. Please retry.");
    } finally {
      if (currentRead("selection", generation, owner)) setBusy(false);
    }
  }

  function requestTargetSelection(
    summary: AssetDerivedCustomizationTargetSummary,
  ) {
    const currentTarget =
      target?.workspaceId === workspaceId && selectedOwner.current?.workspaceId === workspaceId && selectedOwner.current?.client === client ? target : undefined;
    if (currentTarget && sameTarget(currentTarget, summary)) return;
    if (currentTarget) {
      setPendingTarget(summary);
      return;
    }
    void selectTarget(summary);
  }

  function updateValue<K extends keyof AssetCustomizationEditorValues>(
    key: K,
    value: AssetCustomizationEditorValues[K],
  ) {
    if (editLockOwner.current !== undefined || current?.status === "published" || current?.status === "abandoned") return;
    if ((key === "derivedDefinitionId" || key === "derivedDefinitionVersion") && (current || busy || mutationActive.current !== undefined)) return;
    markEdited();
    setValues((currentValues) =>
      currentValues ? { ...currentValues, [key]: value } : currentValues,
    );
  }

  function updateResource(
    path: string,
    patch: Partial<AssetCustomizationResourceDraft>,
  ) {
    if (editLockOwner.current !== undefined || current?.status === "published" || current?.status === "abandoned") return;
    markEdited();
    setResources((items) =>
      items.map((item) => (item.path === path ? { ...item, ...patch } : item)),
    );
  }

  function replaceHistory(record: AssetDerivedCustomizationDraftRecord) {
    setHistory((items) => [
      record,
      ...items.filter(
        (item) => item.customizationId !== record.customizationId,
      ),
    ]);
  }

  async function executeMutation(
    action: () => Promise<Result<AssetDerivedCustomizationDraftRecord>>,
    onSuccess: (record: AssetDerivedCustomizationDraftRecord) => void,
    unavailableMessage: string,
    lockEdits = false,
    expected?: { customizationId?: string; derivedId: string; derivedVersion?: string; baseId: string; baseVersion?: string; releaseId: string; snapshotId?: string; artifactDigest?: string; status: string; revision: number },
  ) {
    if (!mounted.current || busy || mutationActive.current !== undefined || readOwner.current.workspaceId !== workspaceId || readOwner.current.client !== client) return;
    const owner = {workspaceId, client}, generation = ++readGeneration.current.mutation;
    mutationActive.current = generation;
    if (lockEdits) { editLockOwner.current = generation; setEditingLocked(true); }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await action();
      if (!currentRead("mutation", generation, owner)) return;
      if (!result.ok) setError(result.error.message);
      else {
        const record = normalizeAssetDerivedCustomizationDraftRecord(result.value);
        if (!expected || record.workspaceId !== workspaceId ||
            expected.customizationId !== undefined && record.customizationId !== expected.customizationId ||
            record.derivedDefinitionRef.id !== expected.derivedId || record.derivedDefinitionRef.version !== expected.derivedVersion ||
            record.base.definitionRef.id !== expected.baseId || record.base.definitionRef.version !== expected.baseVersion || record.base.implementationReleaseId !== expected.releaseId ||
            expected.snapshotId !== undefined && record.base.sourceSnapshotId !== expected.snapshotId || expected.artifactDigest !== undefined && record.base.sourceArtifact.digest !== expected.artifactDigest ||
            record.status !== expected.status || record.revision !== expected.revision) throw new Error("Invalid customization acknowledgement.");
        // An earlier history read must not replace this confirmed revision.
        readGeneration.current.history++;
        onSuccess(record);
      }
    } catch {
      if (currentRead("mutation", generation, owner)) setError(unavailableMessage);
    } finally {
      if (currentRead("mutation", generation, owner)) {
        mutationActive.current = undefined;
        if (editLockOwner.current === generation) { editLockOwner.current = undefined; setEditingLocked(false); }
        setBusy(false);
      }
    }
  }

  async function save() {
    if (!target || !target.implementationReleaseId || !values || busy || mutationActive.current !== undefined || current?.status === "published" || current?.status === "abandoned") return;
    if (selectedOwner.current?.workspaceId !== workspaceId || selectedOwner.current?.client !== client) return;
    const capturedEditGeneration = editGeneration.current;
    let submission: ReturnType<typeof buildAssetCustomizationSubmission>;
    try {
      submission = buildAssetCustomizationSubmission(target, values, resources);
    } catch {
      setError("The customization could not be prepared. Check the identity and JSON fields.");
      return;
    }
    const input = {
      workspaceId,
      semanticPatch: submission.semanticPatch,
      ...buildAssetCustomizationSourceUpdate(Boolean(current?.sourceOverlay), submission.sourceChanges),
    };
    await executeMutation(
      () => current
        ? client.updateDerivedCustomization({...input, customizationId: current.customizationId, expectedRevision: current.revision})
        : client.createDerivedCustomization({...input, baseDefinitionRef: target.definitionRef, baseImplementationReleaseId: target.implementationReleaseId!, derivedDefinitionRef: submission.derivedDefinitionRef}),
      (record) => {
        setCurrent(record);
        replaceHistory(record);
        if (editGeneration.current === capturedEditGeneration) {
          dirtyRef.current = false;
          setDirty(false);
        }
        setNotice(editGeneration.current === capturedEditGeneration
          ? current ? "Customization changes saved." : "Derived customization draft created. The base asset is unchanged."
          : "Earlier changes saved. Save your newer changes before review or publication.");
      },
      "The customization could not be saved. Please retry.",
      false,
      { customizationId: current?.customizationId, derivedId: String(current?.derivedDefinitionRef.id ?? submission.derivedDefinitionRef.id), derivedVersion: current?.derivedDefinitionRef.version ?? submission.derivedDefinitionRef.version,
        baseId: String(target.definitionRef.id), baseVersion: target.definitionRef.version, releaseId: String(target.implementationReleaseId), snapshotId: current?.base.sourceSnapshotId ?? target.baseSourceSnapshotId,
        artifactDigest: current?.base.sourceArtifact.digest ?? target.baseSourceArtifact?.digest, status: "draft", revision: current ? current.revision + 1 : 1 },
    );
  }

  async function transition(operation: "review" | "publish") {
    if (!current || dirtyRef.current || current.status === "published" || current.status === "abandoned" || (operation === "publish" && current.status !== "reviewed")) return;
    if (selectedOwner.current?.workspaceId !== workspaceId || selectedOwner.current?.client !== client) return;
    const input = {workspaceId, customizationId: current.customizationId, expectedRevision: current.revision};
    await executeMutation(
      () => operation === "review" ? client.reviewDerivedCustomization(input) : client.publishDerivedCustomization(input),
      (record) => {
        setCurrent(record);
        replaceHistory(record);
        setNotice(operation === "review" ? "A complete immutable source snapshot was materialized for review." : "The customized definition and implementation draft were published as a distinct lineage.");
      },
      "The customization could not be reviewed or published. Please retry.",
      operation === "publish",
      { customizationId: current.customizationId, derivedId: String(current.derivedDefinitionRef.id), derivedVersion: current.derivedDefinitionRef.version, baseId: String(current.base.definitionRef.id), baseVersion: current.base.definitionRef.version,
        releaseId: String(current.base.implementationReleaseId), snapshotId: current.base.sourceSnapshotId, artifactDigest: current.base.sourceArtifact.digest, status: operation === "review" ? "reviewed" : "published", revision: current.revision + 1 },
    );
  }

  async function abandonCustomization(record: AssetDerivedCustomizationDraftRecord) {
    if (record.status === "published" || record.status === "abandoned") return;
    await executeMutation(
      () => client.abandonDerivedCustomization({workspaceId, customizationId: record.customizationId, expectedRevision: record.revision}),
      (result) => {
        replaceHistory(result);
        if (current?.customizationId === result.customizationId) setCurrent(result);
        setNotice("The customization was abandoned without changing the base asset.");
      },
      "The customization could not be abandoned. Please retry.",
      true,
      { customizationId: record.customizationId, derivedId: String(record.derivedDefinitionRef.id), derivedVersion: record.derivedDefinitionRef.version, baseId: String(record.base.definitionRef.id), baseVersion: record.base.definitionRef.version,
        releaseId: String(record.base.implementationReleaseId), snapshotId: record.base.sourceSnapshotId, artifactDigest: record.base.sourceArtifact.digest, status: "abandoned", revision: record.revision + 1 },
    );
  }

  function addResource() {
    if (editLockOwner.current !== undefined || current?.status === "published" || current?.status === "abandoned") return;
    const path = newPath.trim();
    if (!path || !newContent) {
      setError("A relative resource path and content are required.");
      return;
    }
    if (
      resources.some(
        (resource) => resource.path.toLowerCase() === path.toLowerCase(),
      )
    ) {
      setError("That resource path already exists.");
      return;
    }
    markEdited();
    setResources((items) => [
      ...items,
      {
        path,
        role: newRole,
        mediaType: newMediaType.trim() || "text/plain",
        content: newContent,
        editable: true,
        deleted: false,
      },
    ]);
    setNewPath("");
    setNewContent("");
    setNotice(undefined);
  }

  const editingClosed = current?.status === "published" || current?.status === "abandoned";
  const editingDisabled = editingClosed || editingLocked;
  const selectedLabel = target?.displayName ?? "No asset selected";

  return (
    <section
      className="ui-panel ui-panel--sectioned asset-customizer"
      aria-labelledby="asset-customizer-title"
    >
      <header className="ui-panel__section-header">
        <div className="ui-panel-heading ui-panel-heading--violet">
          <span className="ui-panel-heading__icon" aria-hidden="true">
            <ApplicationIcon name="assets" />
          </span>
          <div>
            <h2 id="asset-customizer-title" className="ui-panel__title">
              Customize an asset
            </h2>
            <p className="ui-text-muted">
              Create a workspace-owned copy from an exact asset definition and
              its real backing resources.
            </p>
          </div>
        </div>
      </header>
      <div className="ui-panel__section-body ui-stack">
        <TransientNotificationPublisher message={error} title="Asset customization needs attention" tone="error" source="Asset Customization" workspaceId={workspaceId} />
        {contextualNotice ? <p className="ui-status" role="status">{notice}</p> : null}
        <TransientNotificationPublisher message={!contextualNotice ? notice : undefined} title="Asset customization updated" tone="success" source="Asset Customization" workspaceId={workspaceId} />
        <WorkflowSequence ariaLabel="Asset customization sections">
          <WorkflowStep
            title="Choose the asset"
            description="Search and select one exact eligible asset. System, imported, authored, and previously customized assets remain immutable bases."
            active={!target}
          >
            <form
              className="asset-customizer__search"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                void loadTargets(search, undefined);
              }}
            >
              <label>
                Search assets
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  placeholder="Name, ID, type, or family"
                />
              </label>
              <button type="submit" disabled={busy}>
                <ApplicationIcon name="browse" />
                <span>Search</span>
              </button>
            </form>
            {loadingTargets ? (
              <p role="status">Loading customization targets...</p>
            ) : targets.length ? (
              <div
                className="asset-customizer__targets"
                role="group"
                aria-label="Customization targets"
              >
                {targets.map((item) => (
                  <button
                    key={`${item.definitionRef.id}:${item.definitionRef.version}:${item.implementationReleaseId ?? "none"}`}
                    type="button"
                    className="asset-customizer__target ui-button"
                    disabled={busy || !item.eligibility.eligible}
                    aria-pressed={
                      target?.implementationReleaseId ===
                      item.implementationReleaseId
                    }
                    onClick={() => requestTargetSelection(item)}
                  >
                    <strong>{item.displayName}</strong>
                    <span>
                      {item.definitionRef.id} - v{item.definitionRef.version}
                    </span>
                    <span>
                      {item.sourceKind} - {item.resources.total} resources
                    </span>
                    {!item.eligibility.eligible ? (
                      <small>{item.eligibility.message}</small>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No customization targets"
                description="Try another search or ensure the asset has an exact implementation with backing resources."
                icon="assets"
                compact
              />
            )}
          </WorkflowStep>

          <WorkflowStep
            title="Definition and identity"
            description="Identity, ownership, provenance, lifecycle, trust, and base lineage are protected. Enter the distinct identity and editable semantic fields for the copy."
            active={Boolean(target) && !current}
          >
            {target && values ? (
              <>
                <p className="ui-status">
                  <strong>Base:</strong> {selectedLabel} -{" "}
                  {target.definitionRef.id} - v{target.definitionRef.version} -{" "}
                  {target.implementationReleaseId}
                </p>
                <div className="ui-workflow__field-grid">
                  <Field
                    disabled={editingDisabled || Boolean(current) || busy}
                    label="Derived definition ID"
                    value={values.derivedDefinitionId}
                    onChange={(value) =>
                      updateValue("derivedDefinitionId", value)
                    }
                  />
                  <Field
                    disabled={editingDisabled || Boolean(current) || busy}
                    label="Derived version"
                    value={values.derivedDefinitionVersion}
                    onChange={(value) =>
                      updateValue("derivedDefinitionVersion", value)
                    }
                  />
                  <Field
                    disabled={editingDisabled}
                    label="Display name"
                    value={values.displayName}
                    onChange={(value) => updateValue("displayName", value)}
                  />
                  <Field
                    disabled={editingDisabled}
                    label="Classification"
                    value={values.classification}
                    onChange={(value) => updateValue("classification", value)}
                  />
                  <Field
                    disabled={editingDisabled}
                    label="Tags (comma separated)"
                    value={values.tags}
                    onChange={(value) => updateValue("tags", value)}
                  />
                </div>
                <label>
                  Summary
                  <textarea
                    disabled={editingDisabled}
                    aria-label="Summary"
                    value={values.summary}
                    onChange={(event) =>
                      updateValue("summary", event.currentTarget.value)
                    }
                  />
                </label>
                <label>
                  Description
                  <textarea
                    disabled={editingDisabled}
                    aria-label="Description"
                    value={values.description}
                    onChange={(event) =>
                      updateValue("description", event.currentTarget.value)
                    }
                  />
                </label>
                <JsonEditor
                  disabled={editingDisabled}
                  label="Safe metadata additions"
                  value={values.safeMetadata}
                  onChange={(value) => updateValue("safeMetadata", value)}
                />
                <details>
                  <summary>Protected base fields</summary>
                  <p className="ui-text-muted">
                    {target.protectedFields.join(", ")}
                  </p>
                </details>
              </>
            ) : (
              <ChoosePrompt />
            )}
          </WorkflowStep>

          <WorkflowStep
            title="Configuration and interfaces"
            description="Edit the declarative configuration schema, defaults, and ports. Unchanged sections continue to point to the exact base."
            active={Boolean(target)}
          >
            {values ? (
              <div className="asset-customizer__editor-grid">
                <JsonEditor
                  disabled={editingDisabled}
                  label="Configuration schema"
                  value={values.configurationSchema}
                  onChange={(value) =>
                    updateValue("configurationSchema", value)
                  }
                />
                <JsonEditor
                  disabled={editingDisabled}
                  label="Default configuration"
                  value={values.defaultConfiguration}
                  onChange={(value) =>
                    updateValue("defaultConfiguration", value)
                  }
                />
                <JsonEditor
                  disabled={editingDisabled}
                  label="Ports"
                  value={values.ports}
                  onChange={(value) => updateValue("ports", value)}
                />
              </div>
            ) : (
              <ChoosePrompt />
            )}
          </WorkflowStep>

          <WorkflowStep
            title="AI context and composition"
            description="Review and edit AI guidance, requirements, composition rules, and dependencies as structured JSON."
            active={Boolean(target)}
          >
            {values ? (
              <div className="asset-customizer__editor-grid">
                <JsonEditor
                  disabled={editingDisabled}
                  label="AI context"
                  value={values.aiContext}
                  onChange={(value) => updateValue("aiContext", value)}
                />
                <JsonEditor
                  disabled={editingDisabled}
                  label="Requirements"
                  value={values.requirements}
                  onChange={(value) => updateValue("requirements", value)}
                />
                <JsonEditor
                  disabled={editingDisabled}
                  label="Composition rules"
                  value={values.compositionRules}
                  onChange={(value) => updateValue("compositionRules", value)}
                />
                <JsonEditor
                  disabled={editingDisabled}
                  label="Dependencies"
                  value={values.dependencies}
                  onChange={(value) => updateValue("dependencies", value)}
                />
              </div>
            ) : (
              <ChoosePrompt />
            )}
          </WorkflowStep>

          {RESOURCE_ROLES.map((role) => (
            <WorkflowStep
              key={role}
              title={resourceRoleLabel(role)}
              description={resourceDescription(role)}
              active={Boolean(target)}
            >
              {target ? (
                <ResourceEditors
                  disabled={editingDisabled}
                  role={role}
                  resources={resources}
                  onChange={updateResource}
                />
              ) : (
                <ChoosePrompt />
              )}
              {role === "other" && target ? (
                <div className="ui-workflow__subpanel ui-stack ui-stack--sm">
                  <h4>Add a backing resource</h4>
                  <div className="ui-workflow__field-grid">
                    <Field
                    disabled={editingDisabled}
                      label="Relative path"
                      value={newPath}
                      onChange={setNewPath}
                    />
                    <label>
                      Role
                      <select
                        disabled={editingDisabled}
                        aria-label="Role"
                        value={newRole}
                        onChange={(event) =>
                          setNewRole(
                            event.currentTarget
                              .value as AssetImplementationBackingResourceRole,
                          )
                        }
                      >
                        {RESOURCE_ROLES.map((item) => (
                          <option key={item} value={item}>
                            {resourceRoleLabel(item)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Field
                    disabled={editingDisabled}
                      label="Media type"
                      value={newMediaType}
                      onChange={setNewMediaType}
                    />
                  </div>
                  <label>
                    Resource content
                    <textarea
                    disabled={editingDisabled}
                      aria-label="Resource content"
                      className="asset-customizer__source"
                      spellCheck={false}
                      value={newContent}
                      onChange={(event) =>
                        setNewContent(event.currentTarget.value)
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="ui-button ui-button--outline"
                    disabled={editingDisabled}
                    onClick={addResource}
                  >
                    <ApplicationIcon name="add" />
                    <span>Add resource to draft</span>
                  </button>
                </div>
              ) : null}
            </WorkflowStep>
          ))}

          <WorkflowStep
            title="Save, review, and publish"
            description="Save a sparse workspace-owned draft, materialize a complete immutable review snapshot, then publish a distinct definition and implementation draft."
            active={Boolean(current)}
          >
            {target ? (
              <div className="ui-stack">
                <p className="ui-status">
                  <strong>Status:</strong> {current?.status ?? "Not saved"}
                  {current ? ` - revision ${current.revision}` : ""}
                </p>
                {current && dirty && !editingClosed ? <p role="status" className="ui-status">Save your changes before review or publication.</p> : null}
                <div className="ui-workflow__actions">
                  <button
                    type="button"
                    disabled={
                      busy ||
                      current?.status === "published" ||
                      current?.status === "abandoned"
                    }
                    onClick={() => void save()}
                  >
                    <ApplicationIcon name="save" />
                    <span>
                      {current ? "Save changes" : "Create customization draft"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ui-button ui-button--outline"
                    disabled={
                      busy ||
                      !current ||
                      dirty ||
                      current.status === "published" ||
                      current.status === "abandoned"
                    }
                    onClick={() => void transition("review")}
                  >
                    <ApplicationIcon name="play" />
                    <span>Materialize review snapshot</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy || dirty || current?.status !== "reviewed"}
                    onClick={() => void transition("publish")}
                  >
                    <ApplicationIcon name="upload" />
                    <span>Publish customized copy</span>
                  </button>
                  <button
                    type="button"
                    className="ui-button ui-button--outline"
                    disabled={
                      busy ||
                      !current ||
                      current.status === "published" ||
                      current.status === "abandoned"
                    }
                    onClick={() => setPendingAbandon(current)}
                  >
                    <ApplicationIcon name="close" />
                    <span>Abandon</span>
                  </button>
                </div>
              </div>
            ) : (
              <ChoosePrompt />
            )}
          </WorkflowStep>
        </WorkflowSequence>

        <section
          className="asset-customizer__history"
          aria-labelledby="asset-customizer-history-title"
        >
          <h3 id="asset-customizer-history-title">Customization history</h3>
          <form
            className="asset-customizer__search"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void loadHistory();
            }}
          >
            <label>
              Search history
              <input
                type="search"
                value={historySearch}
                onChange={(event) =>
                  setHistorySearch(event.currentTarget.value)
                }
                placeholder="Name, definition ID, or customization ID"
              />
            </label>
            <label>
              Status
              <select
                value={historyStatus}
                onChange={(event) =>
                  setHistoryStatus(event.currentTarget.value)
                }
              >
                <option value="">All statuses</option>
                {HISTORY_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy}>
              Search history
            </button>
          </form>
          {history.length ? (
            <ul>
              {history.map((item) => (
                <li key={item.customizationId}>
                  <div className="ui-cluster ui-cluster--between">
                    <span>
                      <strong>{customizationDisplayName(item)}</strong> -{" "}
                      {item.status} - revision {item.revision}
                      <br />
                      <small>
                        {item.derivedDefinitionRef.id} v
                        {item.derivedDefinitionRef.version}
                      </small>
                    </span>
                    {item.status !== "published" &&
                    item.status !== "abandoned" ? (
                      <button
                        type="button"
                        className="ui-button ui-button--outline"
                        disabled={busy}
                        onClick={() => setPendingAbandon(item)}
                      >
                        Abandon
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No derived customizations"
              description="Select an asset and save a workspace-owned copy to begin its history."
              icon="assets"
              compact
            />
          )}
        </section>
      </div>
      <ModalDialog
        open={pendingTarget !== undefined}
        title="Change customization target?"
        closeLabel="Keep the current customization target"
        closeDisabled={busy}
        onClose={() => setPendingTarget(undefined)}
      >
        <p>
          Changing the exact base asset clears the current on-screen definition
          and backing-resource edits. Saved history remains available and
          neither base asset is changed.
        </p>
        <div className="ui-workflow__actions">
          <button
            type="button"
            className="ui-button ui-button--outline"
            disabled={busy}
            onClick={() => setPendingTarget(undefined)}
          >
            Keep current asset
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const nextTarget = pendingTarget;
              setPendingTarget(undefined);
              if (nextTarget) void selectTarget(nextTarget);
            }}
          >
            Change asset
          </button>
        </div>
      </ModalDialog>
      <ModalDialog
        open={pendingAbandon !== undefined}
        title="Abandon this customization?"
        closeLabel="Keep this customization"
        closeDisabled={busy}
        onClose={() => setPendingAbandon(undefined)}
      >
        <p>
          The customization will remain in history with an abandoned status. Its
          exact base asset and every published asset remain unchanged.
        </p>
        <div className="ui-workflow__actions">
          <button
            type="button"
            className="ui-button ui-button--outline"
            disabled={busy}
            onClick={() => setPendingAbandon(undefined)}
          >
            Keep customization
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const record = pendingAbandon;
              setPendingAbandon(undefined);
              if (record) void abandonCustomization(record);
            }}
          >
            Abandon customization
          </button>
        </div>
      </ModalDialog>
    </section>
  );
}

function sameTarget(
  current: AssetDerivedCustomizationTargetDetail,
  next: AssetDerivedCustomizationTargetSummary,
): boolean {
  return (
    current.definitionRef.id === next.definitionRef.id &&
    current.definitionRef.version === next.definitionRef.version &&
    current.implementationReleaseId === next.implementationReleaseId
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function customizationDisplayName(
  item: AssetDerivedCustomizationDraftRecord,
): string {
  const value = item.semanticPatch["display-name"];
  return typeof value === "string"
    ? value
    : String(item.derivedDefinitionRef.id);
}

function JsonEditor({
  label,
  value,
  onChange,
  disabled,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
}) {
  return (
    <label className="asset-customizer__json">
      {label}
      <textarea
        disabled={disabled}
        aria-label={label}
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder="Leave empty to inherit the base section."
      />
    </label>
  );
}

function ChoosePrompt() {
  return (
    <p className="ui-text-muted">
      Choose an exact asset above to inspect and edit this section.
    </p>
  );
}

function ResourceEditors({
  role,
  resources,
  onChange,
  disabled,
}: {
  readonly disabled?: boolean;
  readonly role: AssetImplementationBackingResourceRole;
  readonly resources: readonly AssetCustomizationResourceDraft[];
  readonly onChange: (
    path: string,
    patch: Partial<AssetCustomizationResourceDraft>,
  ) => void;
}) {
  const items = resources.filter((resource) => resource.role === role);
  if (!items.length)
    return (
      <p className="ui-text-muted">
        The base asset has no {resourceRoleLabel(role).toLowerCase()} resources.
        You can add one in Other backing resources.
      </p>
    );
  return (
    <div className="asset-customizer__resources">
      {items.map((resource) => (
        <details key={resource.path} open className="ui-workflow__subpanel">
          <summary>
            <strong>{resource.path}</strong> - {resource.mediaType}
            {resource.editable ? "" : " - read only"}
          </summary>
          {resource.editable ? (
            <>
              <label>
                Content
                <textarea
                  aria-label={`Content for ${resource.path}`}
                  className="asset-customizer__source"
                  spellCheck={false}
                  disabled={disabled || resource.deleted}
                  value={resource.content}
                  onChange={(event) =>
                    onChange(resource.path, {
                      content: event.currentTarget.value,
                    })
                  }
                />
              </label>
              <label className="ui-workflow__checkbox-row">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={resource.deleted}
                  onChange={(event) =>
                    onChange(resource.path, {
                      deleted: event.currentTarget.checked,
                    })
                  }
                />
                <span>Remove this resource from the customized copy</span>
              </label>
            </>
          ) : (
            <pre className="asset-customizer__readonly-source">
              <code>{resource.content}</code>
            </pre>
          )}
        </details>
      ))}
    </div>
  );
}

function resourceDescription(
  role: AssetImplementationBackingResourceRole,
): string {
  switch (role) {
    case "frontend-structure":
      return "Inspect and edit the component structure and interaction logic attached to this asset.";
    case "frontend-style":
      return "Inspect and edit the CSS or other styling resources attached to this asset.";
    case "backend-logic":
      return "Inspect and edit backend or declarative behavior required for the asset to function.";
    case "other":
      return "Review definitions, tests, documentation, and other attached resources, or add a safe relative source file.";
  }
}
