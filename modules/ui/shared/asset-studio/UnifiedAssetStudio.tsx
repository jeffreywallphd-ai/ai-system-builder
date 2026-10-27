import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  ASSET_FAMILIES,
  ASSET_TYPES,
  normalizeAssetId,
  type AssetFamily,
  type AssetType,
} from "../../../contracts/asset";
import { isAssetAuthoringStatus, normalizeAssetDraftId, type AuthoredAssetDraftRecord } from "../../../contracts/asset-authoring";
import { TransientNotificationPublisher } from "../notifications/TransientNotificationPublisher";
import {
  ASSET_IMPLEMENTATION_BACKING_RESOURCE_ROLES,
  type AssetImplementationBackingResourceFile,
  type AssetImplementationBackingResourceRole,
} from "../../../contracts/asset-implementation";
import type {
  AssetStudioAssetDraftRecord,
  AssetStudioAssetDraftSummary,
  AssetStudioAssetDraftView,
  AssetStudioSemanticDefinitionInput,
} from "../../../contracts/asset-studio";
import { normalizeAssetStudioAssetDraftId, normalizeAssetStudioExactDefinitionReference } from "../../../contracts/asset-studio";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { EmptyState } from "../components/EmptyState";
import { WorkflowSequence, WorkflowStep } from "../components/WorkflowSequence";
import type { AssetStudioClient } from "./AssetStudioManager";

const JSON_FIELDS = [
  "configurationSchema",
  "defaultConfiguration",
  "configurationExamples",
  "aiContext",
  "requirements",
  "requirementRefs",
  "portRefs",
  "ports",
  "compositionRuleRefs",
  "compositionRules",
  "dependencies",
  "metadata",
] as const;

type JsonField = (typeof JSON_FIELDS)[number];

export interface AssetStudioEditorState {
  readonly definitionId: string;
  readonly definitionVersion: string;
  readonly displayName: string;
  readonly description: string;
  readonly assetType: AssetType;
  readonly assetFamily: AssetFamily;
  readonly json: Readonly<Record<JsonField, string>>;
  readonly resources: readonly AssetImplementationBackingResourceFile[];
}

export interface LegacyAssetDraftClient {
  listDrafts(workspaceId: string): Promise<
    | {
        readonly ok: true;
        readonly value: { readonly items: readonly AuthoredAssetDraftRecord[] };
      }
    | {
        readonly ok: false;
        readonly error: { readonly code: string; readonly message: string };
      }
  >;
}

const DEFAULT_RESOURCES: readonly AssetImplementationBackingResourceFile[] = [
  {
    path: "frontend/AssetView.tsx",
    role: "frontend-structure",
    mediaType: "text/typescript",
    content:
      'export interface AssetViewProps { readonly value?: unknown; }\n\nexport function AssetView({ value }: AssetViewProps) {\n  return <section className="asset-view">{String(value ?? "")}</section>;\n}\n',
  },
  {
    path: "frontend/asset.css",
    role: "frontend-style",
    mediaType: "text/css",
    content:
      ".asset-view {\n  display: grid;\n  gap: 0.75rem;\n  min-inline-size: 0;\n}\n",
  },
  {
    path: "backend/handleAssetRequest.ts",
    role: "backend-logic",
    mediaType: "text/typescript",
    content:
      "export interface AssetRequest { readonly input: unknown; }\n\nexport async function handleAssetRequest(request: AssetRequest) {\n  return { ok: true as const, value: request.input };\n}\n",
  },
];

const emptyJson = (): Record<JsonField, string> =>
  Object.fromEntries(JSON_FIELDS.map((field) => [field, ""])) as Record<
    JsonField,
    string
  >;

const prettyJson = (value: unknown): string =>
  value === undefined ? "" : JSON.stringify(value, null, 2);

export function createAssetStudioEditorState(
  view?: AssetStudioAssetDraftView,
): AssetStudioEditorState {
  if (!view) {
    return {
      definitionId: "",
      definitionVersion: "1.0.0",
      displayName: "",
      description: "",
      assetType: "ui-component",
      assetFamily: "resource-backed",
      json: {
        ...emptyJson(),
        aiContext:
          '{\n  "purpose": "Describe how this asset should be selected and used."\n}',
      },
      resources: DEFAULT_RESOURCES.map((resource) => ({ ...resource })),
    };
  }

  const semantic = view.record.semanticDefinition;
  return {
    definitionId: semanticRefId(view),
    definitionVersion: view.record.definitionRef.version ?? "1.0.0",
    displayName: semantic.displayName,
    description: semantic.description,
    assetType: semantic.assetType,
    assetFamily: semantic.assetFamily,
    json: {
      configurationSchema: prettyJson(semantic.configurationSchema),
      defaultConfiguration: prettyJson(semantic.defaultConfiguration),
      configurationExamples: prettyJson(semantic.configurationExamples),
      aiContext: prettyJson(semantic.aiContext),
      requirements: prettyJson(semantic.requirements),
      requirementRefs: prettyJson(semantic.requirementRefs),
      portRefs: prettyJson(semantic.portRefs),
      ports: prettyJson(semantic.ports),
      compositionRuleRefs: prettyJson(semantic.compositionRuleRefs),
      compositionRules: prettyJson(semantic.compositionRules),
      dependencies: prettyJson(semantic.dependencies),
      metadata: prettyJson(semantic.metadata),
    },
    resources: view.resources.map((resource) => ({ ...resource })),
  };
}

