import type {
  AssetAiContext,
  AssetConfigurationField,
  AssetConfigurationValues,
  AssetDefinition,
  AssetPackAssetEntry,
  AssetPort,
  AssetType,
} from "../../../../../contracts/asset";

import {
  SYSTEM_FOUNDATION_PACK_ID,
  SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
  SYSTEM_FOUNDATION_PACK_VERSION,
} from "../system-foundation-pack.constants";

const VERSION = "1.0.0";

type FunctionalDefaultCategory =
  | "data-modeling"
  | "security-policy"
  | "artifact-preview"
  | "ai-context"
  | "logic-workflow"
  | "test-observability"
  | "reference-features";

interface FunctionalDefaultSpec {
  readonly id: string;
  readonly assetType: AssetType;
  readonly family: AssetDefinition["assetFamily"];
  readonly category: FunctionalDefaultCategory;
  readonly displayName: string;
  readonly description: string;
  readonly fields?: readonly AssetConfigurationField[];
  readonly defaults?: AssetConfigurationValues;
  readonly dependencies?: readonly string[];
  readonly tags: readonly string[];
  readonly failClosed?: boolean;
}

const stringField = (
  fieldId: string,
  label: string,
  required = false,
  defaultValue = "",
): AssetConfigurationField => ({
  fieldId,
  valueKind: "string",
  label,
  required,
  defaultValue,
  uiHint: { hintKind: "text" },
});

const booleanField = (
  fieldId: string,
  label: string,
  defaultValue: boolean,
): AssetConfigurationField => ({
  fieldId,
  valueKind: "boolean",
  label,
  required: false,
  defaultValue,
  uiHint: { hintKind: "checkbox" },
});

const textAreaField = (
  fieldId: string,
  label: string,
  required: boolean,
  defaultValue: string,
  maximumLength = 4000,
): AssetConfigurationField => ({
  fieldId,
  valueKind: "string",
  label,
  required,
  defaultValue,
  constraints: [{ constraintKind: "max-length", value: maximumLength }],
  uiHint: { hintKind: "textarea" },
});

const numberField = (
  fieldId: string,
  label: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
  integer = false,
): AssetConfigurationField => ({
  fieldId,
  valueKind: integer ? "integer" : "number",
  label,
  required: true,
  defaultValue,
  constraints: [
    { constraintKind: "min", value: minimum },
    { constraintKind: "max", value: maximum },
  ],
  uiHint: { hintKind: "number" },
});

const enumField = (
  fieldId: string,
  label: string,
  values: readonly string[],
  defaultValue: string,
): AssetConfigurationField => ({
  fieldId,
  valueKind: "enum",
  label,
  required: true,
  defaultValue,
  options: values.map((value) => ({ value, label: value })),
  uiHint: { hintKind: "select" },
});
const jsonField = (
  fieldId: string,
  label: string,
  required = false,
): AssetConfigurationField => ({
  fieldId,
  valueKind: "json",
  label,
  required,
  uiHint: { hintKind: "json-editor" },
});

