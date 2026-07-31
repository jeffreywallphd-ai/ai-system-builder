import type { AssetPort } from "../../../../../contracts/asset";
import {
  allowedChildRule,
  allowedParentRule,
  assetInputPort,
  booleanField,
  configurationInputPort,
  createShellPrimitiveDefinition,
  createShellPrimitiveEntry,
  descriptorArrayField,
  enumField,
  eventPort,
  integerField,
  optionalChildRule,
  outputPort,
  stringField,
  textAreaField,
  type ShellPrimitiveSpec,
} from "./shell-primitive-builders";
import {
  DEFERRED_SHELL_PRIMITIVE_IDS,
  PAGE_FEATURE_SHELL_PRIMITIVE_IDS,
  SHELL_PRIMITIVE_VERSION,
  WORKFLOW_SYSTEM_SHELL_PRIMITIVE_IDS,
} from "./shell-primitive-ids";

const lowerLevelCategories = [
  "ui-structure",
  "forms-fields",
  "data-display",
  "state-messages",
] as const;

const structuralDefinitionIds = [
  "builtin.ui.container",
  "builtin.ui.section",
  "builtin.ui.panel",
  "builtin.ui.card",
  "builtin.ui.stack",
  "builtin.ui.grid",
  "builtin.ui.tabs",
  "builtin.ui.collapsible-section",
] as const;

const formDefinitionIds = [
  "builtin.form.form",
  "builtin.form.field-group",
  "builtin.form.validation-message",
  "builtin.form.submit-action",
  "builtin.form.cancel-action",
] as const;

const displayStateDefinitionIds = [
  "builtin.display.table",
  "builtin.display.list",
  "builtin.display.detail-view",
  "builtin.display.key-value-summary",
  "builtin.display.status-badge",
  "builtin.display.progress-indicator",
  "builtin.display.image-preview-placeholder",
  "builtin.display.resource-preview-placeholder",
  "builtin.state.empty-state",
  "builtin.state.loading-state",
  "builtin.state.error-state",
  "builtin.state.success-message",
] as const;

const pageFeatureChildIds = [
  ...structuralDefinitionIds,
  ...formDefinitionIds,
  ...displayStateDefinitionIds,
] as const;

const workflowStepIds = [
  "builtin.workflow.step",
  "builtin.workflow.input-step",
  "builtin.workflow.transform-step",
  "builtin.workflow.validation-step",
  "builtin.workflow.approval-step",
  "builtin.workflow.output-step",
] as const;

const systemChildIds = [
  "builtin.system.subsystem",
  "builtin.shell.feature",
  "builtin.workflow.workflow",
  "builtin.system.policy-check",
  "builtin.system.test-check",
] as const;

const subsystemChildIds = [
  "builtin.shell.feature",
  "builtin.workflow.workflow",
  "builtin.system.policy-check",
  "builtin.system.test-check",
] as const;

const layoutOptions = ["single-column", "two-column", "dashboard", "split", "detail"] as const;
const selectionModes = ["none", "single", "multiple"] as const;
const filterBehaviors = ["none", "simple", "advanced", "deferred"] as const;
const displayModes = ["table", "list", "grid", "summary"] as const;
const statusBehaviors = ["none", "summary", "inline", "region"] as const;
const placementOptions = ["header", "footer", "inline", "aside"] as const;
const severityOptions = ["info", "warning", "error", "critical"] as const;
const nonRunningNotice =
  "This shell is declarative and non-running; routers, workflow handlers, schedulers, provider calls, data processing, storage effects, and AI-created composition are deferred outside the definition.";

const pageShellCompositionRules = [
  allowedChildRule(
    "page-shell.allows-foundation-children",
    "Page shells may contain lower-level foundation UI, form, display, state, feature, and page-region shell definitions.",
    ["ui-component", "feature", "page"],
    [...lowerLevelCategories, "page-feature-shells"],
    [
      ...pageFeatureChildIds,
      "builtin.shell.feature",
      "builtin.shell.resource-browser",
      "builtin.shell.detail-page",
      "builtin.shell.wizard-step",
      "builtin.shell.dashboard-section",
      "builtin.shell.settings-panel",
    ],
  ),
] as const;

const featureShellCompositionRules = [
  allowedChildRule(
    "feature-shell.allows-foundation-and-workflow-children",
    "Feature shells may contain lower-level foundation primitives and declarative workflow shells.",
    ["ui-component", "page", "workflow"],
    [...lowerLevelCategories, "page-feature-shells", "workflow-system-shells"],
    [...pageFeatureChildIds, "builtin.workflow.workflow"],
  ),
] as const;

const pageRegionCompositionRules = [
  allowedParentRule(
    "page-region.allowed-parent",
    "Page-region shells should belong to a page or feature shell.",
    ["page", "feature"],
    ["page-feature-shells"],
  ),
  allowedChildRule(
    "page-region.allows-foundation-children",
    "Page-region shells may contain lower-level foundation UI, form, display, and state definitions.",
    ["ui-component"],
    lowerLevelCategories,
    pageFeatureChildIds,
  ),
] as const;

