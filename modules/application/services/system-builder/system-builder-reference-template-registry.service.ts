import type {
  AssetBinding,
  AssetConfigurationValues,
  AssetInstance,
  AssetReference,
} from "../../../contracts/asset";
import { normalizeAssetId } from "../../../contracts/asset";
import type {
  SystemBuilderTemplateId,
  SystemBuilderTemplateMaterialization,
  SystemBuilderTemplateSummary,
} from "../../../contracts/system-builder";
import {
  exactSystemFoundationDefinitionReference,
  SYSTEM_FOUNDATION_CURRENT_PACK_MANIFEST,
} from "../asset-packs/system-packs";

const SECURED_DATA_ENTRY_TEMPLATE: SystemBuilderTemplateSummary = {
  templateId: "reference.secured-data-entry@1.0.0",
  displayName: "Secured data-entry application",
  description:
    "A release-bound request form, record list and detail view, role policy, field masking, CRUD workflow, and safe audit trail.",
  version: "1.0.0",
  referenceSystemKind: "secured-data-entry",
};

const CONTROLLED_CHATBOT_TEMPLATE: SystemBuilderTemplateSummary = {
  templateId: "reference.controlled-chatbot@1.0.0",
  displayName: "Controlled chatbot",
  description:
    "A release-bound text assistant with protected instructions, bounded generation, explicit policy, approved execution, and safe user-visible states.",
  version: "1.0.0",
  referenceSystemKind: "controlled-chatbot",
};

const SECURED_DATA_REVIEW_TEMPLATE: SystemBuilderTemplateSummary = {
  templateId: "reference.secured-data-review@1.0.0",
  displayName: "Secured data review",
  description:
    "A release-bound artifact browser with bounded previews, narrowing read policy, metadata masking, and safe audit evidence.",
  version: "1.0.0",
  referenceSystemKind: "secured-data-review",
};

export interface MaterializeSystemBuilderTemplateInput {
  readonly systemId: string;
  readonly name: string;
  readonly actorId: string;
  readonly timestamp: string;
}

export class SystemBuilderReferenceTemplateRegistry {
  public list(): readonly SystemBuilderTemplateSummary[] {
    return [
      SECURED_DATA_ENTRY_TEMPLATE,
      CONTROLLED_CHATBOT_TEMPLATE,
      SECURED_DATA_REVIEW_TEMPLATE,
    ];
  }

  public materialize(
    templateId: SystemBuilderTemplateId,
    input: MaterializeSystemBuilderTemplateInput,
  ): SystemBuilderTemplateMaterialization | undefined {
    if (templateId === SECURED_DATA_ENTRY_TEMPLATE.templateId)
      return createSecuredDataEntryTemplate(input);
    if (templateId === CONTROLLED_CHATBOT_TEMPLATE.templateId)
      return createControlledChatbotTemplate(input);
    if (templateId === SECURED_DATA_REVIEW_TEMPLATE.templateId)
      return createSecuredDataReviewTemplate(input);
    return undefined;
  }
}