const specs: readonly FunctionalDefaultSpec[] = [
  {
    id: "builtin.data.scalar-type",
    assetType: "schema",
    family: "structural",
    category: "data-modeling",
    displayName: "Scalar Data Type",
    description:
      "Portable scalar data type declaration with format and nullability constraints.",
    fields: [
      stringField("typeName", "Type", true, "string"),
      stringField("format", "Format"),
      booleanField("nullable", "Nullable", false),
    ],
    defaults: { typeName: "string", format: "", nullable: false },
    tags: ["data", "type"],
  },
  {
    id: "builtin.data.entity",
    assetType: "schema",
    family: "composition",
    category: "data-modeling",
    displayName: "Data Entity",
    description:
      "Named entity composed from typed fields and explicit relationships.",
    fields: [
      stringField("name", "Entity name", true, "Record"),
      stringField("description", "Description"),
    ],
    defaults: { name: "Record", description: "" },
    dependencies: ["builtin.data.field"],
    tags: ["data", "entity"],
  },
  {
    id: "builtin.data.field",
    assetType: "schema",
    family: "structural",
    category: "data-modeling",
    displayName: "Data Field",
    description:
      "Named field with a portable type, required state, and validation relationship.",
    fields: [
      stringField("name", "Field name", true, "name"),
      stringField("label", "Label", true, "Name"),
      stringField("type", "Field type", true, "text"),
      booleanField("required", "Required", false),
      jsonField("enumValues", "Enum values"),
      jsonField("minimum", "Minimum"),
      jsonField("maximum", "Maximum"),
      jsonField("maximumLength", "Maximum length"),
      stringField("relationshipEntity", "Relationship entity"),
      booleanField("protected", "Protected", false),
    ],
    defaults: {
      name: "name",
      label: "Name",
      type: "text",
      required: false,
      enumValues: [],
      protected: false,
    },
    dependencies: ["builtin.data.scalar-type"],
    tags: ["data", "field"],
  },
  {
    id: "builtin.data.relationship",
    assetType: "schema",
    family: "structural",
    category: "data-modeling",
    displayName: "Data Relationship",
    description:
      "Explicit relationship between two entity definitions with cardinality metadata.",
    fields: [
      stringField("name", "Relationship name", true, "relatedRecords"),
      stringField("cardinality", "Cardinality", true, "many"),
    ],
    defaults: { name: "relatedRecords", cardinality: "many" },
    dependencies: ["builtin.data.entity"],
    tags: ["data", "relationship"],
  },
  {
    id: "builtin.data.validation-rule",
    assetType: "policy",
    family: "behavioral",
    category: "data-modeling",
    displayName: "Data Validation Rule",
    description:
      "Finite declarative validation rule with a safe user-facing failure message.",
    fields: [
      stringField("rule", "Rule", true, "required"),
      stringField(
        "message",
        "Failure message",
        true,
        "This value is required.",
      ),
    ],
    defaults: { rule: "required", message: "This value is required." },
    tags: ["data", "validation"],
    failClosed: true,
  },
  {
    id: "builtin.data.query",
    assetType: "data-source",
    family: "behavioral",
    category: "data-modeling",
    displayName: "Bounded Data Query",
    description:
      "Declarative filter, sort, and page request executed only through authorized data capabilities.",
    fields: [
      jsonField("filter", "Filter"),
      stringField("sort", "Sort"),
      stringField("pageSize", "Page size", false, "25"),
    ],
    defaults: { filter: {}, sort: "", pageSize: "25" },
    tags: ["data", "query"],
    failClosed: true,
  },
  {
    id: "builtin.data.binding",
    assetType: "adapter-binding",
    family: "structural",
    category: "data-modeling",
    displayName: "Data Binding",
    description:
      "Typed binding between a data output and a compatible consumer input.",
    fields: [
      stringField("sourcePort", "Source port", true, "records"),
      stringField("targetPort", "Target port", true, "data"),
    ],
    defaults: { sourcePort: "records", targetPort: "data" },
    tags: ["data", "binding"],
  },
  {
    id: "builtin.data.create-operation",
    assetType: "tool",
    family: "behavioral",
    category: "data-modeling",
    displayName: "Create Record Operation",
    description:
      "Host-owned authorized record creation action over one release-bound entity.",
    fields: [stringField("entity", "Entity", true, "Record")],
    defaults: { entity: "Record" },
    dependencies: [
      "builtin.data.entity",
      "builtin.data.validation-rule",
      "builtin.security.authorization-policy",
      "builtin.security.audit-event",
    ],
    tags: ["data", "create", "operation"],
    failClosed: true,
  },
  {
    id: "builtin.data.read-operation",
    assetType: "tool",
    family: "behavioral",
    category: "data-modeling",
    displayName: "Read Record Operation",
    description:
      "Host-owned authorized record read action with masking applied before projection.",
    fields: [stringField("entity", "Entity", true, "Record")],
    defaults: { entity: "Record" },
    dependencies: [
      "builtin.data.entity",
      "builtin.security.authorization-policy",
      "builtin.security.field-mask",
      "builtin.security.audit-event",
    ],
    tags: ["data", "read", "operation"],
    failClosed: true,
  },
  {
    id: "builtin.data.update-operation",
    assetType: "tool",
    family: "behavioral",
    category: "data-modeling",
    displayName: "Update Record Operation",
    description:
      "Host-owned authorized optimistic record update action over validated values.",
    fields: [stringField("entity", "Entity", true, "Record")],
    defaults: { entity: "Record" },
    dependencies: [
      "builtin.data.entity",
      "builtin.data.validation-rule",
      "builtin.security.authorization-policy",
      "builtin.security.audit-event",
    ],
    tags: ["data", "update", "operation"],
    failClosed: true,
  },
  {
    id: "builtin.data.list-operation",
    assetType: "tool",
    family: "behavioral",
    category: "data-modeling",
    displayName: "List Records Operation",
    description:
      "Host-owned authorized bounded record list action with field masking.",
    fields: [
      stringField("entity", "Entity", true, "Record"),
      stringField("maximumPageSize", "Maximum page size", false, "100"),
    ],
    defaults: { entity: "Record", maximumPageSize: "100" },
    dependencies: [
      "builtin.data.entity",
      "builtin.data.query",
      "builtin.security.authorization-policy",
      "builtin.security.field-mask",
      "builtin.security.audit-event",
    ],
    tags: ["data", "list", "operation"],
    failClosed: true,
  },

  {
    id: "builtin.security.authentication-requirement",
    assetType: "policy",
    family: "behavioral",
    category: "security-policy",
    displayName: "Authentication Requirement",
    description:
      "Fail-closed requirement that a verified principal be present before a protected action.",
    fields: [booleanField("required", "Authentication required", true)],
    defaults: { required: true },
    tags: ["security", "authentication"],
    failClosed: true,
  },
  {
    id: "builtin.security.authorization-policy",
    assetType: "policy",
    family: "behavioral",
    category: "security-policy",
    displayName: "Authorization Policy",
    description:
      "Fail-closed allowlist policy that can narrow but never expand platform authority.",
    fields: [
      jsonField("allowedRoles", "Allowed roles", true),
      stringField("action", "Action", true, "read"),
    ],
    defaults: { allowedRoles: [], action: "read" },
    tags: ["security", "authorization"],
    failClosed: true,
  },
  {
    id: "builtin.security.permission-check",
    assetType: "policy",
    family: "behavioral",
    category: "security-policy",
    displayName: "Permission Check",
    description:
      "Explicit permission decision point that denies when evidence is absent or invalid.",
    fields: [stringField("permission", "Permission", true, "resource:read")],
    defaults: { permission: "resource:read" },
    tags: ["security", "permission"],
    failClosed: true,
  },
  {
    id: "builtin.security.audit-event",
    assetType: "schema",
    family: "context",
    category: "security-policy",
    displayName: "Audit Event",
    description:
      "Structured security-relevant event declaration with bounded safe metadata.",
    fields: [
      stringField("eventType", "Event type", true, "resource.read"),
      stringField("outcome", "Outcome", true, "denied"),
    ],
    defaults: { eventType: "resource.read", outcome: "denied" },
    tags: ["security", "audit"],
    failClosed: true,
  },
  {
    id: "builtin.security.field-mask",
    assetType: "policy",
    family: "behavioral",
    category: "security-policy",
    displayName: "Field Mask Policy",
    description:
      "Fail-closed field projection policy that removes protected values unless the principal has an allowlisted role.",
    fields: [
      jsonField("protectedFields", "Protected fields", true),
      jsonField("visibleToRoles", "Visible to roles", true),
    ],
    defaults: { protectedFields: [], visibleToRoles: [] },
    tags: ["security", "masking", "field"],
    failClosed: true,
  },
  {
    id: "builtin.security.artifact-read-policy",
    assetType: "policy",
    family: "behavioral",
    category: "security-policy",
    displayName: "Artifact Read Policy",
    description:
      "Narrowing policy for authenticated, bounded artifact browse, detail, and preview operations.",
    fields: [
      jsonField("allowedRoles", "Allowed roles", true),
      jsonField("allowedMediaTypes", "Allowed media types", true),
      numberField("maximumListItems", "Maximum list items", 100, 1, 200, true),
      numberField(
        "maximumPreviewBytes",
        "Maximum preview size",
        2097152,
        1024,
        8388608,
        true,
      ),
    ],
    defaults: {
      allowedRoles: [],
      allowedMediaTypes: [],
      maximumListItems: 100,
      maximumPreviewBytes: 2097152,
    },
    dependencies: [
      "builtin.security.authentication-requirement",
      "builtin.security.field-mask",
      "builtin.security.audit-event",
    ],
    tags: ["security", "artifact", "read", "bounded"],
    failClosed: true,
  },

  {
    id: "builtin.preview.artifact",
    assetType: "ui-component",
    family: "composition",
    category: "artifact-preview",
    displayName: "Artifact Preview",
    description:
      "Safe artifact preview with loading, empty, error, and unsupported states.",
    fields: [
      stringField("title", "Title", false, "Artifact preview"),
      stringField("mediaType", "Media type"),
    ],
    defaults: { title: "Artifact preview", mediaType: "" },
    dependencies: [
      "builtin.display.resource-preview-placeholder",
      "builtin.state.loading-state",
      "builtin.state.error-state",
    ],
    tags: ["artifact", "preview"],
  },
  {
    id: "builtin.preview.data",
    assetType: "ui-component",
    family: "composition",
    category: "artifact-preview",
    displayName: "Data Preview",
    description:
      "Bounded tabular preview for authorized data descriptors and rows.",
    fields: [
      stringField("title", "Title", false, "Data preview"),
      stringField("maxRows", "Maximum rows", false, "25"),
    ],
    defaults: { title: "Data preview", maxRows: "25" },
    dependencies: [
      "builtin.display.table",
      "builtin.state.empty-state",
      "builtin.state.error-state",
    ],
    tags: ["data", "preview"],
  },
  {
    id: "builtin.preview.text",
    assetType: "ui-component",
    family: "composition",
    category: "artifact-preview",
    displayName: "Bounded Text Preview",
    description:
      "Plain-text and Markdown source preview with explicit size, line, and character ceilings.",
    fields: [
      numberField("maximumLines", "Maximum lines", 80, 1, 200, true),
      numberField(
        "maximumCharacters",
        "Maximum characters",
        16000,
        1,
        32000,
        true,
      ),
    ],
    defaults: { maximumLines: 80, maximumCharacters: 16000 },
    dependencies: ["builtin.preview.artifact"],
    tags: ["text", "preview", "bounded"],
  },
  {
    id: "builtin.preview.table",
    assetType: "ui-component",
    family: "composition",
    category: "artifact-preview",
    displayName: "Bounded Table Preview",
    description:
      "Native tabular preview for a finite CSV or JSON sample with bounded rows, columns, and cells.",
    fields: [
      numberField("maximumRows", "Maximum rows", 25, 1, 100, true),
      numberField("maximumColumns", "Maximum columns", 20, 1, 50, true),
    ],
    defaults: { maximumRows: 25, maximumColumns: 20 },
    dependencies: ["builtin.display.table", "builtin.preview.artifact"],
    tags: ["table", "preview", "bounded"],
  },
  {
    id: "builtin.preview.raster-image",
    assetType: "ui-component",
    family: "composition",
    category: "artifact-preview",
    displayName: "Raster Image Preview",
    description:
      "Constrained preview intent for allowlisted raster image types with alternate text and no SVG execution surface.",
    fields: [
      stringField(
        "altText",
        "Alternate text",
        false,
        "Selected artifact preview",
      ),
    ],
    defaults: { altText: "Selected artifact preview" },
    dependencies: [
      "builtin.display.image-preview-placeholder",
      "builtin.preview.artifact",
    ],
    tags: ["image", "raster", "preview"],
  },
  {
    id: "builtin.preview.pdf",
    assetType: "ui-component",
    family: "composition",
    category: "artifact-preview",
    displayName: "Sandboxed PDF Preview",
    description:
      "Constrained first-page PDF preview intent rendered only through an authorized, titled, sandboxed frame.",
    fields: [stringField("title", "Frame title", false, "PDF preview")],
    defaults: { title: "PDF preview" },
    dependencies: [
      "builtin.display.resource-preview-placeholder",
      "builtin.preview.artifact",
    ],
    tags: ["pdf", "preview", "sandboxed"],
  },
  {
    id: "builtin.preview.unsupported",
    assetType: "ui-component",
    family: "composition",
    category: "artifact-preview",
    displayName: "Unsupported Preview State",
    description:
      "Safe placeholder for recognized content that has no accepted in-app parser or renderer.",
    fields: [
      stringField(
        "message",
        "Message",
        true,
        "This file type does not have a safe in-app preview.",
      ),
    ],
    defaults: {
      message: "This file type does not have a safe in-app preview.",
    },
    dependencies: ["builtin.display.resource-preview-placeholder"],
    tags: ["preview", "unsupported", "safe"],
    failClosed: true,
  },

  {
    id: "builtin.ai.model-reference",
    assetType: "model",
    family: "context",
    category: "ai-context",
    displayName: "AI Model Reference",
    description:
      "Safe reference to a registered model and its declared capabilities.",
    fields: [
      stringField("modelRef", "Model reference", true, "model.default"),
      stringField("capability", "Capability", true, "text-generation"),
    ],
    defaults: { modelRef: "model.default", capability: "text-generation" },
    tags: ["ai", "model"],
  },
  {
    id: "builtin.ai.context-source",
    assetType: "schema",
    family: "context",
    category: "ai-context",
    displayName: "AI Context Source",
    description:
      "Bounded context-source declaration with sensitivity and inclusion guidance.",
    fields: [
      stringField("name", "Context name", true, "Instructions"),
      stringField("sensitivity", "Sensitivity", true, "internal"),
    ],
    defaults: { name: "Instructions", sensitivity: "internal" },
    tags: ["ai", "context"],
    failClosed: true,
  },
  {
    id: "builtin.ai.instruction-template",
    assetType: "schema",
    family: "context",
    category: "ai-context",
    displayName: "Protected Instruction Template",
    description:
      "Bounded assistant instruction content kept behind protected build and runtime context boundaries.",
    fields: [
      textAreaField(
        "instruction",
        "Instruction",
        true,
        "Answer clearly and state when information is unavailable.",
      ),
      stringField("sensitivity", "Sensitivity", true, "internal"),
    ],
    defaults: {
      instruction: "Answer clearly and state when information is unavailable.",
      sensitivity: "internal",
    },
    tags: ["ai", "instruction", "protected"],
    failClosed: true,
  },
  {
    id: "builtin.ai.generation-settings",
    assetType: "schema",
    family: "context",
    category: "ai-context",
    displayName: "Bounded Generation Settings",
    description:
      "Finite text-generation controls validated before a supported runtime invocation.",
    fields: [
      numberField("temperature", "Temperature", 0.2, 0, 2),
      numberField(
        "maximumResponseUnits",
        "Maximum response units",
        512,
        1,
        4096,
        true,
      ),
    ],
    defaults: { temperature: 0.2, maximumResponseUnits: 512 },
    tags: ["ai", "generation", "bounded"],
    failClosed: true,
  },
  {
    id: "builtin.security.conversation-policy",
    assetType: "policy",
    family: "behavioral",
    category: "security-policy",
    displayName: "Conversation Execution Policy",
    description:
      "Narrowing policy for authenticated text-generation sessions with finite input and disabled undeclared capabilities.",
    fields: [
      jsonField("allowedRoles", "Allowed roles", true),
      numberField(
        "maximumInputCharacters",
        "Maximum input characters",
        4000,
        1,
        16000,
        true,
      ),
      booleanField(
        "allowContextSources",
        "Allow verified context sources",
        false,
      ),
      enumField("toolsMode", "Tools", ["disabled"], "disabled"),
    ],
    defaults: {
      allowedRoles: [],
      maximumInputCharacters: 4000,
      allowContextSources: false,
      toolsMode: "disabled",
    },
    tags: ["security", "conversation", "policy"],
    failClosed: true,
  },
  {
    id: "builtin.ai.controlled-inference-action",
    assetType: "tool",
    family: "behavioral",
    category: "ai-context",
    displayName: "Controlled Text Generation Action",
    description:
      "Host-owned text-generation request that requires reviewed execution-plan, readiness, approval, policy, and runtime-adapter evidence.",
    fields: [
      stringField("capability", "Capability", true, "text-generation"),
      stringField("onUnsupported", "Unsupported state", true, "unsupported"),
      stringField("onFailure", "Failure state", true, "error"),
    ],
    defaults: {
      capability: "text-generation",
      onUnsupported: "unsupported",
      onFailure: "error",
    },
    dependencies: [
      "builtin.ai.model-reference",
      "builtin.ai.instruction-template",
      "builtin.ai.generation-settings",
      "builtin.security.conversation-policy",
      "conversation.text-generation-runtime-requirement",
    ],
    tags: ["ai", "inference", "controlled"],
    failClosed: true,
  },
  {
    id: "builtin.ai.safe-fallback",
    assetType: "workflow-step",
    family: "behavioral",
    category: "ai-context",
    displayName: "Safe Conversation Fallback",
    description:
      "User-safe fallback declaration that does not expose runtime, provider, prompt, or protected context details.",
    fields: [
      stringField(
        "message",
        "Fallback message",
        true,
        "This assistant cannot respond right now.",
      ),
    ],
    defaults: { message: "This assistant cannot respond right now." },
    dependencies: ["builtin.state.error-state"],
    tags: ["ai", "fallback", "safe"],
    failClosed: true,
  },

  {
    id: "builtin.logic.condition",
    assetType: "workflow-step",
    family: "behavioral",
    category: "logic-workflow",
    displayName: "Condition",
    description:
      "Finite declarative comparison that selects a named branch without evaluating source code.",
    fields: [
      stringField("operator", "Operator", true, "equals"),
      jsonField("expected", "Expected value"),
    ],
    defaults: { operator: "equals", expected: true },
    tags: ["logic", "condition"],
  },
  {
    id: "builtin.logic.mapping",
    assetType: "workflow-step",
    family: "behavioral",
    category: "logic-workflow",
    displayName: "Data Mapping",
    description:
      "Finite field-to-field mapping declaration without arbitrary expressions.",
    fields: [jsonField("mappings", "Mappings", true)],
    defaults: { mappings: {} },
    tags: ["logic", "mapping"],
  },
  {
    id: "builtin.logic.branch",
    assetType: "workflow-step",
    family: "composition",
    category: "logic-workflow",
    displayName: "Workflow Branch",
    description:
      "Explicit finite branch composed from conditions and named workflow steps.",
    fields: [
      stringField("trueStep", "True step", true),
      stringField("falseStep", "False step", true),
    ],
    defaults: { trueStep: "", falseStep: "" },
    dependencies: ["builtin.logic.condition"],
    tags: ["logic", "branch"],
  },
  {
    id: "builtin.workflow.record-crud",
    assetType: "workflow",
    family: "composition",
    category: "logic-workflow",
    displayName: "Record CRUD Workflow",
    description:
      "Finite create/read/update/list workflow over approved host-owned data actions with validation, authorization, audit, and bounded error paths.",
    fields: [
      stringField("entity", "Entity", true, "Record"),
      stringField("onDenied", "Denied state", true, "authorization-denied"),
      stringField("onError", "Error state", true, "error"),
    ],
    defaults: {
      entity: "Record",
      onDenied: "authorization-denied",
      onError: "error",
    },
    dependencies: [
      "builtin.data.create-operation",
      "builtin.data.read-operation",
      "builtin.data.update-operation",
      "builtin.data.list-operation",
      "builtin.security.authorization-policy",
      "builtin.security.audit-event",
    ],
    tags: ["workflow", "crud", "record"],
    failClosed: true,
  },

  {
    id: "builtin.test.fixture",
    assetType: "test",
    family: "context",
    category: "test-observability",
    displayName: "Test Fixture",
    description:
      "Bounded deterministic test input and expected-output declaration.",
    fields: [
      jsonField("input", "Input", true),
      jsonField("expected", "Expected", true),
    ],
    defaults: { input: {}, expected: {} },
    tags: ["test", "fixture"],
  },
  {
    id: "builtin.test.mock-data",
    assetType: "test",
    family: "context",
    category: "test-observability",
    displayName: "Mock Data",
    description:
      "Clearly labeled non-production records for previews and contract tests.",
    fields: [jsonField("records", "Records", true)],
    defaults: { records: [] },
    tags: ["test", "mock"],
  },
  {
    id: "builtin.test.assertion",
    assetType: "test",
    family: "behavioral",
    category: "test-observability",
    displayName: "Assertion",
    description:
      "Finite declarative assertion over a named output and expected value.",
    fields: [
      stringField("path", "Output path", true),
      stringField("operator", "Operator", true, "equals"),
      jsonField("expected", "Expected value"),
    ],
    defaults: { path: "", operator: "equals", expected: true },
    tags: ["test", "assertion"],
  },
  {
    id: "builtin.observability.event",
    assetType: "schema",
    family: "context",
    category: "test-observability",
    displayName: "Observability Event",
    description:
      "Structured and bounded operational event declaration with safe metadata.",
    fields: [
      stringField("name", "Event name", true, "system.operation"),
      stringField("level", "Level", true, "info"),
    ],
    defaults: { name: "system.operation", level: "info" },
    tags: ["observability", "event"],
  },

  {
    id: "builtin.feature.record-form",
    assetType: "feature",
    family: "composition",
    category: "reference-features",
    displayName: "Record Form",
    description:
      "Composable accessible create/edit form assembled from entity, field, validation, form, and action assets.",
    fields: [
      stringField("title", "Title", false, "Record details"),
      stringField("submitLabel", "Submit label", false, "Save"),
    ],
    defaults: { title: "Record details", submitLabel: "Save" },
    dependencies: [
      "builtin.data.entity",
      "builtin.form.form",
      "builtin.form.field-group",
      "builtin.form.text-field",
      "builtin.form.validation-message",
      "builtin.form.submit-action",
    ],
    tags: ["feature", "form", "reference"],
  },
  {
    id: "builtin.feature.data-preview",
    assetType: "feature",
    family: "composition",
    category: "reference-features",
    displayName: "Data Preview Feature",
    description:
      "Composable data review feature assembled from a bounded query, data binding, preview, and state assets.",
    fields: [stringField("title", "Title", false, "Data preview")],
    defaults: { title: "Data preview" },
    dependencies: [
      "builtin.data.query",
      "builtin.data.binding",
      "builtin.preview.data",
      "builtin.state.loading-state",
      "builtin.state.empty-state",
      "builtin.state.error-state",
    ],
    tags: ["feature", "data", "preview", "reference"],
  },
];

