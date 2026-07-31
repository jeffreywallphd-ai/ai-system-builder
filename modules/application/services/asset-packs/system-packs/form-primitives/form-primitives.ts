import {
  allowedChildRule,
  allowedParentRule,
  booleanField,
  configurationInputPort,
  createFormPrimitiveDefinition,
  createFormPrimitiveEntry,
  enumField,
  formAssetInputPort,
  formEventPort,
  formOutputPort,
  integerField,
  numberField,
  semanticOptionDescriptorArrayField,
  stringField,
  textAreaField,
  type FormPrimitiveSpec,
} from "./form-primitive-builders";
import type { AssetPort } from "../../../../../contracts/asset";
import {
  DEFERRED_FORM_PRIMITIVE_IDS,
  FORM_PRIMITIVE_VERSION,
} from "./form-primitive-ids";

const layoutOptions = ["vertical", "horizontal", "responsive"] as const;
const fieldLayoutOptions = ["vertical", "horizontal"] as const;
const validationModeOptions = ["on-submit", "on-blur", "on-change", "manual"] as const;
const submitBehaviorOptions = ["emit-event", "defer-to-composition"] as const;
const optionSourceOptions = ["static", "external-reference", "deferred"] as const;
const severityOptions = ["info", "success", "warning", "error"] as const;
const showWhenOptions = ["always", "when-invalid", "when-touched", "when-submitted"] as const;

const fieldParentRule = allowedParentRule(
  "form-field.allowed-parent",
  "Fields should be composed inside a form or field group; compatible UI structure parents may provide layout only.",
);

const fieldCompositionRules = [
  fieldParentRule,
  {
    ruleId: "form-field.validation-message-child",
    ruleKind: "optional-child",
    description:
      "Fields may include a nearby validation message primitive for declarative feedback.",
    optionalAssetTypes: ["ui-component"],
    metadata: {
      compatibleChildDefinitionIds: ["builtin.form.validation-message"],
    },
  },
] as const;

const formPlacementRule = {
  ruleId: "form.allowed-ui-structure-parent",
  ruleKind: "allowed-parent",
  description:
    "Forms may be placed inside container, section, panel, card, stack, grid, tabs, or collapsible section primitives.",
  allowedParentTypes: ["ui-component"],
  metadata: {
    compatibleParentDefinitionIds: [
      "builtin.ui.container",
      "builtin.ui.section",
      "builtin.ui.panel",
      "builtin.ui.card",
      "builtin.ui.stack",
      "builtin.ui.grid",
      "builtin.ui.tabs",
      "builtin.ui.collapsible-section",
    ],
  },
} as const;