const workflowCompositionRules = [
  allowedChildRule(
    "workflow-shell.allows-workflow-steps",
    "Workflow shells may contain declarative workflow step shells.",
    ["workflow-step"],
    ["workflow-system-shells"],
    workflowStepIds,
  ),
  {
    ruleId: "workflow-shell.step-cardinality",
    ruleKind: "cardinality",
    description: "A workflow shell is useful with one or more declarative step shells.",
    cardinality: { min: 1 },
  },
] as const;

const workflowStepCompositionRules = [
  allowedParentRule(
    "workflow-step.allowed-workflow-parent",
    "Workflow step shells should be composed inside a workflow shell.",
    ["workflow"],
    ["workflow-system-shells"],
  ),
] as const;

const systemCompositionRules = [
  allowedChildRule(
    "system-shell.allows-system-children",
    "System shells may contain subsystem, feature, workflow, policy, and test check shells.",
    ["subsystem", "feature", "workflow", "policy", "test"],
    ["page-feature-shells", "workflow-system-shells"],
    systemChildIds,
  ),
] as const;

const subsystemCompositionRules = [
  allowedParentRule(
    "subsystem-shell.allowed-system-parent",
    "Subsystem shells should be composed inside a system shell.",
    ["system"],
    ["workflow-system-shells"],
  ),
  allowedChildRule(
    "subsystem-shell.allows-feature-workflow-check-children",
    "Subsystem shells may contain feature, workflow, policy, and test check shells.",
    ["feature", "workflow", "policy", "test"],
    ["page-feature-shells", "workflow-system-shells"],
    subsystemChildIds,
  ),
] as const;

const checkCompositionRules = [
  allowedParentRule(
    "check-shell.allowed-semantic-parent",
    "Check shells may attach to system, subsystem, feature, or workflow shells.",
    ["system", "subsystem", "feature", "workflow"],
    ["page-feature-shells", "workflow-system-shells"],
  ),
] as const;

