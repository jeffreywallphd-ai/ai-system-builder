import type { AssetPort } from "../../../../../contracts/asset";
import {
  allowedParentRule,
  booleanField,
  configurationInputPort,
  createDisplayPrimitiveDefinition,
  createDisplayPrimitiveEntry,
  descriptorArrayField,
  displayEventPort,
  enumField,
  numberField,
  optionalChildRule,
  stringField,
  textAreaField,
  type DisplayPrimitiveSpec,
} from "./display-primitive-builders";
import {
  DISPLAY_PRIMITIVE_IDS,
  DISPLAY_PRIMITIVE_VERSION,
  STATE_MESSAGE_PRIMITIVE_IDS,
} from "./display-primitive-ids";

const structuralParentDefinitionIds = [
  "builtin.ui.container",
  "builtin.ui.section",
  "builtin.ui.panel",
  "builtin.ui.card",
  "builtin.ui.stack",
  "builtin.ui.grid",
  "builtin.ui.tabs",
  "builtin.ui.collapsible-section",
] as const;

const formParentDefinitionIds = [
  "builtin.form.form",
  "builtin.form.field-group",
] as const;

const displayRegionDefinitionIds = [
  "builtin.display.table",
  "builtin.display.list",
  "builtin.display.detail-view",
  "builtin.display.key-value-summary",
] as const;

const tableListStateDefinitionIds = [
  "builtin.state.empty-state",
  "builtin.state.loading-state",
  "builtin.state.error-state",
] as const;

const selectionModes = ["none", "single", "multiple"] as const;
const densityOptions = ["compact", "comfortable", "spacious"] as const;
const sortBehaviorOptions = ["none", "single-column", "multi-column", "external"] as const;
const paginationBehaviorOptions = ["none", "paged", "incremental", "external"] as const;
const listLayoutOptions = ["stacked", "inline", "compact", "media"] as const;
const summaryLayoutOptions = ["single-column", "two-column", "inline"] as const;
const statusOptions = ["neutral", "info", "success", "warning", "error", "pending"] as const;
const toneOptions = ["neutral", "info", "success", "warning", "error"] as const;
const progressKinds = ["indeterminate", "determinate", "steps"] as const;
const previewIntents = ["thumbnail", "summary", "inspection", "deferred"] as const;
const resourceKinds = ["artifact", "image", "document", "dataset", "model", "external-object", "unknown"] as const;
const severityOptions = ["info", "warning", "error", "critical"] as const;

const displayPlacementRule = allowedParentRule(
  "display.allowed-ui-structure-parent",
  "Display primitives may be placed inside container, section, panel, card, stack, grid, tabs, or collapsible section primitives.",
  structuralParentDefinitionIds,
  ["ui-structure"],
);

const statePlacementRule = allowedParentRule(
  "state-message.allowed-foundation-parent",
  "State and message primitives may be placed inside UI structure, forms, and compatible display regions.",
  [
    ...structuralParentDefinitionIds,
    ...formParentDefinitionIds,
    ...displayRegionDefinitionIds,
  ],
  ["ui-structure", "forms-fields", "data-display"],
);

const statusPlacementRule = allowedParentRule(
  "status-badge.allowed-display-parent",
  "Status badges may be placed inside detail views, list item summaries, cards, panels, table cell concepts, or state/message regions.",
  [
    "builtin.display.detail-view",
    "builtin.display.list",
    "builtin.display.key-value-summary",
    "builtin.ui.card",
    "builtin.ui.panel",
    "builtin.state.empty-state",
    "builtin.state.loading-state",
    "builtin.state.error-state",
    "builtin.state.success-message",
  ],
  ["data-display", "ui-structure", "state-messages"],
);

const progressPlacementRule = allowedParentRule(
  "progress-indicator.allowed-display-parent",
  "Progress indicators may be placed inside panels, cards, sections, or loading-state regions.",
  [
    "builtin.ui.panel",
    "builtin.ui.card",
    "builtin.ui.section",
    "builtin.state.loading-state",
  ],
  ["ui-structure", "state-messages"],
);

const previewPlacementRule = allowedParentRule(
  "preview-placeholder.allowed-display-parent",
  "Preview placeholders may be placed inside cards, panels, detail views, or future resource browser shells.",
  [
    "builtin.ui.card",
    "builtin.ui.panel",
    "builtin.display.detail-view",
  ],
  ["ui-structure", "data-display", "page-feature-shells"],
);