const specs: readonly FormPrimitiveSpec[] = [
  {
    id: "builtin.form.form",
    displayName: "Form",
    family: "composition",
    description:
      "Semantic form container for collecting related user-provided values through child field primitives.",
    purpose:
      "Represent a declarative input collection boundary with title, labels, validation mode, and action semantics.",
    userSummary: "Groups fields and actions into one semantic input collection.",
    capabilities: [
      "Declares field containment, labels, layout intent, and feedback messages without choosing a renderer.",
      "Exposes semantic submission, cancellation, and validation request signals for future composition.",
      "Composes with UI structural primitives such as containers, sections, panels, cards, stacks, grids, tabs, and collapsible sections.",
    ],
    configurationFields: [
      stringField("title", "Title"),
      textAreaField("description", "Description"),
      stringField("submitLabel", "Submit label", "Submit"),
      stringField("cancelLabel", "Cancel label", "Cancel"),
      enumField("submitBehavior", "Submit behavior", submitBehaviorOptions, "emit-event"),
      enumField("validationMode", "Validation mode", validationModeOptions, "on-submit"),
      enumField("layout", "Layout", layoutOptions, "vertical"),
      booleanField("showRequiredIndicator", "Show required indicator", true),
      stringField("successMessage", "Success message"),
      stringField("errorMessage", "Error message"),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      title: "",
      description: "",
      submitLabel: "Submit",
      cancelLabel: "Cancel",
      submitBehavior: "emit-event",
      validationMode: "on-submit",
      layout: "vertical",
      showRequiredIndicator: true,
      successMessage: "",
      errorMessage: "",
      accessibilityLabel: "",
    },
    ports: [
      formAssetInputPort("fields", "Fields", "Field and field-group primitives contained by this form."),
      configurationInputPort("initial-values", "Initial values", "Optional initial value descriptors for child fields."),
      configurationInputPort("validation-state", "Validation state", "Optional declarative validation state supplied by another asset."),
      formOutputPort("submitted-values", "Submitted values", "Semantic values selected for future submission handling."),
      formEventPort("cancel-requested", "Cancel requested", "Declarative event indicating cancellation intent."),
      formEventPort("validation-requested", "Validation requested", "Declarative event indicating validation should be considered."),
    ],
    compositionRules: [
      formPlacementRule,
      allowedChildRule(
        "form.allows-form-children",
        "Forms may contain field groups, fields, validation messages, submit actions, cancel actions, and compatible UI structure for layout.",
        "forms-fields",
      ),
      {
        ruleId: "form.recommends-fields",
        ruleKind: "cardinality",
        description: "A form is useful with one or more field primitives.",
        cardinality: { min: 1 },
      },
    ],
    configurationGuidance:
      "Use title, description, action labels, validationMode, and layout as semantic intent. submitBehavior only declares how a future composition should treat the action signal.",
    compositionGuidance:
      "Place forms in compatible UI structural primitives, then compose field groups, fields, validation messages, and action primitives as children.",
    validationGuidance:
      "validationMode is a declarative timing hint; the definition does not check values or produce errors.",
    accessibilityGuidance:
      "Provide title or accessibilityLabel so assistive technologies can identify the input collection.",
    exampleDescription: "A settings form inside a section with text, select, and checkbox fields plus submit and cancel actions.",
    tags: ["form", "composition"],
  },
  {
    id: "builtin.form.field-group",
    displayName: "Field Group",
    family: "composition",
    description:
      "Semantic grouping primitive for related fields, nested field groups, and validation messages.",
    purpose:
      "Group related input fields under a title, layout, and optional visibility or expansion semantics.",
    userSummary: "Groups related fields inside a larger form.",
    capabilities: [
      "Declares field grouping, title, description, layout, and collapsibility.",
      "Provides a semantic validation-state output for future composition summaries.",
    ],
    configurationFields: [
      stringField("title", "Title"),
      textAreaField("description", "Description"),
      enumField("layout", "Layout", layoutOptions, "vertical"),
      booleanField("collapsible", "Collapsible", false),
      booleanField("defaultExpanded", "Default expanded", true),
      booleanField("showGroupValidation", "Show group validation", true),
      stringField("visibilityCondition", "Visibility condition", "", "Declarative condition name, not code."),
    ],
    defaultConfiguration: {
      title: "",
      description: "",
      layout: "vertical",
      collapsible: false,
      defaultExpanded: true,
      showGroupValidation: true,
      visibilityCondition: "",
    },
    ports: [
      formAssetInputPort("fields", "Fields", "Field primitives contained by this group."),
      configurationInputPort("visibility-state", "Visibility state", "Optional visibility state descriptor."),
      formOutputPort("group-validation-state", "Group validation state", "Semantic aggregate validation state for this group.", "semantic-validation-state"),
    ],
    compositionRules: [
      allowedParentRule(
        "field-group.allowed-parent",
        "Field groups should be composed inside a form, another field group, or compatible UI structure.",
      ),
      allowedChildRule(
        "field-group.allows-fields",
        "Field groups may contain fields, validation messages, and nested field groups.",
        "forms-fields",
      ),
    ],
    configurationGuidance:
      "Use visibilityCondition as a named declarative condition only; do not include scripts or data queries.",
    compositionGuidance:
      "Use field groups for meaningful clusters such as contact details, preferences, or advanced options.",
    validationGuidance:
      "showGroupValidation only indicates whether a future implementation should present aggregate feedback.",
    accessibilityGuidance:
      "Use title and description when a group changes the meaning of fields inside it.",
    exampleDescription: "A collapsible notification preferences group containing checkboxes and a radio group.",
    tags: ["field-group", "grouping"],
  },
  {
    id: "builtin.form.text-field",
    displayName: "Text Field",
    family: "structural",
    description:
      "Semantic single-line text field definition for collecting short textual values.",
    purpose:
      "Represent a labeled short-text input need with help text, placeholder, requirement, length, and format hints.",
    userSummary: "Collects a short text value.",
    capabilities: [
      "Declares labels, help text, defaults, length hints, and accessibility labels.",
      "Emits semantic value-change, blur, and validation-request signals.",
    ],
    configurationFields: [
      stringField("label", "Label"),
      textAreaField("helpText", "Help text"),
      stringField("placeholder", "Placeholder"),
      booleanField("required", "Required", false),
      stringField("defaultValue", "Default value"),
      integerField("minLength", "Minimum length", 0, 0, 10000),
      integerField("maxLength", "Maximum length", 255, 0, 10000),
      stringField("patternHint", "Pattern hint", "", "Human-readable format hint, not code to run."),
      stringField("autocompleteHint", "Autocomplete hint"),
      booleanField("disabled", "Disabled", false),
      stringField("visibilityCondition", "Visibility condition", "", "Declarative condition name, not code."),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      label: "",
      helpText: "",
      placeholder: "",
      required: false,
      defaultValue: "",
      minLength: 0,
      maxLength: 255,
      patternHint: "",
      autocompleteHint: "",
      disabled: false,
      visibilityCondition: "",
      accessibilityLabel: "",
    },
    ports: fieldPorts(),
    compositionRules: fieldCompositionRules,
    configurationGuidance:
      "Use patternHint as human-readable guidance only and keep defaultValue free of private or user-specific data.",
    compositionGuidance:
      "Place text fields inside forms or field groups, optionally with a validation message child.",
    validationGuidance:
      "Length and pattern fields are declarative constraints for future validation behavior; no checking happens here.",
    accessibilityGuidance:
      "Provide a visible label or accessibilityLabel; use helpText for format expectations.",
    exampleDescription: "A display name field in an account form.",
    tags: ["field", "text"],
  },
  {
    id: "builtin.form.number-field",
    displayName: "Number Field",
    family: "structural",
    description:
      "Semantic numeric field definition for collecting numeric values with range and step hints.",
    purpose:
      "Represent a labeled numeric input need with optional range, step, and formatting semantics.",
    userSummary: "Collects a numeric value.",
    capabilities: [
      "Declares labels, help text, default value, range hints, step, and number formatting intent.",
      "Exposes semantic value and validation event ports.",
    ],
    configurationFields: [
      stringField("label", "Label"),
      textAreaField("helpText", "Help text"),
      stringField("placeholder", "Placeholder"),
      booleanField("required", "Required", false),
      numberField("defaultValue", "Default value", 0),
      numberField("minimum", "Minimum", 0),
      numberField("maximum", "Maximum", 100),
      numberField("step", "Step", 1),
      enumField("numberFormat", "Number format", ["plain", "decimal", "currency", "percentage"], "plain"),
      booleanField("disabled", "Disabled", false),
      stringField("visibilityCondition", "Visibility condition", "", "Declarative condition name, not code."),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      label: "",
      helpText: "",
      placeholder: "",
      required: false,
      defaultValue: 0,
      minimum: 0,
      maximum: 100,
      step: 1,
      numberFormat: "plain",
      disabled: false,
      visibilityCondition: "",
      accessibilityLabel: "",
    },
    ports: fieldPorts("semantic-number-value"),
    compositionRules: fieldCompositionRules,
    configurationGuidance:
      "Use range and step as semantic constraints; use numberFormat to express meaning rather than locale-specific formatting code.",
    compositionGuidance:
      "Place number fields in a form or field group where a numeric value is required.",
    validationGuidance:
      "minimum, maximum, and step are declarative and do not enforce user input in this catalog definition.",
    accessibilityGuidance:
      "Use helpText to explain expected units, scale, or range when the label is not enough.",
    exampleDescription: "A quantity or budget field in a request form.",
    tags: ["field", "number"],
  },
  {
    id: "builtin.form.text-area",
    displayName: "Text Area",
    family: "structural",
    description:
      "Semantic multi-line text field definition for longer user-provided text.",
    purpose:
      "Represent a longer text collection need with preferred rows, resize intent, and length hints.",
    userSummary: "Collects longer text.",
    capabilities: [
      "Declares multi-line text semantics without naming an element or renderer.",
      "Provides length and resize behavior hints for future implementation.",
    ],
    configurationFields: [
      stringField("label", "Label"),
      textAreaField("helpText", "Help text"),
      stringField("placeholder", "Placeholder"),
      booleanField("required", "Required", false),
      textAreaField("defaultValue", "Default value"),
      integerField("minLength", "Minimum length", 0, 0, 100000),
      integerField("maxLength", "Maximum length", 1000, 0, 100000),
      integerField("preferredRows", "Preferred rows", 4, 1, 40),
      enumField("resizeBehavior", "Resize behavior", ["fixed", "vertical", "flexible"], "vertical"),
      booleanField("disabled", "Disabled", false),
      stringField("visibilityCondition", "Visibility condition", "", "Declarative condition name, not code."),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      label: "",
      helpText: "",
      placeholder: "",
      required: false,
      defaultValue: "",
      minLength: 0,
      maxLength: 1000,
      preferredRows: 4,
      resizeBehavior: "vertical",
      disabled: false,
      visibilityCondition: "",
      accessibilityLabel: "",
    },
    ports: fieldPorts(),
    compositionRules: fieldCompositionRules,
    configurationGuidance:
      "Use preferredRows and resizeBehavior as abstract presentation hints rather than style rules.",
    compositionGuidance:
      "Place text areas in forms where narrative, description, notes, or feedback values are needed.",
    validationGuidance:
      "Length settings are declarative hints and do not count or reject values by themselves.",
    accessibilityGuidance:
      "Use helpText to describe expected content, especially for open-ended responses.",
    exampleDescription: "A comments field in a feedback form.",
    tags: ["field", "textarea"],
  },
  {
    id: "builtin.form.select-field",
    displayName: "Select Field",
    family: "structural",
    description:
      "Semantic single-selection field definition for choosing one value from declared options.",
    purpose:
      "Represent a labeled choice field with static or deferred options and empty-selection semantics.",
    userSummary: "Collects one selected option.",
    capabilities: [
      "Declares option-source intent and safe static option descriptors.",
      "Captures empty-selection, default value, and accessibility semantics.",
    ],
    configurationFields: [
      stringField("label", "Label"),
      textAreaField("helpText", "Help text"),
      stringField("placeholder", "Placeholder"),
      booleanField("required", "Required", false),
      enumField("optionsSource", "Options source", optionSourceOptions, "static"),
      semanticOptionDescriptorArrayField("staticOptions", "Static options"),
      stringField("defaultValue", "Default value"),
      booleanField("allowEmpty", "Allow empty", true),
      booleanField("disabled", "Disabled", false),
      stringField("visibilityCondition", "Visibility condition", "", "Declarative condition name, not code."),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      label: "",
      helpText: "",
      placeholder: "",
      required: false,
      optionsSource: "static",
      staticOptions: [],
      defaultValue: "",
      allowEmpty: true,
      disabled: false,
      visibilityCondition: "",
      accessibilityLabel: "",
    },
    ports: fieldPorts("semantic-option-value"),
    compositionRules: fieldCompositionRules,
    configurationGuidance:
      "Use staticOptions for safe label/value descriptors or optionsSource to declare that options are supplied elsewhere later.",
    compositionGuidance:
      "Place select fields inside forms when one choice from a known list is needed.",
    validationGuidance:
      "required and allowEmpty are declarative choice constraints; option resolution and checking are deferred.",
    accessibilityGuidance:
      "Use label and helpText to make the choice set understandable without relying on placeholder text.",
    exampleDescription: "A status selector in a task form.",
    tags: ["field", "select"],
  },
  {
    id: "builtin.form.checkbox-field",
    displayName: "Checkbox Field",
    family: "structural",
    description:
      "Semantic boolean field definition for collecting a checked or unchecked value.",
    purpose:
      "Represent a labeled yes/no or opt-in value with help text and requirement semantics.",
    userSummary: "Collects a true or false value.",
    capabilities: [
      "Declares label, help text, default checked state, and disabled state.",
      "Exposes semantic value change and validation request events.",
    ],
    configurationFields: [
      stringField("label", "Label"),
      textAreaField("helpText", "Help text"),
      booleanField("defaultChecked", "Default checked", false),
      booleanField("required", "Required", false),
      booleanField("disabled", "Disabled", false),
      stringField("visibilityCondition", "Visibility condition", "", "Declarative condition name, not code."),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      label: "",
      helpText: "",
      defaultChecked: false,
      required: false,
      disabled: false,
      visibilityCondition: "",
      accessibilityLabel: "",
    },
    ports: fieldPorts("semantic-boolean-value"),
    compositionRules: fieldCompositionRules,
    configurationGuidance:
      "Use label for the boolean statement being accepted or toggled; avoid embedding policy text as hidden behavior.",
    compositionGuidance:
      "Place checkbox fields in forms or field groups for independent boolean choices.",
    validationGuidance:
      "required only declares that a future implementation should consider affirmative state requirements.",
    accessibilityGuidance:
      "Write labels as clear statements so checked and unchecked states are understandable.",
    exampleDescription: "An opt-in preference checkbox in account settings.",
    tags: ["field", "checkbox"],
  },
  {
    id: "builtin.form.radio-group",
    displayName: "Radio Group",
    family: "structural",
    description:
      "Semantic mutually exclusive option group definition for choosing one value from visible options.",
    purpose:
      "Represent a labeled one-of-many choice set with option descriptors and layout intent.",
    userSummary: "Collects one selected value from a visible option group.",
    capabilities: [
      "Declares mutual selection semantics and option-source intent.",
      "Captures layout, default value, requirement, and accessibility guidance.",
    ],
    configurationFields: [
      stringField("label", "Label"),
      textAreaField("helpText", "Help text"),
      booleanField("required", "Required", false),
      enumField("optionsSource", "Options source", optionSourceOptions, "static"),
      semanticOptionDescriptorArrayField("staticOptions", "Static options"),
      stringField("defaultValue", "Default value"),
      enumField("layout", "Layout", fieldLayoutOptions, "vertical"),
      booleanField("disabled", "Disabled", false),
      stringField("visibilityCondition", "Visibility condition", "", "Declarative condition name, not code."),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      label: "",
      helpText: "",
      required: false,
      optionsSource: "static",
      staticOptions: [],
      defaultValue: "",
      layout: "vertical",
      disabled: false,
      visibilityCondition: "",
      accessibilityLabel: "",
    },
    ports: fieldPorts("semantic-option-value"),
    compositionRules: fieldCompositionRules,
    configurationGuidance:
      "Use radio groups when all key options should be visible and one selection is expected.",
    compositionGuidance:
      "Place radio groups in forms or field groups where a mutually exclusive choice is part of the task.",
    validationGuidance:
      "required and optionsSource are declarative; no option fetching or checking occurs in the definition.",
    accessibilityGuidance:
      "Provide a group label and concise option labels so the choice set can be navigated clearly.",
    exampleDescription: "A notification frequency choice group.",
    tags: ["field", "radio"],
  },
  {
    id: "builtin.form.date-time-field",
    displayName: "Date and Time Field",
    family: "structural",
    description:
      "Semantic date, time, or date-time field with portable range and format intent.",
    purpose:
      "Collect an ISO-compatible date/time value without embedding locale formatting or parser code.",
    userSummary: "Collects a date, time, or date-and-time value.",
    capabilities: [
      "Declares date/time kind, requirement, range, and autocomplete intent.",
      "Exposes the same semantic value and validation event ports as other fields.",
    ],
    configurationFields: [
      stringField("label", "Label"),
      textAreaField("helpText", "Help text"),
      booleanField("required", "Required", false),
      enumField("dateTimeKind", "Value kind", ["date", "time", "date-time"], "date"),
      stringField("defaultValue", "Default ISO value"),
      stringField("minimum", "Earliest ISO value"),
      stringField("maximum", "Latest ISO value"),
      stringField("autocompleteHint", "Autocomplete hint"),
      booleanField("disabled", "Disabled", false),
      stringField("visibilityCondition", "Visibility condition", "", "Declarative condition name, not code."),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      label: "",
      helpText: "",
      required: false,
      dateTimeKind: "date",
      defaultValue: "",
      minimum: "",
      maximum: "",
      autocompleteHint: "",
      disabled: false,
      visibilityCondition: "",
      accessibilityLabel: "",
    },
    ports: fieldPorts("semantic-date-time-value"),
    compositionRules: fieldCompositionRules,
    configurationGuidance:
      "Use ISO-compatible values and dateTimeKind; renderers localize presentation but preserve the semantic value.",
    compositionGuidance:
      "Place date/time fields inside forms or field groups and bind their semantic value through typed ports.",
    validationGuidance:
      "Range and format constraints are declarative; the trusted form runtime validates submitted values again.",
    accessibilityGuidance:
      "Use visible labels and help text to explain expected dates, times, time zones, and range constraints.",
    exampleDescription: "A required due-date field in a secured request form.",
    tags: ["field", "date", "time"],
  },
  {
    id: "builtin.form.validation-message",
    displayName: "Validation Message",
    family: "context",
    description:
      "Semantic validation feedback message associated with a form, field group, or field.",
    purpose:
      "Represent declarative validation feedback text and severity without running validation logic.",
    userSummary: "Describes validation feedback for a form or field.",
    capabilities: [
      "Declares message text, severity, visibility timing, and association target.",
      "Can participate in form or field composition as contextual feedback.",
    ],
    configurationFields: [
      textAreaField("message", "Message"),
      enumField("severity", "Severity", severityOptions, "error"),
      enumField("showWhen", "Show when", showWhenOptions, "when-invalid"),
      stringField("fieldRef", "Field reference", "", "Semantic field identifier or reference label."),
      enumField("summaryMode", "Summary mode", ["field", "group", "form"], "field"),
      enumField("accessibilityRole", "Accessibility role", ["status", "alert", "none"], "alert"),
    ],
    defaultConfiguration: {
      message: "",
      severity: "error",
      showWhen: "when-invalid",
      fieldRef: "",
      summaryMode: "field",
      accessibilityRole: "alert",
    },
    ports: [
      configurationInputPort("validation-state", "Validation state", "Validation state descriptor to summarize.", "semantic-validation-state"),
      configurationInputPort("field-ref", "Field reference", "Semantic field reference descriptor.", "semantic-field-reference"),
    ],
    compositionRules: [
      allowedParentRule(
        "validation-message.allowed-parent",
        "Validation messages should be placed with a form, field group, or field.",
      ),
    ],
    configurationGuidance:
      "Use message and severity to describe feedback intent; fieldRef is a safe semantic reference label, not a data query.",
    compositionGuidance:
      "Place validation messages near the form, group, or field they describe.",
    validationGuidance:
      "This primitive displays or summarizes validation state supplied elsewhere; it does not create validation results.",
    accessibilityGuidance:
      "Use accessibilityRole alert for errors that should be announced and status for lower-priority updates.",
    exampleDescription: "An error message associated with a required email field.",
    tags: ["validation", "message"],
  },
  {
    id: "builtin.form.submit-action",
    displayName: "Submit Action",
    family: "behavioral",
    description:
      "Semantic form submit action definition that emits intent without submitting data by itself.",
    purpose:
      "Represent the user's intent to submit a form while keeping submission handling outside this definition.",
    userSummary: "Requests form submission as a semantic action.",
    capabilities: [
      "Declares action label, pending label, confirmation requirement, and invalid-state behavior.",
      "Emits a submit-requested event for future composition.",
    ],
    configurationFields: [
      stringField("label", "Label", "Submit"),
      booleanField("confirmationRequired", "Confirmation required", false),
      booleanField("disabledWhenInvalid", "Disabled when invalid", true),
      stringField("successMessage", "Success message"),
      stringField("pendingLabel", "Pending label", "Submitting"),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      label: "Submit",
      confirmationRequired: false,
      disabledWhenInvalid: true,
      successMessage: "",
      pendingLabel: "Submitting",
      accessibilityLabel: "",
    },
    ports: [
      configurationInputPort("form-state", "Form state", "Semantic form state descriptor."),
      configurationInputPort("validation-state", "Validation state", "Semantic validation state descriptor."),
      formEventPort("submit-requested", "Submit requested", "Declarative event indicating submit intent."),
    ],
    compositionRules: [
      allowedParentRule(
        "submit-action.allowed-parent",
        "Submit actions should belong to a form or form action area.",
      ),
    ],
    configurationGuidance:
      "Use labels and confirmationRequired to describe user intent; do not include handlers, endpoints, or persistence behavior.",
    compositionGuidance:
      "Place submit actions inside a form, usually after fields or in a compatible structural container.",
    validationGuidance:
      "disabledWhenInvalid is a declarative hint based on validation state supplied elsewhere.",
    accessibilityGuidance:
      "Use accessibilityLabel when the visible label does not fully describe the submit action.",
    exampleDescription: "A save preferences action at the end of a settings form.",
    tags: ["action", "submit"],
  },
  {
    id: "builtin.form.cancel-action",
    displayName: "Cancel Action",
    family: "behavioral",
    description:
      "Semantic form cancel action definition that emits cancellation intent without navigation or reset behavior by itself.",
    purpose:
      "Represent a user's intent to cancel or reset form work while leaving effects to future composition.",
    userSummary: "Requests cancellation as a semantic action.",
    capabilities: [
      "Declares action label, confirmation requirement, and reset behavior intent.",
      "Emits a cancel-requested event for future composition.",
    ],
    configurationFields: [
      stringField("label", "Label", "Cancel"),
      booleanField("confirmationRequired", "Confirmation required", false),
      enumField("resetBehavior", "Reset behavior", ["none", "reset-to-initial", "clear-values"], "none"),
      stringField("accessibilityLabel", "Accessibility label"),
    ],
    defaultConfiguration: {
      label: "Cancel",
      confirmationRequired: false,
      resetBehavior: "none",
      accessibilityLabel: "",
    },
    ports: [
      configurationInputPort("form-state", "Form state", "Semantic form state descriptor."),
      formEventPort("cancel-requested", "Cancel requested", "Declarative event indicating cancel intent."),
    ],
    compositionRules: [
      allowedParentRule(
        "cancel-action.allowed-parent",
        "Cancel actions should belong to a form or form action area.",
      ),
    ],
    configurationGuidance:
      "Use resetBehavior as an abstract intent; do not include navigation targets, handlers, or storage behavior.",
    compositionGuidance:
      "Place cancel actions near submit actions in the form composition.",
    validationGuidance:
      "Cancel actions do not validate values; they only declare cancellation or reset intent.",
    accessibilityGuidance:
      "Use a clear label when cancellation could discard entered values.",
    exampleDescription: "A cancel action next to a submit action in a profile form.",
    tags: ["action", "cancel"],
  },
];