function createSecuredDataEntryTemplate(
  input: MaterializeSystemBuilderTemplateInput,
): SystemBuilderTemplateMaterialization {
  const compositionId = input.systemId + ".composition";
  const instance = (
    suffix: string,
    definitionId: string,
    displayName: string,
    selectedConfiguration: AssetConfigurationValues,
  ): AssetInstance => ({
    instanceId: input.systemId + "." + suffix,
    ...currentFoundationSelection(definitionId, selectedConfiguration),
    displayName,
    lifecycleStatus: "draft",
    parentCompositionRef: {
      kind: "asset-composition",
      id: normalizeAssetId(compositionId),
    },
    provenance: {
      sourceKind: "system-generated",
      createdAt: input.timestamp,
      createdBy: safeActor(input.actorId),
    },
    metadata: {
      referenceTemplateId: SECURED_DATA_ENTRY_TEMPLATE.templateId,
      referenceSystemKind: SECURED_DATA_ENTRY_TEMPLATE.referenceSystemKind,
    },
  });

  const instances: readonly AssetInstance[] = [
    instance("system", "builtin.system.system", "Secured data-entry system", {
      title: input.name,
    }),
    instance("navigation", "builtin.shell.navigation-group", "Navigation", {
      label: "Requests",
    }),
    instance("page", "builtin.shell.page", "Requests page", {
      title: "Service requests",
    }),
    instance(
      "authentication",
      "builtin.security.authentication-requirement",
      "Authentication required",
      { required: true },
    ),
    instance(
      "policy-create",
      "builtin.security.authorization-policy",
      "Create policy",
      { action: "create", allowedRoles: ["owner", "editor", "developer"] },
    ),
    instance(
      "policy-read",
      "builtin.security.authorization-policy",
      "Read policy",
      {
        action: "read",
        allowedRoles: ["owner", "editor", "viewer", "developer"],
      },
    ),
    instance(
      "policy-update",
      "builtin.security.authorization-policy",
      "Update policy",
      { action: "update", allowedRoles: ["owner", "editor", "developer"] },
    ),
    instance(
      "policy-list",
      "builtin.security.authorization-policy",
      "List policy",
      {
        action: "list",
        allowedRoles: ["owner", "editor", "viewer", "developer"],
      },
    ),
    instance("mask", "builtin.security.field-mask", "Confidential field mask", {
      protectedFields: ["confidentialNotes"],
      visibleToRoles: ["owner", "developer"],
    }),
    instance("entity", "builtin.data.entity", "Service request", {
      name: "service-request",
      description: "A secured service request record.",
    }),
    instance("field-title", "builtin.data.field", "Title field", {
      name: "title",
      label: "Title",
      type: "text",
      required: true,
      maximumLength: 120,
    }),
    instance("field-amount", "builtin.data.field", "Amount field", {
      name: "amount",
      label: "Amount",
      type: "number",
      required: true,
      minimum: 0,
      maximum: 1000000,
    }),
    instance("field-status", "builtin.data.field", "Status field", {
      name: "status",
      label: "Status",
      type: "enum",
      required: true,
      enumValues: ["draft", "submitted", "approved"],
    }),
    instance("field-due-date", "builtin.data.field", "Due date field", {
      name: "dueDate",
      label: "Due date",
      type: "date",
      required: true,
    }),
    instance("field-related", "builtin.data.field", "Related request field", {
      name: "relatedRequest",
      label: "Related request",
      type: "relationship",
      required: false,
      relationshipEntity: "service-request",
    }),
    instance(
      "field-confidential",
      "builtin.data.field",
      "Confidential notes field",
      {
        name: "confidentialNotes",
        label: "Confidential notes",
        type: "text",
        required: false,
        maximumLength: 500,
        protected: true,
      },
    ),
    instance("form", "builtin.form.form", "Request form", {
      title: "Request details",
    }),
    instance("title-input", "builtin.form.text-field", "Title input", {
      label: "Title",
      required: true,
    }),
    instance("amount-input", "builtin.form.number-field", "Amount input", {
      label: "Amount",
      required: true,
      minimum: 0,
      maximum: 1000000,
    }),
    instance("status-input", "builtin.form.select-field", "Status input", {
      label: "Status",
      required: true,
      optionsSource: "static",
      staticOptions: [
        { value: "draft", label: "Draft" },
        { value: "submitted", label: "Submitted" },
        { value: "approved", label: "Approved" },
      ],
    }),
    instance(
      "due-date-input",
      "builtin.form.date-time-field",
      "Due date input",
      { label: "Due date", required: true, dateTimeKind: "date" },
    ),
    instance(
      "validation",
      "builtin.data.validation-rule",
      "Required field validation",
      { rule: "required", message: "Complete every required field." },
    ),
    instance("create", "builtin.data.create-operation", "Create request", {
      entity: "service-request",
    }),
    instance("read", "builtin.data.read-operation", "Read request", {
      entity: "service-request",
    }),
    instance("update", "builtin.data.update-operation", "Update request", {
      entity: "service-request",
    }),
    instance("list", "builtin.data.list-operation", "List requests", {
      entity: "service-request",
      maximumPageSize: "100",
    }),
    instance(
      "workflow",
      "builtin.workflow.record-crud",
      "Request CRUD workflow",
      {
        entity: "service-request",
        onDenied: "authorization-denied",
        onError: "error",
      },
    ),
    instance(
      "audit",
      "builtin.security.audit-event",
      "Record audit declaration",
      { eventType: "system-data.record", outcome: "recorded" },
    ),
    instance("table", "builtin.display.table", "Request list", {
      title: "Requests",
    }),
    instance("detail", "builtin.display.detail-view", "Request detail", {
      title: "Request details",
    }),
    instance("loading", "builtin.state.loading-state", "Loading state", {
      message: "Loading requests...",
    }),
    instance("empty", "builtin.state.empty-state", "Empty state", {
      message: "No requests yet.",
    }),
    instance(
      "denied",
      "builtin.state.error-state",
      "Authorization denied state",
      { message: "You do not have permission to perform this action." },
    ),
    instance("success", "builtin.state.success-message", "Success state", {
      message: "Request saved.",
    }),
    instance("error", "builtin.state.error-state", "Error state", {
      message: "The request could not be saved.",
    }),
  ];

  const dependency = (
    suffix: string,
    sourceSuffix: string,
    targetSuffix: string,
  ): AssetBinding => ({
    bindingId: input.systemId + ".binding." + suffix,
    bindingKind: "dependency",
    sourceRef: {
      kind: "asset-instance",
      id: normalizeAssetId(input.systemId + "." + sourceSuffix),
    },
    targetRef: {
      kind: "asset-instance",
      id: normalizeAssetId(input.systemId + "." + targetSuffix),
    },
    lifecycleStatus: "draft",
    provenance: {
      sourceKind: "system-generated",
      createdAt: input.timestamp,
      createdBy: safeActor(input.actorId),
    },
  });
  const bindings: readonly AssetBinding[] = [
    dependency("navigation-system", "navigation", "system"),
    dependency("page-navigation", "page", "navigation"),
    dependency("form-page", "form", "page"),
    dependency("workflow-form", "workflow", "form"),
    dependency("create-workflow", "create", "workflow"),
    dependency("read-workflow", "read", "workflow"),
    dependency("update-workflow", "update", "workflow"),
    dependency("list-workflow", "list", "workflow"),
    dependency("entity-workflow", "entity", "workflow"),
    dependency("authentication-workflow", "authentication", "workflow"),
    dependency("audit-workflow", "audit", "workflow"),
  ];
  const instanceRefs = instances.map(
    (item) =>
      ({
        kind: "asset-instance",
        id: String(item.instanceId),
      }) as AssetReference,
  );
  return {
    description: SECURED_DATA_ENTRY_TEMPLATE.description,
    composition: {
      compositionId,
      compositionType: "system",
      displayName: input.name,
      description: SECURED_DATA_ENTRY_TEMPLATE.description,
      version: "1.0.0",
      lifecycleStatus: "draft",
      rootInstanceRefs: [
        {
          kind: "asset-instance",
          id: normalizeAssetId(input.systemId + ".system"),
        },
      ],
      instanceRefs,
      bindingRefs: bindings.map(
        (item) =>
          ({
            kind: "asset-binding",
            id: String(item.bindingId),
          }) as AssetReference,
      ),
      provenance: {
        sourceKind: "system-generated",
        createdAt: input.timestamp,
        createdBy: safeActor(input.actorId),
        metadata: { templateId: SECURED_DATA_ENTRY_TEMPLATE.templateId },
      },
    },
    instances,
    bindings,
  };
}