function semanticRefId(view: AssetStudioAssetDraftView): string {
  return view.record.definitionRef.id;
}

function parseOptionalJson<T>(label: string, value: string): T | undefined {
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
}

function buildSemanticDefinition(
  editor: AssetStudioEditorState,
): AssetStudioSemanticDefinitionInput {
  return {
    assetType: editor.assetType,
    assetFamily: editor.assetFamily,
    displayName: editor.displayName.trim(),
    description: editor.description.trim(),
    configurationSchema: parseOptionalJson(
      "Configuration schema",
      editor.json.configurationSchema,
    ),
    defaultConfiguration: parseOptionalJson(
      "Default configuration",
      editor.json.defaultConfiguration,
    ),
    configurationExamples: parseOptionalJson(
      "Configuration examples",
      editor.json.configurationExamples,
    ),
    aiContext: parseOptionalJson("AI context", editor.json.aiContext),
    requirements: parseOptionalJson("Requirements", editor.json.requirements),
    requirementRefs: parseOptionalJson(
      "Requirement references",
      editor.json.requirementRefs,
    ),
    portRefs: parseOptionalJson("Port references", editor.json.portRefs),
    ports: parseOptionalJson("Ports", editor.json.ports),
    compositionRuleRefs: parseOptionalJson(
      "Composition rule references",
      editor.json.compositionRuleRefs,
    ),
    compositionRules: parseOptionalJson(
      "Composition rules",
      editor.json.compositionRules,
    ),
    dependencies: parseOptionalJson("Dependencies", editor.json.dependencies),
    metadata: parseOptionalJson("Metadata", editor.json.metadata),
  };
}

interface AssetStudioWorkspaceProps {
  readonly workspaceId: string;
  readonly client: AssetStudioClient;
  readonly initialDraftId?: string;
}

function matchesStudioRecord(
  value: AssetStudioAssetDraftRecord,
  expected: { workspaceId: string; draftId?: string; definitionRef?: AssetStudioAssetDraftRecord["definitionRef"]; status?: AssetStudioAssetDraftRecord["status"]; revision?: number },
) {
  return Boolean(value && value.workspaceId === expected.workspaceId &&
    typeof value.draftId === "string" && value.draftId.length > 0 &&
    (!expected.draftId || value.draftId === expected.draftId) &&
    value.definitionRef?.kind === "asset-definition-version" &&
    typeof value.definitionRef.id === "string" && value.definitionRef.id.length > 0 &&
    typeof value.definitionRef.version === "string" && value.definitionRef.version.length > 0 &&
    (!expected.definitionRef || (value.definitionRef.id === expected.definitionRef.id && value.definitionRef.version === expected.definitionRef.version)) &&
    ["draft", "reviewed", "published", "abandoned"].includes(value.status) &&
    (!expected.status || value.status === expected.status) &&
    Number.isSafeInteger(value.revision) && value.revision > 0 &&
    (expected.revision === undefined || value.revision === expected.revision));
}

export function AssetStudioWorkspace(props: AssetStudioWorkspaceProps) {
  const [scope, setScope] = useState({ workspaceId: props.workspaceId, client: props.client, draftId: props.initialDraftId, key: 0 });
  if (scope.workspaceId !== props.workspaceId || scope.client !== props.client || scope.draftId !== props.initialDraftId) {
    setScope({ workspaceId: props.workspaceId, client: props.client, draftId: props.initialDraftId, key: scope.key + 1 });
    return null;
  }
  return <ScopedAssetStudioWorkspace key={scope.key} {...props} />;
}