const specs: readonly ShellPrimitiveSpec[] = [
  {
    id: "builtin.shell.page",
    categoryId: "page-feature-shells",
    assetType: "page",
    assetFamily: "composition",
    displayName: "Page Shell",
    description: "Semantic page container for organizing screen-level content without defining a route or concrete page implementation.",
    purpose: "Represent a user-facing page boundary that composes lower-level primitives and feature regions.",
    userSummary: "Organizes screen-level content as a semantic page.",
    capabilities: [
      "Declares page title, purpose, layout intent, navigation label, empty-state copy, and accessibility label.",
      "Composes lower-level structural, form, display, state, feature, and page-region shell primitives.",
    ],
    configurationFields: [
      stringField("title", "Title"),
      textAreaField("description", "Description"),
      stringField("primaryPurpose", "Primary purpose"),
      enumField("defaultLayout", "Default layout", layoutOptions, "single-column"),
      stringField("navigationLabel", "Navigation label"),
      stringField("emptyStateMessage", "Empty state message", "No content is available."),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      title: "",
      description: "",
      primaryPurpose: "",
      defaultLayout: "single-column",
      navigationLabel: "",
      emptyStateMessage: "No content is available.",
      accessibilityLabel: "",
    },
    ports: [
      assetInputPort("page-content", "Page content", "Semantic content assets contained by this page shell.", "semantic-page-content"),
      configurationInputPort("navigation-context", "Navigation context", "Semantic navigation context supplied by future composition.", "semantic-navigation-context"),
      eventPort("navigation-requested", "Navigation requested", "Declarative event indicating navigation intent."),
    ],
    compositionRules: pageShellCompositionRules,
    configurationGuidance: "Use page fields to describe user-facing intent and layout semantics without route names or renderer details.",
    compositionGuidance: "Compose page shells from lower-level foundation primitives and feature or region shells.",
    shellGuidance: "Use for a top-level semantic screen boundary, not for a concrete app route.",
    nonRunningGuidance: nonRunningNotice,
    exampleDescription: "A semantic asset library page shell containing a resource browser shell and empty-state primitive.",
    tags: ["page", "shell"],
  },
  {
    id: "builtin.shell.feature",
    categoryId: "page-feature-shells",
    assetType: "feature",
    assetFamily: "composition",
    displayName: "Feature Shell",
    description: "Semantic feature container for grouping related UI, state, actions, and declarative workflow references.",
    purpose: "Represent a reusable product capability boundary without coupling to builder-core use cases.",
    userSummary: "Groups related feature content and behavior intent.",
    capabilities: [
      "Declares feature purpose, sections, primary actions, status behavior, and accessibility label.",
      "May reference workflow shells as declarative behavior intent without handling workflow behavior.",
    ],
    configurationFields: [
      stringField("title", "Title"),
      textAreaField("description", "Description"),
      stringField("featurePurpose", "Feature purpose"),
      descriptorArrayField("defaultSections", "Default sections", "feature-section", ["sectionId", "title"]),
      descriptorArrayField("primaryActions", "Primary actions", "feature-action", ["actionId", "label"]),
      enumField("statusBehavior", "Status behavior", statusBehaviors, "summary"),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      title: "",
      description: "",
      featurePurpose: "",
      defaultSections: [],
      primaryActions: [],
      statusBehavior: "summary",
      accessibilityLabel: "",
    },
    ports: [
      assetInputPort("feature-content", "Feature content", "Semantic content assets contained by this feature shell.", "semantic-feature-content"),
      configurationInputPort("feature-state", "Feature state", "Semantic feature state supplied by future composition.", "semantic-feature-state"),
      eventPort("feature-action-requested", "Feature action requested", "Declarative event indicating feature action intent."),
    ],
    compositionRules: featureShellCompositionRules,
    configurationGuidance: "Use sections and actions as semantic descriptors only; omit handlers, endpoints, routes, and task identifiers.",
    compositionGuidance: "Compose features from foundation UI/form/display/state primitives and declarative workflow shells where useful.",
    shellGuidance: "Use for a reusable capability boundary, not for product-internal orchestration.",
    nonRunningGuidance: nonRunningNotice,
    exampleDescription: "A resource management feature shell with a list section, detail section, and save action intent.",
    tags: ["feature", "shell"],
  },
  {
    id: "builtin.shell.dashboard-section",
    categoryId: "page-feature-shells",
    assetType: "page",
    assetFamily: "structural",
    displayName: "Dashboard Section Shell",
    description: "Semantic dashboard section for grouped summaries without refresh, polling, or data retrieval behavior.",
    purpose: "Represent a summary-oriented section inside a page or feature shell.",
    userSummary: "Groups dashboard summaries as a semantic section.",
    capabilities: ["Declares summary intent, refresh hint, empty-state copy, and accessibility label."],
    configurationFields: [
      stringField("title", "Title"),
      textAreaField("description", "Description"),
      stringField("summaryIntent", "Summary intent"),
      enumField("refreshHint", "Refresh hint", ["none", "manual", "automatic-later"], "none"),
      stringField("emptyStateMessage", "Empty state message", "No summary is available."),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      title: "",
      description: "",
      summaryIntent: "",
      refreshHint: "none",
      emptyStateMessage: "No summary is available.",
      accessibilityLabel: "",
    },
    ports: [assetInputPort("section-content", "Section content", "Semantic dashboard section content.", "semantic-dashboard-section-content")],
    compositionRules: pageRegionCompositionRules,
    configurationGuidance: "Use refreshHint as abstract user expectation only; do not include polling or source details.",
    compositionGuidance: "Compose dashboard sections from display and state primitives inside page or feature shells.",
    shellGuidance: "Use for summary regions, not for data retrieval or monitoring behavior.",
    nonRunningGuidance: nonRunningNotice,
    exampleDescription: "A dashboard section with status badges and a loading-state primitive.",
    tags: ["dashboard", "section"],
  },
  {
    id: "builtin.shell.settings-panel",
    categoryId: "page-feature-shells",
    assetType: "page",
    assetFamily: "structural",
    displayName: "Settings Panel Shell",
    description: "Semantic settings panel for grouping configurable form content without saving or validation behavior.",
    purpose: "Represent a settings group container inside a page or feature shell.",
    userSummary: "Groups related settings content.",
    capabilities: ["Declares settings group, change summary behavior, validation summary behavior, and accessibility label."],
    configurationFields: [
      stringField("title", "Title"),
      textAreaField("description", "Description"),
      stringField("settingsGroup", "Settings group"),
      enumField("changeSummaryBehavior", "Change summary behavior", ["none", "inline", "footer"], "inline"),
      enumField("validationSummaryBehavior", "Validation summary behavior", ["none", "top", "inline"], "top"),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      title: "",
      description: "",
      settingsGroup: "",
      changeSummaryBehavior: "inline",
      validationSummaryBehavior: "top",
      accessibilityLabel: "",
    },
    ports: [assetInputPort("settings-content", "Settings content", "Semantic settings form or display content.", "semantic-settings-content")],
    compositionRules: pageRegionCompositionRules,
    configurationGuidance: "Use summary behavior fields as semantic placement hints; omit save handlers or validation engines.",
    compositionGuidance: "Compose settings panels from forms, validation messages, and state/message primitives.",
    shellGuidance: "Use for settings organization, not for persistence or policy behavior.",
    nonRunningGuidance: nonRunningNotice,
    exampleDescription: "An account settings panel containing a form and validation message primitives.",
    tags: ["settings", "panel"],
  },
  {
    id: "builtin.shell.resource-browser",
    categoryId: "page-feature-shells",
    assetType: "page",
    assetFamily: "composition",
    displayName: "Resource Browser Shell",
    description: "Semantic browser shell for listing, filtering, and selecting resources without reading resources or calling providers.",
    purpose: "Represent a resource browsing region with list, filter, and selection semantics.",
    userSummary: "Organizes resource lists and selection intent.",
    capabilities: [
      "Declares resource kind, display mode, filter behavior, selection mode, empty-state copy, and accessibility label.",
      "Exposes semantic resource selection and filter change events.",
    ],
    configurationFields: [
      stringField("title", "Title"),
      textAreaField("description", "Description"),
      enumField("resourceKind", "Resource kind", ["artifact", "image", "document", "dataset", "model", "external-object", "unknown"], "unknown"),
      enumField("listDisplayMode", "List display mode", displayModes, "list"),
      enumField("filterBehavior", "Filter behavior", filterBehaviors, "simple"),
      enumField("selectionMode", "Selection mode", selectionModes, "single"),
      stringField("emptyStateMessage", "Empty state message", "No resources are available."),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      title: "",
      description: "",
      resourceKind: "unknown",
      listDisplayMode: "list",
      filterBehavior: "simple",
      selectionMode: "single",
      emptyStateMessage: "No resources are available.",
      accessibilityLabel: "",
    },
    ports: [
      configurationInputPort("resource-list", "Resource list", "Semantic resource list descriptor supplied by future composition.", "semantic-resource-list"),
      configurationInputPort("filter-state", "Filter state", "Semantic filter state descriptor.", "semantic-filter-state"),
      configurationInputPort("selection-state", "Selection state", "Semantic selection state descriptor.", "semantic-selection-state"),
      eventPort("resource-selected", "Resource selected", "Declarative event indicating selected resource intent."),
      eventPort("filter-changed", "Filter changed", "Declarative event indicating filter change intent."),
    ],
    compositionRules: pageRegionCompositionRules,
    configurationGuidance: "Use resourceKind and listDisplayMode as semantic hints only; do not include source locators, provider details, queries, or routes.",
    compositionGuidance: "Compose resource browsers with table/list display primitives, filters represented by form fields, and state messages.",
    shellGuidance: "Use for resource browsing semantics, not for resource reading or provider behavior.",
    nonRunningGuidance: nonRunningNotice,
    exampleDescription: "A model browser shell composed with list, empty-state, and selection-state primitives.",
    tags: ["resource", "browser"],
  },
  {
    id: "builtin.shell.detail-page",
    categoryId: "page-feature-shells",
    assetType: "page",
    assetFamily: "composition",
    displayName: "Detail Page Shell",
    description: "Semantic detail page shell for describing a selected resource or record without fetching or routing behavior.",
    purpose: "Represent a detail-oriented page or region with summary fields, detail sections, and action placement.",
    userSummary: "Organizes detail content for one selected item.",
    capabilities: [
      "Declares primary resource kind, summary fields, detail sections, action placement, and accessibility label.",
      "Exposes semantic detail action intent.",
    ],
    configurationFields: [
      stringField("title", "Title"),
      textAreaField("description", "Description"),
      stringField("primaryResourceKind", "Primary resource kind"),
      descriptorArrayField("summaryFields", "Summary fields", "summary-field", ["fieldId", "label"]),
      descriptorArrayField("detailSections", "Detail sections", "detail-section", ["sectionId", "title"]),
      enumField("actionsPlacement", "Actions placement", placementOptions, "header"),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      title: "",
      description: "",
      primaryResourceKind: "",
      summaryFields: [],
      detailSections: [],
      actionsPlacement: "header",
      accessibilityLabel: "",
    },
    ports: [
      configurationInputPort("resource-detail", "Resource detail", "Semantic resource or record detail descriptor.", "semantic-resource-detail"),
      configurationInputPort("action-state", "Action state", "Semantic action state descriptor.", "semantic-action-state"),
      eventPort("detail-action-requested", "Detail action requested", "Declarative event indicating detail action intent."),
    ],
    compositionRules: pageRegionCompositionRules,
    configurationGuidance: "Use fields and sections as semantic descriptors; omit queries, route targets, and handlers.",
    compositionGuidance: "Compose detail pages with detail-view, key-value summary, preview placeholder, form, and state/message primitives.",
    shellGuidance: "Use for selected-item detail semantics, not for a concrete route implementation.",
    nonRunningGuidance: nonRunningNotice,
    exampleDescription: "An image detail shell with a summary, preview placeholder, and status message.",
    tags: ["detail", "page"],
  },
  {
    id: "builtin.shell.wizard-step",
    categoryId: "page-feature-shells",
    assetType: "page",
    assetFamily: "composition",
    displayName: "Wizard Step Shell",
    description: "Semantic wizard step shell for ordered task content without navigation or validation behavior.",
    purpose: "Represent one step in a guided flow while keeping step changes and validation outside the definition.",
    userSummary: "Organizes content for one guided step.",
    capabilities: [
      "Declares step purpose, order hint, skip behavior, validation summary behavior, labels, and accessibility label.",
      "Exposes next, back, and skip intent as semantic events.",
    ],
    configurationFields: [
      stringField("title", "Title"),
      textAreaField("description", "Description"),
      stringField("stepPurpose", "Step purpose"),
      integerField("stepOrderHint", "Step order hint", 1, 1, 1000),
      booleanField("canSkip", "Can skip", false),
      enumField("validationSummaryBehavior", "Validation summary behavior", ["none", "inline", "top"], "inline"),
      stringField("nextLabel", "Next label", "Next"),
      stringField("backLabel", "Back label", "Back"),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      title: "",
      description: "",
      stepPurpose: "",
      stepOrderHint: 1,
      canSkip: false,
      validationSummaryBehavior: "inline",
      nextLabel: "Next",
      backLabel: "Back",
      accessibilityLabel: "",
    },
    ports: [
      assetInputPort("step-content", "Step content", "Semantic content for this wizard step.", "semantic-step-content"),
      configurationInputPort("step-state", "Step state", "Semantic step state descriptor.", "semantic-step-state"),
      eventPort("next-requested", "Next requested", "Declarative event indicating next-step intent."),
      eventPort("back-requested", "Back requested", "Declarative event indicating previous-step intent."),
      eventPort("skip-requested", "Skip requested", "Declarative event indicating skip intent."),
    ],
    compositionRules: pageRegionCompositionRules,
    configurationGuidance: "Use order and labels as semantic guidance only; do not include route transitions or validation functions.",
    compositionGuidance: "Compose wizard steps from UI, form, display, and state/message primitives.",
    shellGuidance: "Use for guided flow step semantics, not for a wizard engine or visual authoring behavior.",
    nonRunningGuidance: nonRunningNotice,
    exampleDescription: "A setup step shell containing a field group and validation message primitive.",
    tags: ["wizard", "step"],
  },
  {
    id: "builtin.shell.navigation-group",
    categoryId: "page-feature-shells",
    assetType: "page",
    assetFamily: "structural",
    displayName: "Navigation Group Shell",
    description: "Semantic navigation grouping shell without route paths or navigation implementation.",
    purpose: "Represent a labeled group of navigation concepts for future composition.",
    userSummary: "Groups navigation concepts semantically.",
    capabilities: ["Declares label, description, display order, collapsibility, and accessibility label."],
    configurationFields: [
      stringField("label", "Label"),
      textAreaField("description", "Description"),
      integerField("displayOrder", "Display order", 0, 0, 10000),
      booleanField("collapsible", "Collapsible", false),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      label: "",
      description: "",
      displayOrder: 0,
      collapsible: false,
      accessibilityLabel: "",
    },
    ports: [assetInputPort("navigation-items", "Navigation items", "Semantic navigation item descriptors.", "semantic-navigation-items")],
    compositionRules: [
      allowedParentRule("navigation-group.allowed-page-feature-parent", "Navigation groups should belong to page or feature shells.", ["page", "feature"], ["page-feature-shells"]),
    ],
    configurationGuidance: "Use labels and order only; do not include route paths, route keys, or navigation handlers.",
    compositionGuidance: "Attach navigation groups to page or feature shells as declarative organization.",
    shellGuidance: "Use for navigation semantics, not for router configuration.",
    nonRunningGuidance: nonRunningNotice,
    exampleDescription: "A semantic group for asset-related navigation concepts.",
    tags: ["navigation", "group"],
  },
  {
    id: "builtin.workflow.workflow",
    categoryId: "workflow-system-shells",
    assetType: "workflow",
    assetFamily: "composition",
    displayName: "Workflow Shell",
    description: "Declarative workflow shell for grouping step intent without being a workflow engine or task runner.",
    purpose: "Represent a sequence or reviewable process model as semantic composition only.",
    userSummary: "Groups workflow step intent without running work.",
    capabilities: [
      "Declares workflow purpose, expected inputs, expected outputs, review requirement, status label, and non-running notice.",
      "Composes declarative workflow step shells.",
    ],
    configurationFields: [
      stringField("title", "Title"),
      textAreaField("description", "Description"),
      stringField("workflowPurpose", "Workflow purpose"),
      descriptorArrayField("expectedInputs", "Expected inputs", "workflow-input", ["inputId", "label"]),
      descriptorArrayField("expectedOutputs", "Expected outputs", "workflow-output", ["outputId", "label"]),
      booleanField("reviewRequired", "Review required", false),
      enumField("declarativeStatus", "Declarative status", ["draft", "ready-for-review", "approved"], "draft"),
      textAreaField("nonRunningNotice", "Non-running notice", nonRunningNotice),
    ],
    defaultConfiguration: {
      title: "",
      description: "",
      workflowPurpose: "",
      expectedInputs: [],
      expectedOutputs: [],
      reviewRequired: false,
      declarativeStatus: "draft",
      nonRunningNotice,
    },
    ports: [
      configurationInputPort("workflow-inputs", "Workflow inputs", "Semantic workflow input descriptors.", "semantic-workflow-inputs"),
      assetInputPort("workflow-steps", "Workflow steps", "Declarative workflow step shell children.", "semantic-workflow-steps", "workflow-step", "behavioral"),
      outputPort("workflow-outputs", "Workflow outputs", "Semantic workflow output descriptors.", "semantic-workflow-outputs"),
      eventPort("workflow-review-requested", "Workflow review requested", "Declarative event indicating review intent."),
    ],
    compositionRules: workflowCompositionRules,
    configurationGuidance: "Use expected inputs and outputs as semantic descriptors; omit engine payloads, task identifiers, schedules, and handlers.",
    compositionGuidance: "Compose workflow shells from step, input, transform, validation, approval, and output step shells.",
    shellGuidance: "Use for workflow meaning and review structure, not for running or authoring workflow behavior.",
    nonRunningGuidance: nonRunningNotice,
    exampleDescription: "A content review workflow shell containing input, validation, approval, and output steps.",
    tags: ["workflow", "shell"],
  },
  {
    id: "builtin.workflow.step",
    categoryId: "workflow-system-shells",
    assetType: "workflow-step",
    assetFamily: "behavioral",
    displayName: "Workflow Step Shell",
    description: "Generic declarative workflow step shell for step intent without step handler behavior.",
    purpose: "Represent one semantic step in a workflow shell.",
    userSummary: "Describes one workflow step intent.",
    capabilities: ["Declares step purpose, input summary, output summary, review requirement, and non-running notice."],
    configurationFields: workflowStepFields("stepPurpose"),
    defaultConfiguration: workflowStepDefaults(""),
    ports: stepPorts(),
    compositionRules: workflowStepCompositionRules,
    configurationGuidance: "Use summaries and reviewRequired to describe step intent only; omit handlers and engine details.",
    compositionGuidance: "Compose generic steps inside workflow shells or use specialized step shells when intent is clearer.",
    shellGuidance: "Use for general workflow step semantics, not for a task handler.",
    nonRunningGuidance: nonRunningNotice,
    exampleDescription: "A generic review preparation step in a workflow shell.",
    tags: ["workflow", "step"],
  },
  specializedStep("builtin.workflow.input-step", "Input Step Shell", "inputKind", "Input kind", "requiredInputs", "validationSummary", "Captures expected input semantics for a workflow without collecting data by itself.", ["input", "step"]),
  specializedStep("builtin.workflow.transform-step", "Transform Step Shell", "transformIntent", "Transform intent", "inputSummary", "outputSummary", "Describes transformation intent without processing data by itself.", ["transform", "step"]),
  specializedStep("builtin.workflow.validation-step", "Validation Step Shell", "validationIntent", "Validation intent", "severityBehavior", "reviewGuidance", "Describes validation intent without checking values by itself.", ["validation", "step"]),
  specializedStep("builtin.workflow.approval-step", "Approval Step Shell", "approvalPurpose", "Approval purpose", "requiredActorKind", "approvalSummary", "Describes approval intent without assigning actors or recording decisions by itself.", ["approval", "step"]),
  specializedStep("builtin.workflow.output-step", "Output Step Shell", "outputKind", "Output kind", "deliveryIntent", "reviewGuidance", "Describes output intent without delivering data by itself.", ["output", "step"]),
  {
    id: "builtin.system.system",
    categoryId: "workflow-system-shells",
    assetType: "system",
    assetFamily: "composition",
    displayName: "System Shell",
    description: "Semantic system shell for organizing subsystems, features, workflows, policies, and tests without generating or running a system.",
    purpose: "Represent a high-level user system boundary as declarative composition.",
    userSummary: "Organizes a system and its major semantic parts.",
    capabilities: [
      "Declares system purpose, primary users, major capabilities, included subsystems, and non-running notice.",
      "Composes subsystem, feature, workflow, policy, and test check shells.",
    ],
    configurationFields: [
      stringField("title", "Title"),
      textAreaField("description", "Description"),
      stringField("systemPurpose", "System purpose"),
      descriptorArrayField("primaryUsers", "Primary users", "primary-user", ["userKind", "label"]),
      descriptorArrayField("majorCapabilities", "Major capabilities", "system-capability", ["capabilityId", "label"]),
      descriptorArrayField("includedSubsystems", "Included subsystems", "subsystem-summary", ["subsystemId", "label"]),
      textAreaField("nonRunningNotice", "Non-running notice", nonRunningNotice),
    ],
    defaultConfiguration: {
      title: "",
      description: "",
      systemPurpose: "",
      primaryUsers: [],
      majorCapabilities: [],
      includedSubsystems: [],
      nonRunningNotice,
    },
    ports: systemPorts(),
    compositionRules: systemCompositionRules,
    configurationGuidance: "Use system fields to describe scope, users, and capabilities; omit deployment, host, provider, and generator details.",
    compositionGuidance: "Compose systems from subsystem, feature, workflow, policy, and test check shells.",
    shellGuidance: "Use for system-level semantic organization, not for creating or running a system.",
    nonRunningGuidance: nonRunningNotice,
    exampleDescription: "A project management system shell with planning and reporting subsystems.",
    tags: ["system", "shell"],
  },
  {
    id: "builtin.system.subsystem",
    categoryId: "workflow-system-shells",
    assetType: "subsystem",
    assetFamily: "composition",
    displayName: "Subsystem Shell",
    description: "Semantic subsystem shell for grouping owned capabilities and dependencies within a system shell.",
    purpose: "Represent a bounded subsystem inside a larger system composition.",
    userSummary: "Groups related capabilities inside a system.",
    capabilities: [
      "Declares subsystem purpose, owned capabilities, dependencies, and non-running notice.",
      "Composes feature, workflow, policy, and test check shells.",
    ],
    configurationFields: [
      stringField("title", "Title"),
      textAreaField("description", "Description"),
      stringField("subsystemPurpose", "Subsystem purpose"),
      descriptorArrayField("ownedCapabilities", "Owned capabilities", "subsystem-capability", ["capabilityId", "label"]),
      descriptorArrayField("dependencies", "Dependencies", "subsystem-dependency", ["dependencyId", "label"]),
      textAreaField("nonRunningNotice", "Non-running notice", nonRunningNotice),
    ],
    defaultConfiguration: {
      title: "",
      description: "",
      subsystemPurpose: "",
      ownedCapabilities: [],
      dependencies: [],
      nonRunningNotice,
    },
    ports: systemPorts(),
    compositionRules: subsystemCompositionRules,
    configurationGuidance: "Use dependencies as semantic descriptors only; omit service calls, host wiring, or storage details.",
    compositionGuidance: "Compose subsystems from features, workflows, policy checks, and test checks.",
    shellGuidance: "Use for subsystem organization within a system shell.",
    nonRunningGuidance: nonRunningNotice,
    exampleDescription: "A reporting subsystem shell with dashboard feature and test check shells.",
    tags: ["subsystem", "shell"],
  },
  checkShell("builtin.system.policy-check", "Policy Check Shell", "policyPurpose", "Policy purpose", "severity", "reviewGuidance", "Declarative policy check shell for review guidance without policy engine behavior.", "policy", ["policy", "check"]),
  checkShell("builtin.system.test-check", "Test Check Shell", "testPurpose", "Test purpose", "expectedBehavior", "reviewGuidance", "Declarative test check shell for expected behavior without test runner behavior.", "test", ["test", "check"]),
];