export const FUNCTIONAL_DEFAULT_DEFINITIONS: readonly AssetDefinition[] =
  specs.map(createDefinition);

export const FUNCTIONAL_DEFAULT_ENTRIES: readonly AssetPackAssetEntry[] =
  FUNCTIONAL_DEFAULT_DEFINITIONS.map((definition) => {
    const category = String(definition.metadata?.categoryId);
    return {
      entryId: `system.foundation.${String(definition.definitionId).replace(/^builtin\./, "")}`,
      definition,
      definitionRef: {
        kind: "asset-definition-version",
        id: String(definition.definitionId) as never,
        version: definition.version,
        label: definition.displayName,
      },
      category,
      sourceLayer: SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
      fingerprint: fingerprint(definition),
      tags: ["foundation", category],
      metadata: {
        sourcePack: {
          packId: SYSTEM_FOUNDATION_PACK_ID,
          version: SYSTEM_FOUNDATION_PACK_VERSION,
        },
        categoryId: category,
        builtIn: true,
        systemOwned: true,
        functionalDefault: true,
      },
    };
  });

function createDefinition(spec: FunctionalDefaultSpec): AssetDefinition {
  const dependencies = spec.dependencies ?? [];
  return {
    definitionId: spec.id,
    assetType: spec.assetType,
    assetFamily: spec.family,
    version: VERSION,
    displayName: spec.displayName,
    description: spec.description,
    lifecycleStatus: "published",
    reviewStatus: "approved",
    provenance: {
      sourceKind: "system-generated",
      authorship: "human-authored",
      metadata: sourceMetadata(spec.category),
    },
    configurationSchema: {
      schemaId: `${spec.id}.configuration`,
      schemaVersion: VERSION,
      fields: spec.fields ?? [],
      requiredFieldIds: (spec.fields ?? [])
        .filter((field) => field.required)
        .map((field) => field.fieldId),
      strict: true,
      description: `${spec.displayName} portable declarative configuration.`,
      metadata: {
        categoryId: spec.category,
        schemaDialect: "asset-configuration.v1",
      },
    },
    defaultConfiguration: spec.defaults ?? {},
    aiContext: aiContext(spec),
    requirements: [
      {
        requirementId: `${spec.id}.thin-client-safe`,
        requirementKind: "thin-client-safety",
        required: false,
        safetyStatus: "safe",
        summary:
          "Descriptor and preview data are safe for shared desktop/thin-client rendering.",
      },
      ...(spec.failClosed
        ? [
            {
              requirementId: `${spec.id}.fail-closed`,
              requirementKind: "automation-safety" as const,
              required: true,
              safetyStatus: "requires-review" as const,
              summary:
                "Missing or invalid authorization, validation, or capability evidence must deny the operation.",
            },
          ]
        : []),
    ],
    ports: portsFor(spec),
    compositionRules: dependencies.length
      ? [
          {
            ruleId: `${spec.id}.dependencies`,
            ruleKind: "custom",
            description:
              "Uses exact system foundation dependencies through the shared AssetComposition graph.",
            metadata: { dependencyDefinitionIds: dependencies },
          },
        ]
      : [],
    metadata: {
      ...sourceMetadata(spec.category),
      builtIn: true,
      systemOwned: true,
      functionalDefault: true,
      dependencyDefinitionIds: dependencies,
      failClosed: Boolean(spec.failClosed),
      tags: spec.tags,
    },
  };
}