function ScopedAssetStudioWorkspace({
  workspaceId,
  client,
  initialDraftId,
}: AssetStudioWorkspaceProps) {
  const [editor, setEditor] = useState<AssetStudioEditorState>(() =>
    createAssetStudioEditorState(),
  );
  const [record, setRecord] = useState<AssetStudioAssetDraftRecord>();
  const [busy, setBusy] = useState(Boolean(initialDraftId));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [readFailed, setReadFailed] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const mountedRef = useRef(true);
  const actionSequence = useRef(0);
  const actionOwner = useRef<number | undefined>(undefined);
  const editEpoch = useRef(0);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const ownsAction = (owner: number) => mountedRef.current && actionOwner.current === owner;
  const beginAction = () => {
    if (!mountedRef.current || busy || actionOwner.current !== undefined) return;
    const owner = ++actionSequence.current;
    actionOwner.current = owner;
    setBusy(true);
    return owner;
  };
  const endAction = (owner: number) => {
    if (!ownsAction(owner)) return;
    actionOwner.current = undefined;
    setBusy(false);
  };

  useEffect(() => {
    let active = true;
    setError(undefined);
    setNotice(undefined);
    setDirty(false);
    setRecord(undefined);
    setReadFailed(false);

    if (!initialDraftId) {
      setEditor(createAssetStudioEditorState());
      setBusy(false);
      return () => {
        active = false;
      };
    }

    setBusy(true);
    void Promise.resolve().then(() => {
      if (!active || !mountedRef.current) return;
      return client.readAssetDraft({
        workspaceId: workspaceId as never,
        draftId: initialDraftId as never,
      });
    }).then((result) => {
      if (!active || !mountedRef.current || !result) return;
      if (result.ok) {
        if (!matchesStudioRecord(result.value.record, { workspaceId, draftId: initialDraftId })) throw new Error("Invalid Studio draft response.");
        const nextEditor = createAssetStudioEditorState(result.value);
        setEditor(nextEditor);
        setRecord(result.value.record);
      } else { setError(result.error.message); setReadFailed(true); }
    }).catch(() => {
      if (active && mountedRef.current) {
        setError("The saved asset could not be opened. Retry opening it.");
        setReadFailed(true);
      }
    }).finally(() => {
      if (active && mountedRef.current) setBusy(false);
    });

    return () => {
      active = false;
    };
  }, [client, initialDraftId, readAttempt, workspaceId]);

  const change = <K extends keyof AssetStudioEditorState>(
    key: K,
    value: AssetStudioEditorState[K],
  ) => {
    editEpoch.current++;
    setEditor((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setNotice(undefined);
  };

  const changeJson = (field: JsonField, value: string) => {
    editEpoch.current++;
    setEditor((current) => ({
      ...current,
      json: { ...current.json, [field]: value },
    }));
    setDirty(true);
    setNotice(undefined);
  };

  const changeResource = (
    index: number,
    patch: Partial<AssetImplementationBackingResourceFile>,
  ) => {
    editEpoch.current++;
    setEditor((current) => ({
      ...current,
      resources: current.resources.map((resource, resourceIndex) =>
        resourceIndex === index ? { ...resource, ...patch } : resource,
      ),
    }));
    setDirty(true);
    setNotice(undefined);
  };

  const addResource = (role: AssetImplementationBackingResourceRole) => {
    editEpoch.current++;
    const template =
      DEFAULT_RESOURCES.find((resource) => resource.role === role) ??
      ({
        path: `resources/resource-${editor.resources.length + 1}.txt`,
        role,
        mediaType: "text/plain",
        content: "",
      } satisfies AssetImplementationBackingResourceFile);
    setEditor((current) => ({
      ...current,
      resources: [...current.resources, { ...template }],
    }));
    setDirty(true);
  };

  const removeResource = (index: number) => {
    editEpoch.current++;
    setEditor((current) => ({
      ...current,
      resources: current.resources.filter(
        (_, resourceIndex) => resourceIndex !== index,
      ),
    }));
    setDirty(true);
  };

  const save = async () => {
    setError(undefined);
    setNotice(undefined);
    if (
      !editor.definitionId.trim() ||
      !editor.definitionVersion.trim() ||
      !editor.displayName.trim() ||
      !editor.description.trim()
    ) {
      setError(
        "Asset ID, version, display name, and description are required.",
      );
      return;
    }
    if (!editor.resources.length) {
      setError("Add at least one backing resource before saving.");
      return;
    }

    let semanticDefinition: AssetStudioSemanticDefinitionInput;
    try {
      semanticDefinition = buildSemanticDefinition(editor);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Invalid semantic data.",
      );
      return;
    }

    const owner = beginAction();
    if (owner === undefined) return;
    const savedEpoch = editEpoch.current;
    const definitionRef = record?.definitionRef ?? { kind: "asset-definition-version" as const, id: editor.definitionId.trim() as never, version: editor.definitionVersion.trim() };
    try {
      const result = record
        ? await client.updateAssetDraft({ workspaceId: workspaceId as never, draftId: record.draftId, expectedRevision: record.revision, semanticDefinition, resources: editor.resources })
        : await client.createAssetDraft({ workspaceId: workspaceId as never, definitionRef, semanticDefinition, resources: editor.resources });
      if (!ownsAction(owner)) return;
      if (result.ok) {
        if (!matchesStudioRecord(result.value, { workspaceId, draftId: record?.draftId, definitionRef, status: "draft", revision: record ? record.revision + 1 : 1 })) throw new Error("Invalid Studio save response.");
        const newerEdits = editEpoch.current !== savedEpoch;
        setRecord(result.value);
        setDirty(newerEdits);
        setNotice(newerEdits ? "Draft saved. Your newer changes remain unsaved." : record
          ? "Draft saved. Any prior review was invalidated when content changed."
          : "Draft saved without publishing or executing it.");
      } else setError(result.error.message);
    } catch {
      if (ownsAction(owner)) setError("The draft could not be saved. Retry the save.");
    } finally { endAction(owner); }
  };

  const transition = async (action: "review" | "publish" | "abandon") => {
    if (!record || (action !== "abandon" && dirty) ||
        (action === "review" && record.status !== "draft") ||
        (action === "publish" && record.status !== "reviewed") ||
        (action === "abandon" && !["draft", "reviewed"].includes(record.status))) return;
    const owner = beginAction();
    if (owner === undefined) return;
    setError(undefined);
    setNotice(undefined);
    const command = { workspaceId: workspaceId as never, draftId: record.draftId, expectedRevision: record.revision };
    try {
      const result = action === "review" ? await client.reviewAssetDraft(command)
        : action === "publish" ? await client.publishAssetDraft(command) : await client.abandonAssetDraft(command);
      if (!ownsAction(owner)) return;
      if (result.ok) {
        const status = action === "review" ? "reviewed" : action === "publish" ? "published" : "abandoned";
        if (!matchesStudioRecord(result.value, { workspaceId, draftId: record.draftId, definitionRef: record.definitionRef, status, revision: record.revision + 1 })) throw new Error("Invalid Studio transition response.");
        setRecord(result.value);
        setNotice(action === "review" ? "Review snapshot created. Publish remains a separate explicit action."
          : action === "publish" ? "Asset definition published; implementation activation and execution remain separate."
          : "Draft abandoned without publishing it.");
      } else setError(result.error.message);
    } catch {
      if (ownsAction(owner)) setError(action === "review" ? "The draft could not be reviewed. Retry the review."
        : action === "publish" ? "The asset could not be published. Retry the publication."
        : "The draft could not be abandoned. Retry the action.");
    } finally { endAction(owner); }
  };

  const coreResource = (role: AssetImplementationBackingResourceRole) =>
    editor.resources.findIndex((resource) => resource.role === role);

  return (
    <section
      className="ui-panel ui-panel--sectioned asset-studio asset-studio--unified"
      aria-labelledby="unified-asset-studio-title"
      aria-busy={busy}
    >
      <header className="ui-panel__section-header">
        <div className="ui-panel-heading ui-panel-heading--violet">
          <span className="ui-panel-heading__icon" aria-hidden="true">
            <ApplicationIcon name="assets" />
          </span>
          <div>
            <h2 id="unified-asset-studio-title" className="ui-panel__title">
              Asset Studio
            </h2>
            <p className="ui-text-muted">
              Define semantic behavior and every backing resource in one ordered
              authoring surface.
            </p>
          </div>
        </div>
        <span className="ui-badge">
          {record
            ? `${record.status} - revision ${record.revision}`
            : "new draft"}
        </span>
      </header>
      <div className="ui-panel__section-body ui-stack">
        {readFailed ? <button type="button" className="ui-button ui-button--outline" disabled={busy}
          onClick={() => setReadAttempt(value => value + 1)}>Retry opening saved asset</button> : null}
        <TransientNotificationPublisher message={error} title="Asset Studio needs attention" tone="error" source="Asset Studio" workspaceId={workspaceId} />
        <TransientNotificationPublisher message={notice} title="Asset Studio updated" tone="success" source="Asset Studio" workspaceId={workspaceId} />
        <fieldset disabled={Boolean(initialDraftId) && !record} aria-label="Asset draft editor">
        <WorkflowSequence ariaLabel="Unified Asset Studio sections">
          <WorkflowStep
            title="Identity and classification"
            description="Choose the stable asset identity, version, family, and user-facing definition."
            active={!record}
          >
            <div className="ui-workflow__field-grid">
              <label>
                Asset ID
                <input
                  value={editor.definitionId}
                  disabled={Boolean(record) || busy}
                  onChange={(event) =>
                    change("definitionId", event.currentTarget.value)
                  }
                  placeholder="workspace.asset-id"
                />
              </label>
              <label>
                Version
                <input
                  value={editor.definitionVersion}
                  disabled={Boolean(record) || busy}
                  onChange={(event) =>
                    change("definitionVersion", event.currentTarget.value)
                  }
                />
              </label>
              <label>
                Display name
                <input
                  value={editor.displayName}
                  onChange={(event) =>
                    change("displayName", event.currentTarget.value)
                  }
                />
              </label>
              <label>
                Asset type
                <select
                  value={editor.assetType}
                  onChange={(event) =>
                    change("assetType", event.currentTarget.value as AssetType)
                  }
                >
                  {ASSET_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Asset family
                <select
                  value={editor.assetFamily}
                  onChange={(event) =>
                    change(
                      "assetFamily",
                      event.currentTarget.value as AssetFamily,
                    )
                  }
                >
                  {ASSET_FAMILIES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Definition
              <textarea
                value={editor.description}
                onChange={(event) =>
                  change("description", event.currentTarget.value)
                }
              />
            </label>
          </WorkflowStep>

          <WorkflowStep
            title="Configuration and examples"
            description="Describe configuration contracts, defaults, and examples as structured JSON."
          >
            <JsonEditor
              label="Configuration schema"
              value={editor.json.configurationSchema}
              onChange={(value) => changeJson("configurationSchema", value)}
            />
            <JsonEditor
              label="Default configuration"
              value={editor.json.defaultConfiguration}
              onChange={(value) => changeJson("defaultConfiguration", value)}
            />
            <JsonEditor
              label="Configuration examples"
              value={editor.json.configurationExamples}
              onChange={(value) => changeJson("configurationExamples", value)}
            />
          </WorkflowStep>

          <WorkflowStep
            title="AI context, requirements, and ports"
            description="Expose the same semantic internals used for customization, composition, and model context."
          >
            <div className="asset-studio__editor-grid">
              {(
                [
                  ["aiContext", "AI context"],
                  ["requirements", "Requirements"],
                  ["requirementRefs", "Requirement references"],
                  ["ports", "Ports"],
                  ["portRefs", "Port references"],
                ] as const
              ).map(([field, label]) => (
                <JsonEditor
                  key={field}
                  label={label}
                  value={editor.json[field]}
                  onChange={(value) => changeJson(field, value)}
                />
              ))}
            </div>
          </WorkflowStep>

          <WorkflowStep
            title="Composition and metadata"
            description="Define composition rules, dependencies, and descriptive metadata without hiding them behind another tab."
          >
            <div className="asset-studio__editor-grid">
              {(
                [
                  ["compositionRules", "Composition rules"],
                  ["compositionRuleRefs", "Composition rule references"],
                  ["dependencies", "Dependencies"],
                  ["metadata", "Metadata"],
                ] as const
              ).map(([field, label]) => (
                <JsonEditor
                  key={field}
                  label={label}
                  value={editor.json[field]}
                  onChange={(value) => changeJson(field, value)}
                />
              ))}
            </div>
          </WorkflowStep>

          <ResourceStep
            title="Frontend structure"
            description="Author the component, page, or other frontend structural logic associated with this asset."
            role="frontend-structure"
            resourceIndex={coreResource("frontend-structure")}
            resources={editor.resources}
            onAdd={addResource}
            onChange={changeResource}
            onRemove={removeResource}
          />
          <ResourceStep
            title="Styling logic"
            description="Author CSS or other styling resources used by the frontend structure."
            role="frontend-style"
            resourceIndex={coreResource("frontend-style")}
            resources={editor.resources}
            onAdd={addResource}
            onChange={changeResource}
            onRemove={removeResource}
          />
          <ResourceStep
            title="Backend logic"
            description="Author server-side handlers, adapters, or declarative backend logic required by the asset."
            role="backend-logic"
            resourceIndex={coreResource("backend-logic")}
            resources={editor.resources}
            onAdd={addResource}
            onChange={changeResource}
            onRemove={removeResource}
          />

          <WorkflowStep
            title="Other backing resources"
            description="Add supporting schemas, prompts, tests, documentation, or other resource files."
          >
            <div className="ui-stack ui-stack--sm">
              {editor.resources.map((resource, index) =>
                resource.role === "other" ? (
                  <ResourceEditor
                    key={`${index}-${resource.path}`}
                    index={index}
                    resource={resource}
                    onChange={changeResource}
                    onRemove={removeResource}
                    allowRoleChange
                  />
                ) : null,
              )}
              <button
                type="button"
                className="ui-button ui-button--outline"
                onClick={() => addResource("other")}
              >
                <ApplicationIcon name="add" />
                <span>Add backing resource</span>
              </button>
            </div>
          </WorkflowStep>

          <WorkflowStep
            title="Save, review, and publish"
            description="Saving persists an unpublished draft. Review materializes an immutable snapshot; publication is explicit and still does not activate or execute code."
            active={Boolean(record)}
          >
            <div className="ui-workflow__actions asset-studio__actions">
              <button
                type="button"
                disabled={
                  busy ||
                  record?.status === "published" ||
                  record?.status === "abandoned"
                }
                onClick={() => void save()}
              >
                <ApplicationIcon name="save" />
                <span>{record ? "Save draft" : "Save new draft"}</span>
              </button>
              <button
                type="button"
                className="ui-button ui-button--outline"
                disabled={busy || !record || dirty || record.status !== "draft"}
                onClick={() => void transition("review")}
              >
                Review draft
              </button>
              <button
                type="button"
                disabled={
                  busy || !record || dirty || record.status !== "reviewed"
                }
                onClick={() => void transition("publish")}
              >
                Publish asset
              </button>
              <button
                type="button"
                className="ui-button ui-button--outline"
                disabled={
                  busy ||
                  !record ||
                  record.status === "published" ||
                  record.status === "abandoned"
                }
                onClick={() => void transition("abandon")}
              >
                Abandon draft
              </button>
            </div>
          </WorkflowStep>
        </WorkflowSequence>
        </fieldset>
      </div>
    </section>
  );
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
    <label>
      {label}
      <textarea
        className="asset-studio__json"
        spellCheck={false}
        value={value}
        placeholder="Optional JSON"
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function ResourceStep({
  title,
  description,
  role,
  resourceIndex,
  resources,
  onAdd,
  onChange,
  onRemove,
}: {
  readonly title: string;
  readonly description: string;
  readonly role: AssetImplementationBackingResourceRole;
  readonly resourceIndex: number;
  readonly resources: readonly AssetImplementationBackingResourceFile[];
  readonly onAdd: (role: AssetImplementationBackingResourceRole) => void;
  readonly onChange: (
    index: number,
    patch: Partial<AssetImplementationBackingResourceFile>,
  ) => void;
  readonly onRemove: (index: number) => void;
}) {
  const resource = resources[resourceIndex];
  return (
    <WorkflowStep title={title} description={description}>
      {resource ? (
        <ResourceEditor
          index={resourceIndex}
          resource={resource}
          onChange={onChange}
          onRemove={onRemove}
        />
      ) : (
        <button
          type="button"
          className="ui-button ui-button--outline"
          onClick={() => onAdd(role)}
        >
          <ApplicationIcon name="add" />
          <span>Add {title.toLowerCase()} resource</span>
        </button>
      )}
    </WorkflowStep>
  );
}

function ResourceEditor({
  index,
  resource,
  onChange,
  onRemove,
  allowRoleChange = false,
}: {
  readonly index: number;
  readonly resource: AssetImplementationBackingResourceFile;
  readonly onChange: (
    index: number,
    patch: Partial<AssetImplementationBackingResourceFile>,
  ) => void;
  readonly onRemove: (index: number) => void;
  readonly allowRoleChange?: boolean;
}) {
  return (
    <div className="ui-workflow__subpanel ui-stack ui-stack--sm asset-studio__resource">
      <div className="ui-workflow__field-grid">
        <label>
          Resource path
          <input
            value={resource.path}
            onChange={(event) =>
              onChange(index, { path: event.currentTarget.value })
            }
          />
        </label>
        <label>
          Media type
          <input
            value={resource.mediaType}
            onChange={(event) =>
              onChange(index, { mediaType: event.currentTarget.value })
            }
          />
        </label>
        {allowRoleChange ? (
          <label>
            Role
            <select
              value={resource.role}
              onChange={(event) =>
                onChange(index, {
                  role: event.currentTarget
                    .value as AssetImplementationBackingResourceRole,
                })
              }
            >
              {ASSET_IMPLEMENTATION_BACKING_RESOURCE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <label>
        Resource content
        <textarea
          className="asset-studio__source"
          spellCheck={false}
          value={resource.content}
          onChange={(event) =>
            onChange(index, { content: event.currentTarget.value })
          }
        />
      </label>
      <button
        type="button"
        className="ui-button ui-button--outline"
        onClick={() => onRemove(index)}
      >
        <ApplicationIcon name="close" />
        <span>Remove resource</span>
      </button>
    </div>
  );
}

export function createStudioSeedFromLegacyDraft(
  draft: AuthoredAssetDraftRecord,
) {
  const displayName = legacyString(
    draft.draftEditableValues["display-name"],
    draft.baseAssetReference?.label ?? "Saved asset",
  );
  const summary = legacyString(draft.draftEditableValues.summary, "");
  const description = legacyString(
    draft.draftEditableValues.description,
    summary || `Resource-backed Studio upgrade of ${displayName}.`,
  );
  const classification = legacyString(
    draft.draftEditableValues.classification,
    "component-asset",
  );
  return {
    definitionRef: {
      kind: "asset-definition-version" as const,
      id: normalizeAssetId(
        `workspace.legacy.${legacySlug(String(draft.draftId))}`,
      ),
      version: "1.0.0",
    },
    semanticDefinition: {
      assetType: legacyAssetType(classification),
      assetFamily: "resource-backed" as const,
      displayName,
      description,
      aiContext: {
        purpose: `Preserve and complete the legacy saved draft named ${displayName}.`,
      },
    },
    resources: DEFAULT_RESOURCES.map((resource) => ({ ...resource })),
    sourceLegacyDraftId: draft.draftId,
  };
}

function legacyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function legacySlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  return normalized || "saved-asset";
}

function legacyAssetType(classification: string): AssetType {
  const mappings: Readonly<Record<string, AssetType>> = {
    "workflow-asset": "workflow",
    "system-asset": "system",
    "component-asset": "ui-component",
    "data-asset": "data-source",
    "model-asset": "model",
    "tool-asset": "tool",
  };
  return mappings[classification] ?? "ui-component";
}

interface SavedAssetDraftsProps {
  readonly workspaceId: string;
  readonly client: AssetStudioClient;
  readonly legacyClient?: LegacyAssetDraftClient;
  readonly onOpenDraft: (draftId: string) => void;
}

export function SavedAssetDrafts(props: SavedAssetDraftsProps) {
  const [scope, setScope] = useState({ workspaceId: props.workspaceId, client: props.client, legacyClient: props.legacyClient, key: 0 });
  if (scope.workspaceId !== props.workspaceId || scope.client !== props.client || scope.legacyClient !== props.legacyClient) {
    setScope({ workspaceId: props.workspaceId, client: props.client, legacyClient: props.legacyClient, key: scope.key + 1 });
    return null;
  }
  return <ScopedSavedAssetDrafts key={scope.key} {...props} />;
}

function ScopedSavedAssetDrafts({ workspaceId, client, legacyClient, onOpenDraft }: SavedAssetDraftsProps) {
  const [drafts, setDrafts] = useState<readonly AssetStudioAssetDraftSummary[]>([]);
  const [legacyDrafts, setLegacyDrafts] = useState<readonly AuthoredAssetDraftRecord[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();
  const [listingKnown, setListingKnown] = useState(false);
  const mountedRef = useRef(true);
  const sequence = useRef(0);
  const readOwner = useRef<number | undefined>(undefined);
  const actionOwner = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; readOwner.current = undefined; actionOwner.current = undefined; };
  }, []);
  const ownsRead = (owner: number) => mountedRef.current && readOwner.current === owner;
  const ownsAction = (owner: number) => mountedRef.current && actionOwner.current === owner;
  const studioFailure = () => ({ ok: false as const, error: { code: "asset-studio.asset-draft.unavailable" as const, message: "Saved assets are unavailable. Retry the search." } });
  const legacyFailure = () => ({ ok: false as const, error: { code: "unavailable", message: "Legacy saved assets are unavailable. Retry the search." } });
  const validLegacyId = (value: unknown) => {
    try { return typeof value === "string" && normalizeAssetDraftId(value) === value; }
    catch { return false; }
  };
  const validStudioIdentity = (row: Pick<AssetStudioAssetDraftRecord, "draftId" | "definitionRef">) => {
    try {
      if (!row || typeof row.draftId !== "string" || normalizeAssetStudioAssetDraftId(row.draftId) !== row.draftId ||
          row.definitionRef?.kind !== "asset-definition-version" || typeof row.definitionRef.id !== "string" || typeof row.definitionRef.version !== "string") return false;
      const reference = normalizeAssetStudioExactDefinitionReference(row.definitionRef);
      return reference.id === row.definitionRef.id && reference.version === row.definitionRef.version;
    } catch { return false; }
  };
  const validStudioSummaries = (rows: readonly AssetStudioAssetDraftSummary[]) => Array.isArray(rows) && rows.every(row =>
    validStudioIdentity(row) && typeof row.displayName === "string" &&
    ASSET_TYPES.includes(row.assetType) && ["draft", "reviewed"].includes(row.status) &&
    Number.isSafeInteger(row.revision) && row.revision > 0 && Number.isSafeInteger(row.resourceCount) && row.resourceCount >= 0 &&
    (row.sourceLegacyDraftId === undefined || validLegacyId(row.sourceLegacyDraftId))) &&
    new Set(rows.map(row => row.draftId)).size === rows.length;
  const validLegacyRows = (rows: readonly AuthoredAssetDraftRecord[]) => Array.isArray(rows) && rows.every(row =>
    row && row.targetWorkspaceId === workspaceId && validLegacyId(row.draftId) && isAssetAuthoringStatus(row.status) &&
    (row.baseAssetReference?.label === undefined || typeof row.baseAssetReference.label === "string") &&
    row.draftEditableValues && typeof row.draftEditableValues === "object" && !Array.isArray(row.draftEditableValues)) &&
    new Set(rows.map(row => row.draftId)).size === rows.length;

  const load = async (searchText = text) => {
    if (!mountedRef.current || readOwner.current !== undefined || actionOwner.current !== undefined) return;
    const owner = ++sequence.current;
    readOwner.current = owner;
    setBusy(true); setError(undefined);
    try {
      const [studioResult, legacyResult] = await Promise.all([
        Promise.resolve().then(() => {
          if (!ownsRead(owner)) return;
          return client.listAssetDrafts({ workspaceId: workspaceId as never, unpublishedOnly: true, ...(searchText.trim() ? { text: searchText.trim() } : {}) });
        }).then(result => {
          if (!ownsRead(owner)) return;
          if (!result || (result.ok ? !validStudioSummaries(result.value?.drafts) : typeof result.error?.message !== "string")) throw new Error("Invalid Saved list response.");
          return result;
        }).catch(studioFailure),
        Promise.resolve().then(() => {
          if (!ownsRead(owner) || !legacyClient) return;
          return legacyClient.listDrafts(workspaceId);
        }).then(result => {
          if (!ownsRead(owner) || !legacyClient) return;
          if (!result || (result.ok ? !validLegacyRows(result.value?.items) : typeof result.error?.message !== "string")) throw new Error("Invalid legacy list response.");
          return result;
        }).catch(legacyFailure),
      ]);
      if (!ownsRead(owner)) return;
      setDrafts(studioResult?.ok ? studioResult.value.drafts : []);
      setLegacyDrafts(legacyResult?.ok ? legacyResult.value.items : []);
      setListingKnown(Boolean(studioResult?.ok && (!legacyClient || legacyResult?.ok)));
      const failures = [studioResult && !studioResult.ok ? studioResult.error.message : undefined, legacyResult && !legacyResult.ok ? legacyResult.error.message : undefined].filter(Boolean);
      if (failures.length) setError(failures.join(" "));
    } finally {
      if (ownsRead(owner)) { readOwner.current = undefined; setBusy(false); }
    }
  };

  useEffect(() => {
    void load("");
    return () => { readOwner.current = undefined; };
  }, [client, legacyClient, workspaceId]);

  const convertedLegacyIds = new Set(
    drafts.flatMap((draft) =>
      draft.sourceLegacyDraftId ? [String(draft.sourceLegacyDraftId)] : [],
    ),
  );
  const visibleLegacyDrafts = legacyDrafts.filter((draft) => {
    if (convertedLegacyIds.has(String(draft.draftId))) return false;
    const searchText = text.trim().toLowerCase();
    if (!searchText) return true;
    return [
      draft.draftId,
      draft.draftEditableValues["display-name"],
      draft.draftEditableValues.summary,
      draft.draftEditableValues.description,
    ]
      .filter((value): value is string => typeof value === "string")
      .some((value) => value.toLowerCase().includes(searchText));
  });

  const openLegacyDraft = async (draft: AuthoredAssetDraftRecord) => {
    if (!mountedRef.current || busy || readOwner.current !== undefined || actionOwner.current !== undefined) return;
    if (draft.targetWorkspaceId !== workspaceId) { setError("The saved asset could not be opened. Retry opening it."); return; }
    const converted = drafts.find(candidate => String(candidate.sourceLegacyDraftId ?? "") === String(draft.draftId));
    if (converted) { onOpenDraft(String(converted.draftId)); return; }
    const owner = ++sequence.current;
    actionOwner.current = owner;
    setBusy(true); setError(undefined);
    try {
      const seed = createStudioSeedFromLegacyDraft(draft);
      const result = await Promise.resolve().then(() => {
        if (!ownsAction(owner)) return;
        return client.createAssetDraft({ workspaceId: workspaceId as never, ...seed });
      });
      if (!ownsAction(owner)) return;
      if (!result) throw new Error("Invalid legacy conversion response.");
      if (!result.ok) {
        if (typeof result.error?.message !== "string") throw new Error("Invalid legacy conversion failure.");
        setError(result.error.message); return;
      }
      // The application can return an already converted record. Its canonical
      // revision, definition and lifecycle state can differ from a new seed.
      if (!matchesStudioRecord(result.value, { workspaceId }) || !validStudioIdentity(result.value) || result.value.provenance?.kind !== "studio-from-scratch" ||
          result.value.provenance.sourceLegacyDraftId !== seed.sourceLegacyDraftId) throw new Error("Invalid converted draft identity.");
      onOpenDraft(String(result.value.draftId));
    } catch {
      if (ownsAction(owner)) setError("The saved asset could not be opened. Retry opening it.");
    } finally {
      if (ownsAction(owner)) { actionOwner.current = undefined; setBusy(false); }
    }
  };

  const itemCount = drafts.length + visibleLegacyDrafts.length;

  return (
    <section
      className="ui-panel ui-panel--sectioned asset-studio asset-studio--saved"
      aria-labelledby="saved-assets-title"
      aria-busy={busy}
    >
      <header className="ui-panel__section-header">
        <div className="ui-panel-heading ui-panel-heading--violet">
          <span className="ui-panel-heading__icon" aria-hidden="true">
            <ApplicationIcon name="save" />
          </span>
          <div>
            <h2 id="saved-assets-title" className="ui-panel__title">
              Saved assets
            </h2>
            <p className="ui-text-muted">
              Reopen saved, unpublished Studio and legacy drafts with their
              semantic data and backing resources in one Studio surface.
            </p>
          </div>
        </div>
      </header>
      <div className="ui-panel__section-body ui-stack">
        <form
          className="asset-studio__saved-search"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <label>
            Search saved assets
            <input
              type="search"
              disabled={busy}
              value={text}
              onChange={(event) => setText(event.currentTarget.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            Search
          </button>
        </form>
        <TransientNotificationPublisher message={error} title="Saved assets need attention" tone="error" source="Asset Studio" workspaceId={workspaceId} />
        {itemCount ? (
          <div className="asset-studio__saved-grid">
            {drafts.map((draft) => (
              <SavedDraftCard
                key={draft.draftId}
                displayName={draft.displayName}
                identity={`${draft.definitionRef.id}@${draft.definitionRef.version}`}
                status={draft.status}
                assetType={draft.assetType}
                resourceCount={draft.resourceCount}
                revision={String(draft.revision)}
                disabled={busy}
                onOpen={() => { if (mountedRef.current && !busy && readOwner.current === undefined && actionOwner.current === undefined) onOpenDraft(String(draft.draftId)); }}
              />
            ))}
            {visibleLegacyDrafts.map((draft) => (
              <SavedDraftCard
                key={draft.draftId}
                displayName={legacyString(
                  draft.draftEditableValues["display-name"],
                  draft.baseAssetReference?.label ?? "Saved asset",
                )}
                identity={`Legacy draft ${draft.draftId}`}
                status={draft.status}
                assetType={legacyAssetType(
                  legacyString(
                    draft.draftEditableValues.classification,
                    "component-asset",
                  ),
                )}
                resourceCount={DEFAULT_RESOURCES.length}
                revision="legacy"
                disabled={busy}
                onOpen={() => void openLegacyDraft(draft)}
              />
            ))}
          </div>
        ) : busy ? (
          <p className="ui-status" role="status">
            Loading saved assets.
          </p>
        ) : (
          <EmptyState
            title={listingKnown ? "No saved assets" : "Load saved assets"}
            description={listingKnown ? "Save an unpublished asset in Studio and it will appear here." : "Use Search to reload the list."}
            icon="save"
            compact
          />
        )}
      </div>
    </section>
  );
}

function SavedDraftCard({
  displayName,
  identity,
  status,
  assetType,
  resourceCount,
  revision,
  disabled,
  onOpen,
}: {
  readonly displayName: string;
  readonly identity: string;
  readonly status: string;
  readonly assetType: string;
  readonly resourceCount: number;
  readonly revision: string;
  readonly disabled: boolean;
  readonly onOpen: () => void;
}) {
  return (
    <article className="ui-card asset-studio__saved-card">
      <div>
        <span className="ui-badge">{status}</span>
        <h3>{displayName}</h3>
        <p className="ui-text-muted">{identity}</p>
      </div>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>{assetType}</dd>
        </div>
        <div>
          <dt>Backing resources</dt>
          <dd>{resourceCount}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{revision}</dd>
        </div>
      </dl>
      <button type="button" disabled={disabled} onClick={onOpen}>
        <ApplicationIcon name="settings" />
        <span>Open in Studio</span>
      </button>
    </article>
  );
}