function createControlledChatbotTemplate(
  input: MaterializeSystemBuilderTemplateInput,
): SystemBuilderTemplateMaterialization {
  const compositionId = input.systemId + ".composition";
  const instance = (
    suffix: string,
    definitionId: string,
    displayName: string,
    selectedConfiguration: AssetConfigurationValues,
  ): AssetInstance => ({
    instanceId: input.systemId + "." + suffix,
    ...currentFoundationSelection(definitionId, selectedConfiguration),
    displayName,
    lifecycleStatus: "draft",
    parentCompositionRef: {
      kind: "asset-composition",
      id: normalizeAssetId(compositionId),
    },
    provenance: {
      sourceKind: "system-generated",
      createdAt: input.timestamp,
      createdBy: safeActor(input.actorId),
    },
    metadata: {
      referenceTemplateId: CONTROLLED_CHATBOT_TEMPLATE.templateId,
      referenceSystemKind: CONTROLLED_CHATBOT_TEMPLATE.referenceSystemKind,
      protectedConfiguration:
        definitionId === "builtin.ai.instruction-template",
    },
  });

  const instances: readonly AssetInstance[] = [
    instance("system", "builtin.system.system", "Controlled chatbot system", {
      title: input.name,
    }),
    instance(
      "navigation",
      "builtin.shell.navigation-group",
      "Assistant navigation",
      { label: "Assistant" },
    ),
    instance("page", "builtin.shell.page", "Assistant page", {
      title: "Assistant",
    }),
    instance(
      "authentication",
      "builtin.security.authentication-requirement",
      "Authentication required",
      { required: true },
    ),
    instance(
      "policy",
      "builtin.security.conversation-policy",
      "Conversation policy",
      {
        allowedRoles: ["owner", "editor", "viewer", "developer"],
        maximumInputCharacters: 4000,
        allowContextSources: false,
        toolsMode: "disabled",
      },
    ),
    instance(
      "audit",
      "builtin.security.audit-event",
      "Conversation audit declaration",
      { eventType: "conversation.turn", outcome: "recorded" },
    ),
    instance("model", "builtin.ai.model-reference", "Registered text model", {
      modelRef: "model.default",
      capability: "text-generation",
    }),
    instance(
      "context",
      "builtin.ai.context-source",
      "Approved instruction context",
      { name: "Approved instructions", sensitivity: "internal" },
    ),
    instance(
      "instruction",
      "builtin.ai.instruction-template",
      "Protected assistant instructions",
      {
        instruction:
          "Answer clearly, use only approved context, and say when the requested information is unavailable.",
        sensitivity: "internal",
      },
    ),
    instance(
      "generation",
      "builtin.ai.generation-settings",
      "Bounded generation",
      { temperature: 0.2, maximumResponseUnits: 512 },
    ),
    instance(
      "inference",
      "builtin.ai.controlled-inference-action",
      "Controlled response generation",
      {
        capability: "text-generation",
        onUnsupported: "unsupported",
        onFailure: "error",
      },
    ),
    instance(
      "fallback",
      "builtin.ai.safe-fallback",
      "Safe assistant fallback",
      { message: "This assistant cannot respond right now." },
    ),
    instance(
      "starter",
      "conversation.basic-assistant-system",
      "Basic assistant system",
      {},
    ),
    instance("chat-shell", "conversation.chat-shell", "Conversation shell", {}),
    instance(
      "history-display",
      "conversation.message-history-display",
      "Message history",
      {},
    ),
    instance(
      "response-panel",
      "conversation.assistant-response-panel",
      "Assistant response",
      {},
    ),
    instance(
      "composer",
      "conversation.message-composer",
      "Message composer",
      {},
    ),
    instance(
      "user-input",
      "conversation.user-message-input",
      "User message input",
      {},
    ),
    instance(
      "assistant-output",
      "conversation.assistant-text-response-output",
      "Assistant text output",
      {},
    ),
    instance(
      "history-reference",
      "conversation.history-reference",
      "Conversation history reference",
      {},
    ),
    instance(
      "session-behavior",
      "conversation.session-behavior",
      "Session behavior",
      {},
    ),
    instance(
      "turn-behavior",
      "conversation.turn-behavior",
      "Turn behavior",
      {},
    ),
    instance(
      "response-behavior",
      "conversation.assistant-response-generation-behavior",
      "Response generation behavior",
      {},
    ),
    instance(
      "history-behavior",
      "conversation.history-context-behavior",
      "History context behavior",
      {},
    ),
    instance(
      "runtime-requirement",
      "conversation.text-generation-runtime-requirement",
      "Text generation runtime requirement",
      {},
    ),
    instance("status", "builtin.display.status-badge", "Assistant status", {
      label: "Assistant status",
      status: "pending",
      tone: "info",
      description: "Shows whether the controlled assistant is ready.",
      showIconHint: true,
      accessibilityLabel: "Assistant readiness status",
    }),
    instance(
      "loading",
      "builtin.state.loading-state",
      "Generating response state",
      { message: "Generating a response..." },
    ),
    instance("empty", "builtin.state.empty-state", "Empty conversation state", {
      message: "Send a message to start the conversation.",
    }),
    instance(
      "unsupported",
      "builtin.state.error-state",
      "Unsupported runtime state",
      { message: "This assistant cannot run in the selected host." },
    ),
    instance("error", "builtin.state.error-state", "Safe error state", {
      message: "The assistant could not complete the response.",
    }),
    instance(
      "success",
      "builtin.state.success-message",
      "Response complete state",
      { message: "Response complete." },
    ),
  ];

  const dependency = (
    suffix: string,
    sourceSuffix: string,
    targetSuffix: string,
  ): AssetBinding => ({
    bindingId: input.systemId + ".binding." + suffix,
    bindingKind: "dependency",
    sourceRef: {
      kind: "asset-instance",
      id: normalizeAssetId(input.systemId + "." + sourceSuffix),
    },
    targetRef: {
      kind: "asset-instance",
      id: normalizeAssetId(input.systemId + "." + targetSuffix),
    },
    lifecycleStatus: "draft",
    provenance: {
      sourceKind: "system-generated",
      createdAt: input.timestamp,
      createdBy: safeActor(input.actorId),
    },
  });
  const bindings: readonly AssetBinding[] = [
    dependency("navigation-system", "navigation", "system"),
    dependency("page-navigation", "page", "navigation"),
    dependency("starter-page", "starter", "page"),
    dependency("chat-shell-starter", "chat-shell", "starter"),
    dependency("history-chat-shell", "history-display", "chat-shell"),
    dependency("response-chat-shell", "response-panel", "chat-shell"),
    dependency("composer-chat-shell", "composer", "chat-shell"),
    dependency("input-composer", "user-input", "composer"),
    dependency("output-response", "assistant-output", "response-panel"),
    dependency(
      "history-reference-display",
      "history-reference",
      "history-display",
    ),
    dependency("session-starter", "session-behavior", "starter"),
    dependency("turn-starter", "turn-behavior", "starter"),
    dependency("response-starter", "response-behavior", "starter"),
    dependency("history-behavior-starter", "history-behavior", "starter"),
    dependency("runtime-response", "runtime-requirement", "response-behavior"),
    dependency("inference-response", "inference", "response-behavior"),
    dependency("model-inference", "model", "inference"),
    dependency("instruction-inference", "instruction", "inference"),
    dependency("generation-inference", "generation", "inference"),
    dependency("policy-inference", "policy", "inference"),
    dependency("authentication-inference", "authentication", "inference"),
    dependency("audit-inference", "audit", "inference"),
    dependency("context-inference", "context", "inference"),
    dependency("fallback-inference", "fallback", "inference"),
    dependency("status-chat-shell", "status", "chat-shell"),
    dependency("loading-response", "loading", "response-panel"),
    dependency("empty-chat-shell", "empty", "chat-shell"),
    dependency("unsupported-response", "unsupported", "response-panel"),
    dependency("error-response", "error", "response-panel"),
    dependency("success-response", "success", "response-panel"),
  ];
  const instanceRefs = instances.map(
    (item) =>
      ({
        kind: "asset-instance",
        id: String(item.instanceId),
      }) as AssetReference,
  );
  return {
    description: CONTROLLED_CHATBOT_TEMPLATE.description,
    composition: {
      compositionId,
      compositionType: "system",
      displayName: input.name,
      description: CONTROLLED_CHATBOT_TEMPLATE.description,
      version: "1.0.0",
      lifecycleStatus: "draft",
      rootInstanceRefs: [
        {
          kind: "asset-instance",
          id: normalizeAssetId(input.systemId + ".system"),
        },
      ],
      instanceRefs,
      bindingRefs: bindings.map(
        (item) =>
          ({
            kind: "asset-binding",
            id: String(item.bindingId),
          }) as AssetReference,
      ),
      provenance: {
        sourceKind: "system-generated",
        createdAt: input.timestamp,
        createdBy: safeActor(input.actorId),
        metadata: { templateId: CONTROLLED_CHATBOT_TEMPLATE.templateId },
      },
    },
    instances,
    bindings,
  };
}

