import { useEffect, useState, type FormEvent } from "react";

import type { AssetReference } from "../../../contracts/asset";
import type {
  AssetCustomizationSourceFileChange,
  AssetDerivedCustomizationDraftRecord,
  AssetDerivedCustomizationSemanticPatch,
  AssetDerivedCustomizationTargetDetail,
  AssetDerivedCustomizationTargetSummary,
} from "../../../contracts/asset-authoring";
import type { AssetImplementationBackingResourceRole } from "../../../contracts/asset-implementation";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { EmptyState } from "../components/EmptyState";
import { ModalDialog } from "../components/ModalDialog";
import { WorkflowSequence, WorkflowStep } from "../components/WorkflowSequence";
import {
  buildAssetCustomizationSubmission,
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

export function AssetDerivedCustomizationEditor({
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
  const [newPath, setNewPath] = useState("");
  const [newRole, setNewRole] =
    useState<AssetImplementationBackingResourceRole>("other");
  const [newMediaType, setNewMediaType] = useState("text/typescript");
  const [newContent, setNewContent] = useState("");

  async function loadTargets(text = search, preferred = initialTarget) {
    setLoadingTargets(true);
    setError(undefined);
    const result = await client.listCustomizationTargets({
      workspaceId,
      text: text.trim() || undefined,
      eligibility: "all",
    });
    if (!result.ok) {
      setTargets([]);
      setError(result.error.message);
      setLoadingTargets(false);
      return;
    }
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
  }

  async function loadHistory(text = historySearch, status = historyStatus) {
    const result = await client.listDerivedCustomizations({
      workspaceId,
      text: text.trim() || undefined,
      status: status || undefined,
    });
    if (result.ok) setHistory(result.value.items);
    else setError(result.error.message);
  }

  useEffect(() => {
    if (!initialTarget || target?.workspaceId !== workspaceId) {
      setTarget(undefined);
      setValues(undefined);
      setResources([]);
      setCurrent(undefined);
    }
    setPendingTarget(undefined);
    setPendingAbandon(undefined);
    setNotice(undefined);
    const preferred = initialTarget;
    const text = preferred?.definitionId ?? "";
    setSearch(text);
    void Promise.all([loadTargets(text, preferred), loadHistory("", "")]);
  }, [workspaceId, initialTarget?.definitionId, initialTarget?.version]);

  async function selectTarget(summary: AssetDerivedCustomizationTargetSummary) {
    if (!summary.implementationReleaseId || !summary.eligibility.eligible) {
      setError(summary.eligibility.message);
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await client.readCustomizationTarget({
      workspaceId,
      definitionRef: summary.definitionRef,
      implementationReleaseId: summary.implementationReleaseId,
    });
    if (!result.ok) setError(result.error.message);
    else {
      setTarget(result.value);
      setValues(createAssetCustomizationEditorValues(result.value));
      setResources(createAssetCustomizationResourceDrafts(result.value));
      setCurrent(undefined);
      setNotice(
        `${result.value.displayName} is ready to customize. The base asset will remain unchanged.`,
      );
    }
    setBusy(false);
  }

  function requestTargetSelection(
    summary: AssetDerivedCustomizationTargetSummary,
  ) {
    const currentTarget =
      target?.workspaceId === workspaceId ? target : undefined;
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
    setValues((currentValues) =>
      currentValues ? { ...currentValues, [key]: value } : currentValues,
    );
  }

  function updateResource(
    path: string,
    patch: Partial<AssetCustomizationResourceDraft>,
  ) {
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

  async function save() {
    if (!target || !target.implementationReleaseId || !values) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const submission = buildAssetCustomizationSubmission(
        target,
        values,
        resources,
      );
      const input = {
        workspaceId,
        semanticPatch: submission.semanticPatch,
        ...(submission.sourceChanges.length
          ? { sourceChanges: submission.sourceChanges }
          : {}),
      };
      const result = current
        ? await client.updateDerivedCustomization({
            ...input,
            customizationId: current.customizationId,
            expectedRevision: current.revision,
          })
        : await client.createDerivedCustomization({
            ...input,
            baseDefinitionRef: target.definitionRef,
            baseImplementationReleaseId: target.implementationReleaseId,
            derivedDefinitionRef: submission.derivedDefinitionRef,
          });
      if (!result.ok) setError(result.error.message);
      else {
        setCurrent(result.value);
        replaceHistory(result.value);
        setNotice(
          current
            ? "Customization changes saved."
            : "Derived customization draft created. The base asset is unchanged.",
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The customization could not be prepared.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function transition(operation: "review" | "publish") {
    if (!current) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const input = {
      workspaceId,
      customizationId: current.customizationId,
      expectedRevision: current.revision,
    };
    const result =
      operation === "review"
        ? await client.reviewDerivedCustomization(input)
        : await client.publishDerivedCustomization(input);
    if (!result.ok) setError(result.error.message);
    else {
      setCurrent(result.value);
      replaceHistory(result.value);
      setNotice(
        operation === "review"
          ? "A complete immutable source snapshot was materialized for review."
          : "The customized definition and implementation draft were published as a distinct lineage.",
      );
    }
    setBusy(false);
  }

  async function abandonCustomization(
    record: AssetDerivedCustomizationDraftRecord,
  ) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await client.abandonDerivedCustomization({
      workspaceId,
      customizationId: record.customizationId,
      expectedRevision: record.revision,
    });
    if (!result.ok) setError(result.error.message);
    else {
      replaceHistory(result.value);
      if (current?.customizationId === result.value.customizationId) {
        setCurrent(result.value);
      }
      setNotice(
        "The customization was abandoned without changing the base asset.",
      );
    }
    setBusy(false);
  }

  function addResource() {
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
    setNotice(
      "The new backing resource will be added when the customization is saved.",
    );
  }

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
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  placeholder="Name, ID, type, or family"
                />
              </label>
              <button type="submit" disabled={loadingTargets}>
                <ApplicationIcon name="browse" />
                <span>Search</span>
              </button>
            </form>
            {loadingTargets ? (
              <p role="status">Loading customization targets...</p>
            ) : targets.length ? (
              <div
                className="asset-customizer__targets"
                aria-label="Customization targets"
              >
                {targets.map((item) => (
                  <button
                    key={`${item.definitionRef.id}:${item.definitionRef.version}:${item.implementationReleaseId ?? "none"}`}
                    type="button"
                    className="asset-customizer__target"
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
                    label="Derived definition ID"
                    value={values.derivedDefinitionId}
                    onChange={(value) =>
                      updateValue("derivedDefinitionId", value)
                    }
                  />
                  <Field
                    label="Derived version"
                    value={values.derivedDefinitionVersion}
                    onChange={(value) =>
                      updateValue("derivedDefinitionVersion", value)
                    }
                  />
                  <Field
                    label="Display name"
                    value={values.displayName}
                    onChange={(value) => updateValue("displayName", value)}
                  />
                  <Field
                    label="Classification"
                    value={values.classification}
                    onChange={(value) => updateValue("classification", value)}
                  />
                  <Field
                    label="Tags (comma separated)"
                    value={values.tags}
                    onChange={(value) => updateValue("tags", value)}
                  />
                </div>
                <label>
                  Summary
                  <textarea
                    value={values.summary}
                    onChange={(event) =>
                      updateValue("summary", event.currentTarget.value)
                    }
                  />
                </label>
                <label>
                  Description
                  <textarea
                    value={values.description}
                    onChange={(event) =>
                      updateValue("description", event.currentTarget.value)
                    }
                  />
                </label>
                <JsonEditor
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
                  label="Configuration schema"
                  value={values.configurationSchema}
                  onChange={(value) =>
                    updateValue("configurationSchema", value)
                  }
                />
                <JsonEditor
                  label="Default configuration"
                  value={values.defaultConfiguration}
                  onChange={(value) =>
                    updateValue("defaultConfiguration", value)
                  }
                />
                <JsonEditor
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
                  label="AI context"
                  value={values.aiContext}
                  onChange={(value) => updateValue("aiContext", value)}
                />
                <JsonEditor
                  label="Requirements"
                  value={values.requirements}
                  onChange={(value) => updateValue("requirements", value)}
                />
                <JsonEditor
                  label="Composition rules"
                  value={values.compositionRules}
                  onChange={(value) => updateValue("compositionRules", value)}
                />
                <JsonEditor
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
                      label="Relative path"
                      value={newPath}
                      onChange={setNewPath}
                    />
                    <label>
                      Role
                      <select
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
                      label="Media type"
                      value={newMediaType}
                      onChange={setNewMediaType}
                    />
                  </div>
                  <label>
                    Resource content
                    <textarea
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
                    disabled={busy || current?.status !== "reviewed"}
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
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <input
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
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="asset-customizer__json">
      {label}
      <textarea
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
}: {
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
                  className="asset-customizer__source"
                  spellCheck={false}
                  disabled={resource.deleted}
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