const specs: readonly DisplayPrimitiveSpec[] = [
  {
    id: "builtin.display.table",
    categoryId: "data-display",
    displayName: "Table",
    family: "composition",
    description:
      "Semantic tabular display primitive for comparing records across declared columns.",
    purpose:
      "Represent record comparison and row-oriented display semantics with declarative columns, state messages, sorting, pagination, and selection intent.",
    userSummary: "Displays records in rows and columns.",
    capabilities: [
      "Declares column descriptors, row identity, density, selection, sorting, pagination, and state message semantics.",
      "Provides declarative row selection, sort request, and page request events without implementing data retrieval.",
      "Composes with UI structural primitives and state-message primitives.",
    ],
    configurationFields: [
      stringField("title", "Title"),
      textAreaField("description", "Description"),
      descriptorArrayField(
        "columns",
        "Columns",
        "display-column-descriptor",
        ["columnId", "label", "valueField"],
        ["description", "dataKind", "sortable", "alignment"],
        "Array of semantic column descriptors for record fields.",
      ),
      stringField("rowIdentityField", "Row identity field"),
      stringField("emptyStateMessage", "Empty state message", "No records to display."),
      stringField("loadingStateMessage", "Loading state message", "Loading records."),
      stringField("errorStateMessage", "Error state message", "Records are unavailable."),
      enumField("selectionMode", "Selection mode", selectionModes, "none"),
      enumField("density", "Density", densityOptions, "comfortable"),
      enumField("sortBehavior", "Sort behavior", sortBehaviorOptions, "none"),
      enumField("paginationBehavior", "Pagination behavior", paginationBehaviorOptions, "none"),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      title: "",
      description: "",
      columns: [],
      rowIdentityField: "",
      emptyStateMessage: "No records to display.",
      loadingStateMessage: "Loading records.",
      errorStateMessage: "Records are unavailable.",
      selectionMode: "none",
      density: "comfortable",
      sortBehavior: "none",
      paginationBehavior: "none",
      accessibilityLabel: "",
    },
    ports: [
      configurationInputPort("rows", "Rows", "Semantic row descriptors supplied by a future composition.", "semantic-record-list", { preset: "zero-or-more", allowMultiple: true }),
      configurationInputPort("columns", "Columns", "Optional column descriptors supplied by a future composition.", "semantic-display-columns", { preset: "zero-or-more", allowMultiple: true }),
      configurationInputPort("selection-state", "Selection state", "Optional selected-row state descriptor.", "semantic-selection-state"),
      configurationInputPort("loading-state", "Loading state", "Optional loading state descriptor.", "semantic-loading-state"),
      configurationInputPort("error-state", "Error state", "Optional error state descriptor.", "semantic-error-state"),
      displayEventPort("row-selected", "Row selected", "Declarative event indicating row selection intent.", "semantic-selection-event"),
      displayEventPort("sort-requested", "Sort requested", "Declarative event indicating sort intent.", "semantic-sort-event"),
      displayEventPort("page-requested", "Page requested", "Declarative event indicating pagination intent.", "semantic-pagination-event"),
    ],
    compositionRules: [
      displayPlacementRule,
      optionalChildRule(
        "table.optional-state-children",
        "Tables may include empty, loading, and error state primitives for declarative state regions.",
        tableListStateDefinitionIds,
        ["state-messages"],
      ),
      {
        ruleId: "table.recommends-columns",
        ruleKind: "cardinality",
        description: "Tables are useful with one or more column descriptors.",
        cardinality: { min: 1 },
      },
    ],
    configurationGuidance:
      "Use columns and rowIdentityField as semantic descriptors only; selectionMode, sortBehavior, and paginationBehavior declare interaction intent without naming a table library.",
    compositionGuidance:
      "Place tables inside UI structural regions and pair them with state-message primitives when empty, loading, or error states need dedicated composition.",
    stateGuidance:
      "emptyStateMessage, loadingStateMessage, and errorStateMessage describe state copy only; rows and state are supplied by future composition.",
    accessibilityGuidance:
      "Provide title or accessibilityLabel and meaningful column labels so record comparison is understandable.",
    exampleDescription:
      "A project table inside a section with name, status, owner, and updated columns plus an empty-state child.",
    tags: ["table", "records", "state"],
  },
  {
    id: "builtin.display.list",
    categoryId: "data-display",
    displayName: "List",
    family: "composition",
    description:
      "Semantic list display primitive for presenting repeated item summaries.",
    purpose:
      "Represent item-oriented display semantics with item title, summary, metadata, layout, selection, and state messaging.",
    userSummary: "Displays repeated item summaries.",
    capabilities: [
      "Declares item title, summary, metadata field descriptors, layout, selection, and empty-state semantics.",
      "Emits item selection intent without implementing navigation or retrieval.",
      "Composes with UI structural primitives and state-message primitives.",
    ],
    configurationFields: [
      stringField("title", "Title"),
      textAreaField("description", "Description"),
      stringField("itemTitleField", "Item title field"),
      stringField("itemSummaryField", "Item summary field"),
      descriptorArrayField(
        "itemMetadataFields",
        "Item metadata fields",
        "display-metadata-field-descriptor",
        ["fieldId", "label", "valueField"],
        ["description", "dataKind", "priority"],
        "Array of semantic metadata descriptors shown with each item.",
      ),
      stringField("emptyStateMessage", "Empty state message", "No items to display."),
      enumField("selectionMode", "Selection mode", selectionModes, "none"),
      enumField("layout", "Layout", listLayoutOptions, "stacked"),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      title: "",
      description: "",
      itemTitleField: "",
      itemSummaryField: "",
      itemMetadataFields: [],
      emptyStateMessage: "No items to display.",
      selectionMode: "none",
      layout: "stacked",
      accessibilityLabel: "",
    },
    ports: [
      configurationInputPort("items", "Items", "Semantic item descriptors supplied by a future composition.", "semantic-item-list", { preset: "zero-or-more", allowMultiple: true }),
      configurationInputPort("selection-state", "Selection state", "Optional selected-item state descriptor.", "semantic-selection-state"),
      configurationInputPort("loading-state", "Loading state", "Optional loading state descriptor.", "semantic-loading-state"),
      configurationInputPort("error-state", "Error state", "Optional error state descriptor.", "semantic-error-state"),
      displayEventPort("item-selected", "Item selected", "Declarative event indicating item selection intent.", "semantic-selection-event"),
    ],
    compositionRules: [
      displayPlacementRule,
      optionalChildRule(
        "list.optional-state-children",
        "Lists may include empty, loading, and error state primitives for declarative state regions.",
        tableListStateDefinitionIds,
        ["state-messages"],
      ),
      optionalChildRule(
        "list.optional-status-summary",
        "Lists may include status badges or progress indicators inside item summaries conceptually.",
        ["builtin.display.status-badge", "builtin.display.progress-indicator"],
        ["data-display"],
      ),
    ],
    configurationGuidance:
      "Use item field names as semantic descriptors for future binding; do not include data queries, transport targets, or renderer props.",
    compositionGuidance:
      "Use lists for repeated item summaries and place them inside sections, panels, cards, stacks, grids, tabs, or collapsible sections.",
    stateGuidance:
      "List state is declarative; items, loading, and error descriptors arrive through ports supplied by future composition.",
    accessibilityGuidance:
      "Provide a title or accessibilityLabel and clear item title semantics.",
    exampleDescription:
      "A recent activity list inside a panel with item title, summary, timestamp metadata, and item-selected event semantics.",
    tags: ["list", "items", "state"],
  },
  {
    id: "builtin.display.detail-view",
    categoryId: "data-display",
    displayName: "Detail View",
    family: "composition",
    description:
      "Semantic detail display primitive for presenting one selected record across named sections.",
    purpose:
      "Represent a single-record inspection region with primary, summary, metadata, section, empty, loading, and error semantics.",
    userSummary: "Displays detailed information for one record.",
    capabilities: [
      "Declares primary field, summary fields, metadata fields, and sections for one selected record.",
      "Accepts record, loading-state, and error-state descriptors without reading a source.",
      "Composes status badges, progress indicators, summaries, and preview placeholders as child semantics.",
    ],
    configurationFields: [
      stringField("title", "Title"),
      textAreaField("description", "Description"),
      descriptorArrayField(
        "sections",
        "Sections",
        "detail-section-descriptor",
        ["sectionId", "title"],
        ["description", "fieldRefs", "collapsedByDefault"],
        "Array of semantic detail section descriptors.",
      ),
      stringField("primaryField", "Primary field"),
      descriptorArrayField(
        "summaryFields",
        "Summary fields",
        "detail-summary-field-descriptor",
        ["fieldId", "label", "valueField"],
        ["description", "toneHint"],
        "Array of semantic summary field descriptors.",
      ),
      descriptorArrayField(
        "metadataFields",
        "Metadata fields",
        "detail-metadata-field-descriptor",
        ["fieldId", "label", "valueField"],
        ["description", "dataKind"],
        "Array of semantic metadata field descriptors.",
      ),
      stringField("emptyStateMessage", "Empty state message", "Select a record to view details."),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      title: "",
      description: "",
      sections: [],
      primaryField: "",
      summaryFields: [],
      metadataFields: [],
      emptyStateMessage: "Select a record to view details.",
      accessibilityLabel: "",
    },
    ports: [
      configurationInputPort("record", "Record", "Selected semantic record descriptor.", "semantic-record"),
      configurationInputPort("loading-state", "Loading state", "Optional loading state descriptor.", "semantic-loading-state"),
      configurationInputPort("error-state", "Error state", "Optional error state descriptor.", "semantic-error-state"),
      displayEventPort("field-action-requested", "Field action requested", "Optional declarative event indicating field-level action intent.", "semantic-field-action-event"),
    ],
    compositionRules: [
      displayPlacementRule,
      optionalChildRule(
        "detail-view.optional-display-children",
        "Detail views may include status badges, progress indicators, key/value summaries, or preview placeholders.",
        [
          "builtin.display.status-badge",
          "builtin.display.progress-indicator",
          "builtin.display.key-value-summary",
          "builtin.display.image-preview-placeholder",
          "builtin.display.resource-preview-placeholder",
        ],
        ["data-display"],
      ),
      optionalChildRule(
        "detail-view.optional-state-children",
        "Detail views may include empty, loading, and error state primitives.",
        tableListStateDefinitionIds,
        ["state-messages"],
      ),
    ],
    configurationGuidance:
      "Use sections and field descriptors to explain detail hierarchy; field-action-requested is declarative and does not bind an implementation effect.",
    compositionGuidance:
      "Place detail views inside structural regions, often paired with tables or lists that choose the record context.",
    stateGuidance:
      "A missing record should use emptyStateMessage or an empty-state child rather than implying a source read.",
    accessibilityGuidance:
      "Provide a title, primary field, or accessibilityLabel that clearly identifies the inspected record.",
    exampleDescription:
      "A customer detail view in a panel with summary fields, metadata fields, status badge, and resource preview placeholder.",
    tags: ["detail", "record", "inspection"],
  },
  {
    id: "builtin.display.key-value-summary",
    categoryId: "data-display",
    displayName: "Key/Value Summary",
    family: "structural",
    description:
      "Semantic compact display primitive for showing labeled values from one record.",
    purpose:
      "Represent a concise summary of fields using labels, empty-value handling, layout, and accessibility semantics.",
    userSummary: "Displays labeled values from a record.",
    capabilities: [
      "Declares labeled value descriptors and empty-value display semantics.",
      "Accepts record and field descriptors as semantic input.",
      "Composes inside detail views, cards, panels, sections, lists, and tables conceptually.",
    ],
    configurationFields: [
      stringField("title", "Title"),
      textAreaField("description", "Description"),
      descriptorArrayField(
        "fields",
        "Fields",
        "key-value-field-descriptor",
        ["fieldId", "label", "valueField"],
        ["description", "dataKind", "emphasis"],
        "Array of semantic key/value field descriptors.",
      ),
      stringField("emptyValueDisplay", "Empty value display", "Not provided"),
      enumField("layout", "Layout", summaryLayoutOptions, "single-column"),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      title: "",
      description: "",
      fields: [],
      emptyValueDisplay: "Not provided",
      layout: "single-column",
      accessibilityLabel: "",
    },
    ports: [
      configurationInputPort("record", "Record", "Semantic record descriptor to summarize.", "semantic-record"),
      configurationInputPort("fields", "Fields", "Optional field descriptors supplied by a future composition.", "semantic-display-fields", { preset: "zero-or-more", allowMultiple: true }),
    ],
    compositionRules: [
      displayPlacementRule,
      allowedParentRule(
        "key-value-summary.allowed-display-parent",
        "Key/value summaries may be placed in detail views, list item summaries, cards, panels, and sections.",
        [
          "builtin.display.detail-view",
          "builtin.display.list",
          "builtin.ui.card",
          "builtin.ui.panel",
          "builtin.ui.section",
        ],
        ["data-display", "ui-structure"],
      ),
    ],
    configurationGuidance:
      "Use fields as semantic label/value descriptors; emptyValueDisplay is a display fallback, not data normalization.",
    compositionGuidance:
      "Use key/value summaries for compact inspection areas or highlights inside detail views and cards.",
    stateGuidance:
      "Missing values should be represented by emptyValueDisplay or supplied state descriptors rather than source reads.",
    accessibilityGuidance:
      "Use meaningful labels so values remain understandable without relying on visual placement.",
    exampleDescription:
      "A compact account summary with plan, owner, status, and renewal date fields.",
    tags: ["summary", "record", "fields"],
  },
  {
    id: "builtin.display.status-badge",
    categoryId: "data-display",
    displayName: "Status Badge",
    family: "context",
    description:
      "Semantic status label primitive for communicating a compact categorical state.",
    purpose:
      "Represent status text, status value, tone, icon hint, and accessibility labeling as declarative state display.",
    userSummary: "Shows a compact status label.",
    capabilities: [
      "Declares status, tone, label, and optional icon hint without selecting visual styling.",
      "Accepts status input as a semantic state descriptor.",
      "Composes inside detail, list, card, panel, table-cell concepts, and state/message regions.",
    ],
    configurationFields: [
      stringField("label", "Label", "Status"),
      enumField("status", "Status", statusOptions, "neutral"),
      enumField("tone", "Tone", toneOptions, "neutral"),
      textAreaField("description", "Description"),
      booleanField("showIconHint", "Show icon hint", false),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      label: "Status",
      status: "neutral",
      tone: "neutral",
      description: "",
      showIconHint: false,
      accessibilityLabel: "",
    },
    ports: [
      configurationInputPort("status", "Status", "Semantic status descriptor supplied by a future composition.", "semantic-status-state"),
    ],
    compositionRules: [statusPlacementRule],
    configurationGuidance:
      "Use status for categorical meaning and tone for communication intent; do not include style class names.",
    compositionGuidance:
      "Use status badges near record labels, item summaries, detail fields, or state messages.",
    stateGuidance:
      "Status input is declarative and does not query or compute state by itself.",
    accessibilityGuidance:
      "Use accessibilityLabel or description when the label alone does not explain the status meaning.",
    exampleDescription: "A Published status badge inside a detail view summary.",
    tags: ["status", "badge", "state"],
  },
  {
    id: "builtin.display.progress-indicator",
    categoryId: "data-display",
    displayName: "Progress Indicator",
    family: "context",
    description:
      "Semantic progress display primitive for communicating determinate or indeterminate progress state.",
    purpose:
      "Represent progress label, kind, current value, maximum value, percent display intent, and accessibility semantics without running work.",
    userSummary: "Shows semantic progress state.",
    capabilities: [
      "Declares determinate, indeterminate, or step progress semantics.",
      "Accepts progress value and progress state descriptors through ports.",
      "Composes with loading-state regions and structural containers.",
    ],
    configurationFields: [
      stringField("label", "Label", "Progress"),
      enumField("progressKind", "Progress kind", progressKinds, "indeterminate"),
      numberField("currentValue", "Current value", 0),
      numberField("maximumValue", "Maximum value", 100),
      booleanField("showPercent", "Show percent", true),
      textAreaField("description", "Description"),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      label: "Progress",
      progressKind: "indeterminate",
      currentValue: 0,
      maximumValue: 100,
      showPercent: true,
      description: "",
      accessibilityLabel: "",
    },
    ports: [
      configurationInputPort("progress-value", "Progress value", "Current progress value descriptor.", "semantic-progress-value"),
      configurationInputPort("progress-state", "Progress state", "Optional progress state descriptor.", "semantic-progress-state"),
    ],
    compositionRules: [progressPlacementRule],
    configurationGuidance:
      "Use progressKind to describe whether currentValue and maximumValue are meaningful; values are descriptors only.",
    compositionGuidance:
      "Place progress indicators in loading states, panels, cards, or sections when users need progress semantics.",
    stateGuidance:
      "Progress state is supplied externally and is not computed or polled by this definition.",
    accessibilityGuidance:
      "Provide label or accessibilityLabel so progress is understandable when no surrounding text is present.",
    exampleDescription: "An importing progress indicator inside a loading-state region.",
    tags: ["progress", "state"],
  },
  {
    id: "builtin.display.image-preview-placeholder",
    categoryId: "data-display",
    displayName: "Image Preview Placeholder",
    family: "structural",
    description:
      "Semantic placeholder for where an image preview may appear when a future composition supplies a safe preview.",
    purpose:
      "Represent image preview intent, alternate text, unavailable messaging, and state semantics without reading or rendering image content.",
    userSummary: "Marks a place for an image preview later.",
    capabilities: [
      "Declares image preview intent and fallback messages without reading image content.",
      "Accepts resource reference and preview state descriptors only.",
      "Emits preview-requested as semantic intent without performing preview rendering.",
    ],
    configurationFields: [
      stringField("title", "Title"),
      textAreaField("description", "Description"),
      stringField("altText", "Alt text"),
      stringField("emptyStateMessage", "Empty state message", "No image selected."),
      stringField("unavailableMessage", "Unavailable message", "Image preview is unavailable."),
      enumField("previewIntent", "Preview intent", previewIntents, "thumbnail"),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      title: "",
      description: "",
      altText: "",
      emptyStateMessage: "No image selected.",
      unavailableMessage: "Image preview is unavailable.",
      previewIntent: "thumbnail",
      accessibilityLabel: "",
    },
    ports: previewPorts(),
    compositionRules: [previewPlacementRule],
    configurationGuidance:
      "Use previewIntent and messages to describe desired placeholder behavior; do not include source locations, preview material, or renderer instructions.",
    compositionGuidance:
      "Place image preview placeholders in cards, panels, or detail views where visual inspection may be added later.",
    stateGuidance:
      "The placeholder can describe empty or unavailable preview state; it does not read, decode, or render image content.",
    accessibilityGuidance:
      "Provide altText when a future image preview would need a meaningful text alternative.",
    exampleDescription:
      "A detail view placeholder for a selected image asset with unavailable preview messaging.",
    tags: ["image", "preview", "placeholder"],
  },
  {
    id: "builtin.display.resource-preview-placeholder",
    categoryId: "data-display",
    displayName: "Resource Preview Placeholder",
    family: "structural",
    description:
      "Semantic placeholder for where a resource preview may appear when a future composition supplies a safe preview.",
    purpose:
      "Represent resource preview intent, resource kind, fallback messages, and state semantics without reading or rendering resource content.",
    userSummary: "Marks a place for a resource preview later.",
    capabilities: [
      "Declares resource preview intent and fallback messages without reading resource content.",
      "Accepts resource reference and preview state descriptors only.",
      "Emits preview-requested as semantic intent without performing preview rendering.",
    ],
    configurationFields: [
      stringField("title", "Title"),
      textAreaField("description", "Description"),
      enumField("resourceKind", "Resource kind", resourceKinds, "unknown"),
      stringField("emptyStateMessage", "Empty state message", "No resource selected."),
      stringField("unavailableMessage", "Unavailable message", "Resource preview is unavailable."),
      enumField("previewIntent", "Preview intent", previewIntents, "summary"),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      title: "",
      description: "",
      resourceKind: "unknown",
      emptyStateMessage: "No resource selected.",
      unavailableMessage: "Resource preview is unavailable.",
      previewIntent: "summary",
      accessibilityLabel: "",
    },
    ports: previewPorts(),
    compositionRules: [previewPlacementRule],
    configurationGuidance:
      "Use resourceKind and previewIntent as semantic hints; do not include preview material or external-system details.",
    compositionGuidance:
      "Place resource preview placeholders in cards, panels, detail views, or future resource browser shells.",
    stateGuidance:
      "The placeholder describes preview availability state only and does not read or render preview material.",
    accessibilityGuidance:
      "Provide a title or accessibilityLabel that names the resource preview region.",
    exampleDescription:
      "A document detail placeholder that communicates preview unavailable until a future safe preview provider exists.",
    tags: ["resource", "preview", "placeholder"],
  },
  {
    id: "builtin.state.empty-state",
    categoryId: "state-messages",
    displayName: "Empty State",
    family: "context",
    description:
      "Semantic state message primitive for explaining that no records, items, or values are currently available.",
    purpose:
      "Represent empty-state title, message, optional suggested action label, tone, and accessibility semantics.",
    userSummary: "Explains an empty display state.",
    capabilities: [
      "Declares empty-state copy and optional action intent without implementing an action.",
      "Accepts state descriptors and emits action-requested as a declarative event.",
      "Composes with UI structure, forms, and display primitives.",
    ],
    configurationFields: [
      stringField("title", "Title", "Nothing here yet"),
      textAreaField("message", "Message", "There are no items to display."),
      stringField("suggestedActionLabel", "Suggested action label"),
      enumField("tone", "Tone", toneOptions, "neutral"),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      title: "Nothing here yet",
      message: "There are no items to display.",
      suggestedActionLabel: "",
      tone: "neutral",
      accessibilityLabel: "",
    },
    ports: [
      configurationInputPort("state", "State", "Semantic empty-state descriptor.", "semantic-empty-state"),
      displayEventPort("action-requested", "Action requested", "Declarative event indicating suggested action intent.", "semantic-state-action-event"),
    ],
    compositionRules: [statePlacementRule],
    configurationGuidance:
      "Use title, message, and suggestedActionLabel to explain the empty condition; do not include navigation targets or action effects.",
    compositionGuidance:
      "Place empty states inside containers, sections, panels, cards, lists, tables, detail views, forms, or future feature shells.",
    stateGuidance:
      "Empty state describes absence of displayable content supplied elsewhere; it does not inspect sources.",
    accessibilityGuidance:
      "Use concise title and message text that explains what is empty and what users can do next.",
    exampleDescription: "An empty projects table state with a suggested Create project action label.",
    tags: ["empty", "state", "message"],
  },
  {
    id: "builtin.state.loading-state",
    categoryId: "state-messages",
    displayName: "Loading State",
    family: "context",
    description:
      "Semantic state message primitive for communicating that content is being prepared or loaded elsewhere.",
    purpose:
      "Represent loading message, progress kind, skeleton hint, and accessibility semantics without starting work.",
    userSummary: "Communicates a loading state.",
    capabilities: [
      "Declares loading copy and progress display intent.",
      "Accepts state descriptors and can contain progress indicators conceptually.",
      "Composes with UI structure, forms, and display primitives.",
    ],
    configurationFields: [
      stringField("message", "Message", "Loading."),
      enumField("progressKind", "Progress kind", progressKinds, "indeterminate"),
      booleanField("showSkeletonHint", "Show skeleton hint", false),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      message: "Loading.",
      progressKind: "indeterminate",
      showSkeletonHint: false,
      accessibilityLabel: "",
    },
    ports: [
      configurationInputPort("state", "State", "Semantic loading-state descriptor.", "semantic-loading-state"),
    ],
    compositionRules: [
      statePlacementRule,
      optionalChildRule(
        "loading-state.optional-progress-child",
        "Loading states may include a progress indicator child.",
        ["builtin.display.progress-indicator"],
        ["data-display"],
      ),
    ],
    configurationGuidance:
      "Use progressKind and showSkeletonHint as abstract hints only; do not include polling, timers, or source readers.",
    compositionGuidance:
      "Place loading states inside regions that may receive records, form state, details, or future feature content.",
    stateGuidance:
      "Loading state reflects status supplied elsewhere and does not start or monitor work.",
    accessibilityGuidance:
      "Use message or accessibilityLabel to communicate what is loading without relying on animation.",
    exampleDescription: "A loading state inside a table region with an indeterminate progress indicator.",
    tags: ["loading", "state", "message"],
  },
  {
    id: "builtin.state.error-state",
    categoryId: "state-messages",
    displayName: "Error State",
    family: "context",
    description:
      "Semantic state message primitive for communicating a display or interaction error without handling recovery.",
    purpose:
      "Represent error title, message, severity, retry label, supporting action label, and accessibility semantics.",
    userSummary: "Communicates an error state.",
    capabilities: [
      "Declares error copy, severity, retry label, and supporting action label.",
      "Accepts error-state descriptors and emits retry-requested as a declarative event.",
      "Composes with UI structure, forms, and display primitives.",
    ],
    configurationFields: [
      stringField("title", "Title", "Something went wrong"),
      textAreaField("message", "Message", "The requested information is unavailable."),
      enumField("severity", "Severity", severityOptions, "error"),
      stringField("retryLabel", "Retry label", "Retry"),
      stringField("supportingActionLabel", "Supporting action label"),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      title: "Something went wrong",
      message: "The requested information is unavailable.",
      severity: "error",
      retryLabel: "Retry",
      supportingActionLabel: "",
      accessibilityLabel: "",
    },
    ports: [
      configurationInputPort("state", "State", "Semantic error-state descriptor.", "semantic-error-state"),
      displayEventPort("retry-requested", "Retry requested", "Declarative event indicating retry intent.", "semantic-state-action-event"),
    ],
    compositionRules: [statePlacementRule],
    configurationGuidance:
      "Use title, message, severity, and labels to describe recovery intent; do not include retry effects, transport targets, or diagnostics payloads.",
    compositionGuidance:
      "Place error states in the region affected by the problem so the failed display or form remains clear.",
    stateGuidance:
      "Error state summarizes an error supplied elsewhere and does not retry, log, inspect, or recover by itself.",
    accessibilityGuidance:
      "Use clear error text and an accessibilityLabel when severity or retry intent is not obvious.",
    exampleDescription: "A list error state with retry-requested semantics after items are unavailable.",
    tags: ["error", "state", "message"],
  },
  {
    id: "builtin.state.success-message",
    categoryId: "state-messages",
    displayName: "Success Message",
    family: "context",
    description:
      "Semantic success message primitive for communicating completed or positive state.",
    purpose:
      "Represent success title, message, dismissibility, tone, and accessibility semantics without executing follow-up behavior.",
    userSummary: "Communicates a success message.",
    capabilities: [
      "Declares success copy, tone, and dismissibility.",
      "Accepts state descriptors and emits dismissed as a declarative event.",
      "Composes with UI structure, forms, display regions, and future feature shells.",
    ],
    configurationFields: [
      stringField("title", "Title", "Success"),
      textAreaField("message", "Message", "The action completed successfully."),
      booleanField("dismissible", "Dismissible", true),
      enumField("tone", "Tone", ["success", "info", "neutral"], "success"),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      title: "Success",
      message: "The action completed successfully.",
      dismissible: true,
      tone: "success",
      accessibilityLabel: "",
    },
    ports: [
      configurationInputPort("state", "State", "Semantic success-state descriptor.", "semantic-success-state"),
      displayEventPort("dismissed", "Dismissed", "Declarative event indicating dismissal intent.", "semantic-state-action-event"),
    ],
    compositionRules: [statePlacementRule],
    configurationGuidance:
      "Use title, message, dismissible, and tone to communicate positive status; do not include storage writes or workflow actions.",
    compositionGuidance:
      "Place success messages near the region or form whose state changed.",
    stateGuidance:
      "Success state communicates an outcome supplied elsewhere and does not trigger follow-up behavior.",
    accessibilityGuidance:
      "Use message text that explains what succeeded and whether any attention is required.",
    exampleDescription: "A saved settings success message inside a form panel.",
    tags: ["success", "state", "message"],
  },
];

