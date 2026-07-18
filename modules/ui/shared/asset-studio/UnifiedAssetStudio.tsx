import { useEffect, useState } from "react";

import {
  ASSET_FAMILIES,
  ASSET_TYPES,
  normalizeAssetId,
  type AssetFamily,
  type AssetType,
} from "../../../contracts/asset";
import type { AuthoredAssetDraftRecord } from "../../../contracts/asset-authoring";
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

export function AssetStudioWorkspace({
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

  useEffect(() => {
    let active = true;
    setError(undefined);
    setNotice(undefined);
    setDirty(false);
    setRecord(undefined);

    if (!initialDraftId) {
      setEditor(createAssetStudioEditorState());
      setBusy(false);
      return () => {
        active = false;
      };
    }

    setBusy(true);
    void client
      .readAssetDraft({
        workspaceId: workspaceId as never,
        draftId: initialDraftId as never,
      })
      .then((result) => {
        if (!active) return;
        if (result.ok) {
          setEditor(createAssetStudioEditorState(result.value));
          setRecord(result.value.record);
          setNotice(
            "Saved draft reopened with its semantic data and backing resources.",
          );
        } else {
          setError(result.error.message);
        }
        setBusy(false);
      });

    return () => {
      active = false;
    };
  }, [client, initialDraftId, workspaceId]);

  const change = <K extends keyof AssetStudioEditorState>(
    key: K,
    value: AssetStudioEditorState[K],
  ) => {
    setEditor((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setNotice(undefined);
  };

  const changeJson = (field: JsonField, value: string) => {
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

    setBusy(true);
    const result = record
      ? await client.updateAssetDraft({
          workspaceId: workspaceId as never,
          draftId: record.draftId,
          expectedRevision: record.revision,
          semanticDefinition,
          resources: editor.resources,
        })
      : await client.createAssetDraft({
          workspaceId: workspaceId as never,
          definitionRef: {
            kind: "asset-definition-version",
            id: editor.definitionId.trim() as never,
            version: editor.definitionVersion.trim(),
          },
          semanticDefinition,
          resources: editor.resources,
        });

    if (result.ok) {
      setRecord(result.value);
      setDirty(false);
      setNotice(
        record
          ? "Draft saved. Any prior review was invalidated when content changed."
          : "Draft saved without publishing or executing it.",
      );
    } else {
      setError(result.error.message);
    }
    setBusy(false);
  };

  const transition = async (action: "review" | "publish" | "abandon") => {
    if (!record) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const command = {
      workspaceId: workspaceId as never,
      draftId: record.draftId,
      expectedRevision: record.revision,
    };
    const result =
      action === "review"
        ? await client.reviewAssetDraft(command)
        : action === "publish"
          ? await client.publishAssetDraft(command)
          : await client.abandonAssetDraft(command);
    if (result.ok) {
      setRecord(result.value);
      setNotice(
        action === "review"
          ? "Review snapshot created. Publish remains a separate explicit action."
          : action === "publish"
            ? "Asset definition published; implementation activation and execution remain separate."
            : "Draft abandoned without publishing it.",
      );
    } else {
      setError(result.error.message);
    }
    setBusy(false);
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
                  disabled={Boolean(record)}
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
                  disabled={Boolean(record)}
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
                className="ui-button--secondary"
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
                className="ui-button--secondary"
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
                className="ui-button--secondary"
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
            {dirty && record ? (
              <p className="ui-status">
                Unsaved changes must be saved before review or publication.
              </p>
            ) : null}
          </WorkflowStep>
        </WorkflowSequence>
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
          className="ui-button--secondary"
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
        className="ui-button--secondary"
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

export function SavedAssetDrafts({
  workspaceId,
  client,
  legacyClient,
  onOpenDraft,
}: SavedAssetDraftsProps) {
  const [drafts, setDrafts] = useState<readonly AssetStudioAssetDraftSummary[]>(
    [],
  );
  const [legacyDrafts, setLegacyDrafts] = useState<
    readonly AuthoredAssetDraftRecord[]
  >([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();

  const applyListings = (
    studioResult: Awaited<ReturnType<AssetStudioClient["listAssetDrafts"]>>,
    legacyResult:
      Awaited<ReturnType<LegacyAssetDraftClient["listDrafts"]>> | undefined,
  ) => {
    if (studioResult.ok) setDrafts(studioResult.value.drafts);
    else setError(studioResult.error.message);
    if (legacyResult?.ok) setLegacyDrafts(legacyResult.value.items);
    else if (legacyResult) setError(legacyResult.error.message);
  };

  const load = async (searchText = text) => {
    setBusy(true);
    setError(undefined);
    const [studioResult, legacyResult] = await Promise.all([
      client.listAssetDrafts({
        workspaceId: workspaceId as never,
        unpublishedOnly: true,
        text: searchText.trim() || undefined,
      }),
      legacyClient?.listDrafts(workspaceId),
    ]);
    applyListings(studioResult, legacyResult);
    setBusy(false);
  };

  useEffect(() => {
    let active = true;
    setBusy(true);
    void Promise.all([
      client.listAssetDrafts({
        workspaceId: workspaceId as never,
        unpublishedOnly: true,
      }),
      legacyClient?.listDrafts(workspaceId),
    ]).then(([studioResult, legacyResult]) => {
      if (!active) return;
      applyListings(studioResult, legacyResult);
      setBusy(false);
    });
    return () => {
      active = false;
    };
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
    const converted = drafts.find(
      (candidate) =>
        String(candidate.sourceLegacyDraftId ?? "") === String(draft.draftId),
    );
    if (converted) {
      onOpenDraft(String(converted.draftId));
      return;
    }
    setBusy(true);
    setError(undefined);
    const result = await client.createAssetDraft({
      workspaceId: workspaceId as never,
      ...createStudioSeedFromLegacyDraft(draft),
    });
    if (result.ok) onOpenDraft(String(result.value.draftId));
    else setError(result.error.message);
    setBusy(false);
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
              value={text}
              onChange={(event) => setText(event.currentTarget.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            Search
          </button>
        </form>
        {error ? (
          <p className="ui-status ui-status--error" role="alert">
            {error}
          </p>
        ) : null}
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
                onOpen={() => onOpenDraft(String(draft.draftId))}
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
            title="No saved assets"
            description="Save an unpublished asset in Studio and it will appear here."
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