export const SHELL_PRIMITIVE_DEFINITIONS = specs.map(
  createShellPrimitiveDefinition,
);

export const SHELL_PRIMITIVE_ENTRIES = SHELL_PRIMITIVE_DEFINITIONS.map(
  (definition, index) =>
    createShellPrimitiveEntry(
      definition,
      specs[index]?.categoryId ?? "workflow-system-shells",
      specs[index]?.tags ?? [],
    ),
);

export const SHELL_PRIMITIVE_CATALOG = {
  categoryIds: ["page-feature-shells", "workflow-system-shells"],
  version: SHELL_PRIMITIVE_VERSION,
  definitions: SHELL_PRIMITIVE_DEFINITIONS,
  entries: SHELL_PRIMITIVE_ENTRIES,
  deferredPrimitiveIds: DEFERRED_SHELL_PRIMITIVE_IDS,
} as const;

export const ALL_SHELL_PRIMITIVE_IDS = [
  ...PAGE_FEATURE_SHELL_PRIMITIVE_IDS,
  ...WORKFLOW_SYSTEM_SHELL_PRIMITIVE_IDS,
] as const;

function workflowStepFields(
  purposeFieldId: string,
): readonly ReturnType<typeof stringField>[] {
  return [
    stringField("title", "Title"),
    textAreaField("description", "Description"),
    stringField(purposeFieldId, "Step purpose"),
    textAreaField("inputSummary", "Input summary"),
    textAreaField("outputSummary", "Output summary"),
    booleanField("reviewRequired", "Review required", false),
    textAreaField("nonRunningNotice", "Non-running notice", nonRunningNotice),
  ];
}