function aiContext(spec: FunctionalDefaultSpec): AssetAiContext {
  return {
    purpose: spec.description,
    userFacingSummary: `${spec.displayName} is a reusable system-default building block.`,
    developerFacingSummary: `${spec.displayName} is a host-neutral definition with typed configuration, ports, and composition guidance.`,
    capabilities: [
      {
        capabilityId: `${spec.id}.capability.declarative`,
        summary:
          "Provides typed configuration, ports, preview data, and composition guidance without embedded code.",
      },
    ],
    limitations: [
      {
        limitationId: `${spec.id}.limitation.no-authority`,
        summary:
          "Does not access data, models, protected values, networks, storage, or platform authority directly.",
      },
    ],
    inputSummary: {
      summary:
        "Accepts only values and typed bindings declared by this definition.",
    },
    outputSummary: {
      summary:
        "Produces only its declared typed output through a host-owned capability or renderer.",
    },
    configurationGuidance: {
      summary:
        "Use the schema-backed editor and keep values bounded and appropriate for the selected workspace.",
    },
    compositionGuidance: {
      summary:
        "Compose through AssetInstances and typed AssetBindings; do not bypass the shared composition graph.",
    },
    examples: [
      {
        exampleId: `${spec.id}.example.preview`,
        title: `${spec.displayName} preview`,
        description: `Preview ${spec.displayName} with the safe system fixture.`,
        configurationValues: spec.defaults ?? {},
        expectedOutcome:
          "A bounded accessible preview or declarative summary is produced without external side effects.",
      },
    ],
    safetyNotes: [
      {
        safetyNoteId: `${spec.id}.safety.platform-authority`,
        category: "runtime-execution",
        severity: spec.failClosed ? "warning" : "info",
        summary: spec.failClosed
          ? "This asset denies when required policy or validation evidence is missing and cannot weaken platform controls."
          : "Execution and resource access remain mediated by platform capabilities.",
      },
    ],
  };
}

function portsFor(spec: FunctionalDefaultSpec): readonly AssetPort[] {
  const contractKind =
    spec.assetType === "ui-component" || spec.assetType === "feature"
      ? "json"
      : "configuration";
  return [
    {
      portId: "input",
      direction: "input",
      displayName: "Input",
      contract: { contractKind, description: "Typed declarative input." },
      cardinality: { preset: "optional" },
    },
    {
      portId: "output",
      direction: "output",
      displayName: "Output",
      contract: { contractKind, description: "Typed declarative output." },
      cardinality: { preset: "optional" },
    },
  ];
}

function sourceMetadata(categoryId: string) {
  return {
    sourcePackId: SYSTEM_FOUNDATION_PACK_ID,
    sourcePackVersion: SYSTEM_FOUNDATION_PACK_VERSION,
    sourceLayer: SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
    categoryId,
  };
}

function fingerprint(definition: AssetDefinition): string {
  const value = JSON.stringify(definition);
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a:${hash.toString(16).padStart(8, "0")}`;
}