export const FORM_PRIMITIVE_DEFINITIONS = specs.map(createFormPrimitiveDefinition);

export const FORM_PRIMITIVE_ENTRIES = FORM_PRIMITIVE_DEFINITIONS.map(
  (definition, index) =>
    createFormPrimitiveEntry(definition, specs[index]?.tags ?? []),
);

export const FORM_PRIMITIVE_CATALOG = {
  categoryId: "forms-fields",
  version: FORM_PRIMITIVE_VERSION,
  definitions: FORM_PRIMITIVE_DEFINITIONS,
  entries: FORM_PRIMITIVE_ENTRIES,
  deferredPrimitiveIds: DEFERRED_FORM_PRIMITIVE_IDS,
} as const;

function fieldPorts(valueDataKind = "semantic-field-value"): readonly AssetPort[] {
  return [
    configurationInputPort("value", "Value", "Current semantic value descriptor.", valueDataKind),
    configurationInputPort("disabled-state", "Disabled state", "Optional disabled state descriptor."),
    configurationInputPort("validation-state", "Validation state", "Optional validation state descriptor.", "semantic-validation-state"),
    formEventPort("value-changed", "Value changed", "Declarative event indicating value change.", valueDataKind),
    formEventPort("field-blurred", "Field blurred", "Declarative event indicating focus left the field.", "semantic-field-event"),
    formEventPort("validation-requested", "Validation requested", "Declarative event indicating validation should be considered.", "semantic-form-event"),
  ];
}