function createSecuredDataReviewTemplate(
  input: MaterializeSystemBuilderTemplateInput,
): SystemBuilderTemplateMaterialization {
  const compositionId = input.systemId + ".composition";
  const instance = (
    suffix: string,
    definitionId: string,
    displayName: string,
    selectedConfiguration: AssetConfigurationValues,
  ): AssetInstance => ({
    instanceId: input.systemId + "." + suffix,
    ...currentFoundationSelection(definitionId, selectedConfiguration),
    displayName,
    lifecycleStatus: "draft",
    parentCompositionRef: {
      kind: "asset-composition",
      id: normalizeAssetId(compositionId),
    },
    provenance: {
      sourceKind: "system-generated",
      createdAt: input.timestamp,
      createdBy: safeActor(input.actorId),
    },
    metadata: {
      referenceTemplateId: SECURED_DATA_REVIEW_TEMPLATE.templateId,
      referenceSystemKind: SECURED_DATA_REVIEW_TEMPLATE.referenceSystemKind,
    },
  });

  const allowedRoles = ["owner", "editor", "viewer", "developer"];
  const allowedMediaTypes = [
    "text/plain",
    "text/markdown",
    "application/json",
    "text/csv",
    "application/csv",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "application/pdf",
  ];
  const instances: readonly AssetInstance[] = [
    instance("system", "builtin.system.system", "Secured data-review system", {
      title: input.name,
    }),
    instance(
      "navigation",
      "builtin.shell.navigation-group",
      "Review navigation",
      { label: "Data review" },
    ),
    instance("page", "builtin.shell.page", "Data review page", {
      title: "Secured data review",
    }),
    instance(
      "authentication",
      "builtin.security.authentication-requirement",
      "Authentication required",
      { required: true },
    ),
    instance(
      "read-policy",
      "builtin.security.artifact-read-policy",
      "Artifact read policy",
      {
        allowedRoles,
        allowedMediaTypes,
        maximumListItems: 100,
        maximumPreviewBytes: 2_097_152,
      },
    ),
    instance(
      "mask",
      "builtin.security.field-mask",
      "Protected artifact metadata mask",
      {
        protectedFields: [
          "checksum",
          "sourceLocator",
          "providerPayload",
          "storagePath",
        ],
        visibleToRoles: ["owner", "developer"],
      },
    ),
    instance(
      "audit",
      "builtin.security.audit-event",
      "Artifact review audit declaration",
      {
        eventType: "system-review.artifact",
        outcome: "recorded",
      },
    ),
    instance("browser", "builtin.shell.resource-browser", "Artifact browser", {
      title: "Artifacts",
      description: "Browse authorized workspace artifacts.",
      resourceKind: "artifact",
      listDisplayMode: "table",
      filterBehavior: "simple",
      selectionMode: "single",
      emptyStateMessage: "No authorized artifacts are available.",
      accessibilityLabel: "Authorized artifact browser",
    }),
    instance(
      "detail-page",
      "builtin.shell.detail-page",
      "Artifact detail page",
      {
        title: "Artifact details",
        description:
          "Review safe metadata and a bounded preview for the selected artifact.",
        primaryResourceKind: "artifact",
        summaryFields: [
          { fieldId: "displayName", label: "Name" },
          { fieldId: "mediaType", label: "Media type" },
          { fieldId: "sizeBytes", label: "Size" },
        ],
        detailSections: [
          { sectionId: "metadata", title: "Metadata" },
          { sectionId: "preview", title: "Preview" },
        ],
        actionsPlacement: "header",
        accessibilityLabel: "Selected artifact details",
      },
    ),
    instance("name-filter", "builtin.form.text-field", "Artifact name filter", {
      label: "Name",
      required: false,
    }),
    instance("media-filter", "builtin.form.select-field", "Media type filter", {
      label: "Media type",
      required: false,
      optionsSource: "static",
      staticOptions: [
        { value: "all", label: "All supported types" },
        { value: "text", label: "Text and tables" },
        { value: "image", label: "Raster images" },
        { value: "pdf", label: "PDF documents" },
      ],
    }),
    instance("table", "builtin.display.table", "Artifact results", {
      title: "Authorized artifacts",
    }),
    instance("detail", "builtin.display.detail-view", "Artifact metadata", {
      title: "Artifact metadata",
    }),
    instance(
      "summary",
      "builtin.display.key-value-summary",
      "Artifact summary",
      { title: "Safe metadata" },
    ),
    instance("preview", "builtin.preview.artifact", "Artifact preview", {
      title: "Bounded artifact preview",
      mediaType: "policy-allowlisted",
    }),
    instance("text-preview", "builtin.preview.text", "Bounded text preview", {
      maximumLines: 80,
      maximumCharacters: 16_000,
    }),
    instance(
      "table-preview",
      "builtin.preview.table",
      "Bounded table preview",
      { maximumRows: 25, maximumColumns: 20 },
    ),
    instance(
      "image-preview",
      "builtin.preview.raster-image",
      "Raster image preview",
      { altText: "Selected artifact preview" },
    ),
    instance("pdf-preview", "builtin.preview.pdf", "Sandboxed PDF preview", {
      title: "Selected PDF preview",
    }),
    instance(
      "unsupported-preview",
      "builtin.preview.unsupported",
      "Unsupported preview",
      {
        message: "This file type does not have a safe in-app preview.",
      },
    ),
    instance(
      "review-workflow",
      "builtin.workflow.workflow",
      "Artifact review workflow",
      {
        title: "Review artifact",
        description:
          "Select an authorized artifact, inspect safe metadata, and request a bounded preview.",
        workflowPurpose: "Authenticated, policy-bound artifact review",
        expectedInputs: [{ inputId: "artifact", label: "Authorized artifact" }],
        expectedOutputs: [
          { outputId: "audit", label: "Safe review audit event" },
        ],
        reviewRequired: false,
        declarativeStatus: "approved",
        nonRunningNotice:
          "This declaration runs only through an approved release-bound review host.",
      },
    ),
    instance("loading", "builtin.state.loading-state", "Loading state", {
      message: "Loading authorized artifacts...",
    }),
    instance("empty", "builtin.state.empty-state", "Empty state", {
      message: "No authorized artifacts are available.",
    }),
    instance("unavailable", "builtin.state.error-state", "Unavailable state", {
      message: "The artifact is unavailable.",
    }),
    instance("oversized", "builtin.state.error-state", "Oversized state", {
      message: "The artifact exceeds the preview limit.",
    }),
    instance(
      "unauthorized",
      "builtin.state.error-state",
      "Unauthorized state",
      { message: "You do not have permission to review this artifact." },
    ),
    instance(
      "malformed",
      "builtin.state.error-state",
      "Malformed content state",
      { message: "The artifact could not be safely parsed." },
    ),
    instance("success", "builtin.state.success-message", "Review ready state", {
      message: "Artifact review is ready.",
    }),
  ];

  const dependency = (
    suffix: string,
    sourceSuffix: string,
    targetSuffix: string,
  ): AssetBinding => ({
    bindingId: input.systemId + ".binding." + suffix,
    bindingKind: "dependency",
    sourceRef: {
      kind: "asset-instance",
      id: normalizeAssetId(input.systemId + "." + sourceSuffix),
    },
    targetRef: {
      kind: "asset-instance",
      id: normalizeAssetId(input.systemId + "." + targetSuffix),
    },
    lifecycleStatus: "draft",
    provenance: {
      sourceKind: "system-generated",
      createdAt: input.timestamp,
      createdBy: safeActor(input.actorId),
    },
  });
  const bindings: readonly AssetBinding[] = [
    dependency("navigation-system", "navigation", "system"),
    dependency("page-navigation", "page", "navigation"),
    dependency("browser-page", "browser", "page"),
    dependency("detail-page-page", "detail-page", "page"),
    dependency("name-filter-browser", "name-filter", "browser"),
    dependency("media-filter-browser", "media-filter", "browser"),
    dependency("table-browser", "table", "browser"),
    dependency("detail-detail-page", "detail", "detail-page"),
    dependency("summary-detail", "summary", "detail"),
    dependency("preview-detail", "preview", "detail"),
    dependency("text-preview", "text-preview", "preview"),
    dependency("table-preview", "table-preview", "preview"),
    dependency("image-preview", "image-preview", "preview"),
    dependency("pdf-preview", "pdf-preview", "preview"),
    dependency("unsupported-preview", "unsupported-preview", "preview"),
    dependency("workflow-browser", "review-workflow", "browser"),
    dependency("authentication-workflow", "authentication", "review-workflow"),
    dependency("read-policy-workflow", "read-policy", "review-workflow"),
    dependency("mask-workflow", "mask", "review-workflow"),
    dependency("audit-workflow", "audit", "review-workflow"),
    dependency("loading-browser", "loading", "browser"),
    dependency("empty-browser", "empty", "browser"),
    dependency("unavailable-preview", "unavailable", "preview"),
    dependency("oversized-preview", "oversized", "preview"),
    dependency("unauthorized-preview", "unauthorized", "preview"),
    dependency("malformed-preview", "malformed", "preview"),
    dependency("success-detail", "success", "detail-page"),
  ];
  const instanceRefs = instances.map(
    (item) =>
      ({
        kind: "asset-instance",
        id: String(item.instanceId),
      }) as AssetReference,
  );
  return {
    description: SECURED_DATA_REVIEW_TEMPLATE.description,
    composition: {
      compositionId,
      compositionType: "system",
      displayName: input.name,
      description: SECURED_DATA_REVIEW_TEMPLATE.description,
      version: "1.0.0",
      lifecycleStatus: "draft",
      rootInstanceRefs: [
        {
          kind: "asset-instance",
          id: normalizeAssetId(input.systemId + ".system"),
        },
      ],
      instanceRefs,
      bindingRefs: bindings.map(
        (item) =>
          ({
            kind: "asset-binding",
            id: String(item.bindingId),
          }) as AssetReference,
      ),
      provenance: {
        sourceKind: "system-generated",
        createdAt: input.timestamp,
        createdBy: safeActor(input.actorId),
        metadata: { templateId: SECURED_DATA_REVIEW_TEMPLATE.templateId },
      },
    },
    instances,
    bindings,
  };
}

function safeActor(value: string): string {
  return value.trim().slice(0, 160) || "unknown-actor";
}

function currentFoundationSelection(
  definitionId: string,
  selectedConfiguration: AssetConfigurationValues,
): Pick<AssetInstance, "definitionRef" | "selectedConfiguration"> {
  const entry = SYSTEM_FOUNDATION_CURRENT_PACK_MANIFEST.assets.find(
    (candidate) => String(candidate.definition.definitionId) === definitionId,
  );
  if (!entry) {
    throw new Error("A reference-system Foundation asset is unavailable.");
  }
  return {
    definitionRef: exactSystemFoundationDefinitionReference(definitionId),
    selectedConfiguration: {
      ...(entry.definition.defaultConfiguration ?? {}),
      ...selectedConfiguration,
    },
  };
}