export const DISPLAY_PRIMITIVE_DEFINITIONS = specs.map(
  createDisplayPrimitiveDefinition,
);

export const DISPLAY_PRIMITIVE_ENTRIES = DISPLAY_PRIMITIVE_DEFINITIONS.map(
  (definition, index) =>
    createDisplayPrimitiveEntry(
      definition,
      specs[index]?.categoryId ?? "data-display",
      specs[index]?.tags ?? [],
    ),
);

export const DISPLAY_PRIMITIVE_CATALOG = {
  categoryIds: ["data-display", "state-messages"],
  version: DISPLAY_PRIMITIVE_VERSION,
  definitions: DISPLAY_PRIMITIVE_DEFINITIONS,
  entries: DISPLAY_PRIMITIVE_ENTRIES,
  deferredPrimitiveIds: [] as readonly string[],
} as const;

function previewPorts(): readonly AssetPort[] {
  return [
    configurationInputPort(
      "resource-reference",
      "Resource reference",
      "Semantic resource reference descriptor supplied by future composition.",
      "semantic-resource-reference",
    ),
    configurationInputPort(
      "preview-state",
      "Preview state",
      "Semantic preview availability state descriptor.",
      "semantic-preview-state",
    ),
    displayEventPort(
      "preview-requested",
      "Preview requested",
      "Declarative event indicating preview intent without rendering content.",
      "semantic-preview-event",
    ),
  ];
}

export const ALL_DISPLAY_STATE_MESSAGE_PRIMITIVE_IDS = [
  ...DISPLAY_PRIMITIVE_IDS,
  ...STATE_MESSAGE_PRIMITIVE_IDS,
] as const;