function workflowStepDefaults(purposeValue: string): Record<string, string | boolean> {
  return {
    title: "",
    description: "",
    stepPurpose: purposeValue,
    inputSummary: "",
    outputSummary: "",
    reviewRequired: false,
    nonRunningNotice,
  };
}

function specializedStep(
  id: ShellPrimitiveSpec["id"],
  displayName: string,
  primaryFieldId: string,
  primaryFieldLabel: string,
  secondaryFieldId: string,
  tertiaryFieldId: string,
  description: string,
  tags: readonly string[],
): ShellPrimitiveSpec {
  const fields = [
    stringField("title", "Title"),
    textAreaField("description", "Description"),
    stringField(primaryFieldId, primaryFieldLabel),
    textAreaField(secondaryFieldId, titleCase(secondaryFieldId)),
    textAreaField(tertiaryFieldId, titleCase(tertiaryFieldId)),
    textAreaField("nonRunningNotice", "Non-running notice", nonRunningNotice),
  ];
  return {
    id,
    categoryId: "workflow-system-shells",
    assetType: "workflow-step",
    assetFamily: "behavioral",
    displayName,
    description,
    purpose: description,
    userSummary: description,
    capabilities: [
      "Declares specialized step intent and summaries as descriptors only.",
      "Exposes semantic step input, context, output, and review-request intent.",
    ],
    configurationFields: fields,
    defaultConfiguration: {
      title: "",
      description: "",
      [primaryFieldId]: "",
      [secondaryFieldId]: "",
      [tertiaryFieldId]: "",
      nonRunningNotice,
    },
    ports: stepPorts(),
    compositionRules: workflowStepCompositionRules,
    configurationGuidance:
      "Use specialized fields to describe step intent; omit handlers, engine payloads, provider details, and task identifiers.",
    compositionGuidance:
      "Compose specialized steps inside a workflow shell in the order implied by future composition.",
    shellGuidance:
      "Use when the step role is clearer than a generic workflow step shell.",
    nonRunningGuidance: nonRunningNotice,
    exampleDescription: `${displayName} used as part of a declarative review workflow shell.`,
    tags,
  };
}

function checkShell(
  id: ShellPrimitiveSpec["id"],
  displayName: string,
  primaryFieldId: string,
  primaryFieldLabel: string,
  secondaryFieldId: string,
  tertiaryFieldId: string,
  description: string,
  assetType: "policy" | "test",
  tags: readonly string[],
): ShellPrimitiveSpec {
  const fields = [
    stringField("title", "Title"),
    textAreaField("description", "Description"),
    stringField(primaryFieldId, primaryFieldLabel),
    assetType === "policy"
      ? enumField(secondaryFieldId, "Severity", severityOptions, "warning")
      : textAreaField(secondaryFieldId, "Expected behavior"),
    textAreaField(tertiaryFieldId, "Review guidance"),
    textAreaField("nonRunningNotice", "Non-running notice", nonRunningNotice),
  ];
  return {
    id,
    categoryId: "workflow-system-shells",
    assetType,
    assetFamily: "context",
    displayName,
    description,
    purpose: description,
    userSummary: description,
    capabilities: [
      "Declares review guidance as descriptor-only context.",
      "Can attach to system, subsystem, feature, or workflow shells as a declarative check.",
    ],
    configurationFields: fields,
    defaultConfiguration: {
      title: "",
      description: "",
      [primaryFieldId]: "",
      [secondaryFieldId]: assetType === "policy" ? "warning" : "",
      [tertiaryFieldId]: "",
      nonRunningNotice,
    },
    ports: [
      configurationInputPort("candidate", "Candidate", "Semantic candidate descriptor to check later.", "semantic-check-candidate"),
      configurationInputPort("context", "Context", "Semantic check context descriptor.", "semantic-check-context"),
      outputPort("check-result", "Check result", "Semantic check result descriptor supplied by future review.", "semantic-check-result"),
      eventPort("review-required", "Review required", "Declarative event indicating review may be needed."),
    ],
    compositionRules: checkCompositionRules,
    configurationGuidance:
      "Use purpose and guidance fields to describe review intent; omit engines, code, queries, and runtime behavior.",
    compositionGuidance:
      "Attach checks to systems, subsystems, features, or workflows as declarative review context.",
    shellGuidance: "Use for check semantics, not for an automated checker.",
    nonRunningGuidance: nonRunningNotice,
    exampleDescription: `${displayName} attached to a subsystem shell before Review B.`,
    tags,
  };
}

function stepPorts(): readonly AssetPort[] {
  return [
    configurationInputPort("step-input", "Step input", "Semantic step input descriptor.", "semantic-step-input"),
    configurationInputPort("step-context", "Step context", "Semantic step context descriptor.", "semantic-step-context"),
    outputPort("step-output", "Step output", "Semantic step output descriptor.", "semantic-step-output"),
    eventPort("step-review-requested", "Step review requested", "Declarative event indicating step review intent."),
  ];
}

function systemPorts(): readonly AssetPort[] {
  return [
    assetInputPort("capabilities", "Capabilities", "Semantic capability descriptors.", "semantic-capabilities"),
    assetInputPort("subsystems", "Subsystems", "Semantic subsystem shells.", "semantic-subsystems", "subsystem", "composition"),
    assetInputPort("features", "Features", "Semantic feature shells.", "semantic-features", "feature", "composition"),
    assetInputPort("workflows", "Workflows", "Semantic workflow shells.", "semantic-workflows", "workflow", "composition"),
    outputPort("system-summary", "System summary", "Semantic system summary descriptor.", "semantic-system-summary"),
  ];
}

function titleCase(value: string): string {
  return value
    .replace(/([A-Z])/g, " $1")
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
