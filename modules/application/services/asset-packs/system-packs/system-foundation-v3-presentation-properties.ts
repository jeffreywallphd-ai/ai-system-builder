import type {
  AssetConfigurationField,
  AssetDefinition,
  AssetJsonValue,
} from "../../../../contracts/asset";

export const SYSTEM_FOUNDATION_THEME_COLOR_FIELD_IDS = [
  "themeColorPrimary",
  "themeColorSecondary",
  "themeColorTertiary",
  "themeColorSurface",
  "themeColorCanvas",
  "themeColorText",
  "themeColorMutedText",
  "themeColorBorder",
  "themeColorSuccess",
  "themeColorDanger",
] as const;

export const SYSTEM_FOUNDATION_THEME_CHOICE_FIELD_IDS = [
  "themeFontFamily",
  "themeTextSize",
  "themeHeadingScale",
  "themeDensity",
  "themeButtonTreatment",
  "themeButtonShape",
  "themeFormTreatment",
  "themeSurfaceTreatment",
] as const;

export const SYSTEM_FOUNDATION_COMMON_STYLE_OVERRIDE_FIELD_IDS = [
  "styleSurfaceRole",
  "styleTextRole",
  "styleTypographyRole",
  "styleSpacing",
  "styleBorder",
] as const;

export interface SystemFoundationPresentationAudit {
  readonly definitionId: string;
  readonly frontendBacked: boolean;
  readonly configurablePropertyIds: readonly string[];
  readonly rendererPropertyIds: readonly string[];
  readonly fixedStructuralElements: readonly string[];
}

export function withSystemFoundationV3PresentationProperties(
  definition: AssetDefinition,
): AssetDefinition {
  if (!isFrontendBackedFoundationDefinition(definition)) return definition;
  const definitionId = String(definition.definitionId);
  const additions = [
    ...genericPresentationFields(definitionId, definition.displayName),
    ...conversationFields(definitionId),
    ...(definitionId === "builtin.system.system" ? themeFields() : []),
    ...commonStyleOverrideFields(),
    ...(isButtonDefinition(definitionId) ? buttonStyleOverrideFields() : []),
    ...(isFormDefinition(definitionId) ? formStyleOverrideFields() : []),
  ];
  const fields = mergeFields(
    definition.configurationSchema?.fields ?? [],
    additions,
  );
  const defaults: Record<string, AssetJsonValue> = {
    ...(definition.defaultConfiguration ?? {}),
  };
  for (const field of additions) {
    if (field.defaultValue !== undefined && defaults[field.fieldId] === undefined) {
      defaults[field.fieldId] = field.defaultValue;
    }
  }
  return {
    ...definition,
    configurationSchema: {
      ...(definition.configurationSchema ?? {
        schemaId: `${definitionId}.configuration`,
      }),
      schemaVersion: definition.version,
      fields,
      requiredFieldIds: [
        ...new Set([
          ...(definition.configurationSchema?.requiredFieldIds ?? []),
          ...additions
            .filter((field) => field.required)
            .map((field) => field.fieldId),
        ]),
      ],
      strict: true,
      description:
        definition.configurationSchema?.description ??
        `${definition.displayName} property-complete presentation configuration.`,
      metadata: {
        ...(definition.configurationSchema?.metadata ?? {}),
        propertyCompletePresentation: true,
        boundedSemanticStyling: true,
      },
    },
    defaultConfiguration: defaults,
    aiContext: {
      ...definition.aiContext,
      configurationGuidance: {
        ...(definition.aiContext?.configurationGuidance ?? {
          summary: "Configure this asset through its declared bounded fields.",
        }),
        summary:
          "Configure visible content through declared properties and styling through bounded semantic roles; raw CSS, selectors, and arbitrary dimensions are not accepted.",
        recommendedDefaults: defaults,
      },
    },
    metadata: {
      ...(definition.metadata ?? {}),
      propertyCompletePresentation: true,
      boundedSemanticStyling: true,
    },
  };
}

export function auditSystemFoundationPresentationDefinition(
  definition: AssetDefinition,
): SystemFoundationPresentationAudit {
  const definitionId = String(definition.definitionId);
  return {
    definitionId,
    frontendBacked: isFrontendBackedFoundationDefinition(definition),
    configurablePropertyIds:
      definition.configurationSchema?.fields.map((field) => field.fieldId) ?? [],
    rendererPropertyIds: rendererPropertyIds(definition),
    fixedStructuralElements: fixedStructuralElements(definition),
  };
}

export function isFrontendBackedFoundationDefinition(
  definition: AssetDefinition,
): boolean {
  const id = String(definition.definitionId);
  return (
    id === "builtin.system.system" ||
    id === "builtin.feature.record-form" ||
    id === "builtin.feature.data-preview" ||
    [
      "builtin.layout.",
      "builtin.ui.",
      "builtin.shell.",
      "builtin.form.",
      "builtin.display.",
      "builtin.state.",
      "builtin.preview.",
      "conversation.",
    ].some((prefix) => id.startsWith(prefix))
  );
}

function rendererPropertyIds(definition: AssetDefinition): readonly string[] {
  if (!isFrontendBackedFoundationDefinition(definition)) return [];
  const id = String(definition.definitionId);
  const contentFields = rendererContentPropertyIds(id);
  return [
    ...contentFields,
    ...(id === "builtin.system.system"
      ? [
          ...SYSTEM_FOUNDATION_THEME_COLOR_FIELD_IDS,
          ...SYSTEM_FOUNDATION_THEME_CHOICE_FIELD_IDS,
        ]
      : []),
    ...SYSTEM_FOUNDATION_COMMON_STYLE_OVERRIDE_FIELD_IDS,
    ...(isButtonDefinition(id)
      ? ["styleButtonRole", "styleButtonTreatment"]
      : []),
    ...(isFormDefinition(id)
      ? ["styleFormRole", "styleFormTreatment", "styleControlSize"]
      : []),
  ];
}

function rendererContentPropertyIds(id: string): readonly string[] {
  const conversation = conversationFields(id).map((field) => field.fieldId);
  if (conversation.length) return conversation;
  if (id === "builtin.system.system") return ["title", "description"];
  if (id.startsWith("builtin.layout.")) return ["title", "accessibilityLabel"];
  if (id === "builtin.shell.navigation-group") {
    return ["label", "accessibilityLabel"];
  }
  if (
    id.startsWith("builtin.shell.") ||
    ["builtin.ui.card", "builtin.ui.section", "builtin.ui.panel"].includes(id)
  ) {
    return ["title", "description"];
  }
  if (id === "builtin.ui.collapsible-section") {
    return ["title", "defaultExpanded"];
  }
  if (id === "builtin.ui.tabs") return ["title", "defaultTab"];
  if (id === "builtin.form.form") return ["title", "description"];
  if (id === "builtin.form.field-group") {
    return ["title", "description", "collapsible", "defaultExpanded"];
  }
  if (id.startsWith("builtin.form.")) {
    return formRendererPropertyIds(id);
  }
  if (id === "builtin.display.table") return ["title", "columns"];
  if (
    id === "builtin.display.detail-view" ||
    id === "builtin.display.key-value-summary" ||
    id === "builtin.display.list"
  ) {
    return ["title"];
  }
  if (id === "builtin.display.status-badge") return ["label", "status"];
  if (id === "builtin.display.progress-indicator") return ["title", "value"];
  if (id === "builtin.display.image-preview-placeholder") {
    return ["title", "altText"];
  }
  if (id === "builtin.display.resource-preview-placeholder") {
    return ["title", "description"];
  }
  if (id.startsWith("builtin.display.")) return ["title"];
  if (id.startsWith("builtin.state.")) return ["title", "message"];
  if (id.startsWith("builtin.preview.")) return ["title"];
  return [];
}

function formRendererPropertyIds(id: string): readonly string[] {
  if (isButtonDefinition(id)) return ["label"];
  if (id === "builtin.form.validation-message") return ["label", "message"];
  if (id === "builtin.form.checkbox-field") return ["label", "required"];
  if (id === "builtin.form.radio-group") {
    return ["label", "required", "helpText", "staticOptions", "defaultValue", "disabled"];
  }
  if (id === "builtin.form.select-field") {
    return ["label", "required", "staticOptions"];
  }
  if (id === "builtin.form.number-field") {
    return ["label", "required", "placeholder", "minimum", "maximum"];
  }
  return ["label", "required", "placeholder"];
}

function genericPresentationFields(
  definitionId: string,
  displayName: string,
): readonly AssetConfigurationField[] {
  if (definitionId === "builtin.ui.tabs") {
    return [textField("title", "Title", displayName, "Content", 1)];
  }
  if (definitionId === "builtin.form.date-time-field") {
    return [textField("placeholder", "Placeholder", "", "Content", 9)];
  }
  if (definitionId === "builtin.form.validation-message") {
    return [textField("label", "Label", displayName, "Content", 1)];
  }
  if (definitionId === "builtin.display.progress-indicator") {
    return [
      textField("title", "Title", displayName, "Content", 1),
      numberField("value", "Preview value", 40, "Preview", 2),
    ];
  }
  if (definitionId === "builtin.state.loading-state") {
    return [textField("title", "Title", displayName, "Content", 1)];
  }
  if (
    [
      "builtin.preview.text",
      "builtin.preview.table",
      "builtin.preview.raster-image",
      "builtin.preview.unsupported",
    ].includes(definitionId)
  ) {
    return [textField("title", "Title", displayName, "Content", 1)];
  }
  return [];
}

function fixedStructuralElements(
  definition: AssetDefinition,
): readonly string[] {
  const id = String(definition.definitionId);
  return [
    "semantic-html-element",
    "safe-preview-fixture-data",
    ...(definition.slots?.length ? ["declared-slot-region-labels"] : []),
    ...(id === "builtin.display.detail-view" ||
    id === "builtin.display.key-value-summary"
      ? ["safe-preview-field-labels"]
      : []),
    ...(id === "builtin.display.list" ? ["fallback-item-numbering"] : []),
    ...(id === "builtin.form.select-field" ? ["empty-selection-prompt"] : []),
    ...(id.startsWith("builtin.preview.")
      ? ["preview-placeholder-kind-label"]
      : []),
  ];
}

function conversationFields(definitionId: string): readonly AssetConfigurationField[] {
  switch (definitionId) {
    case "conversation.user-message-input":
      return [
        textField("label", "Label", "Message", "Content", 1),
        textField("placeholder", "Placeholder", "Enter a message", "Content", 2),
        textField("accessibilityLabel", "Accessibility label", "Message", "Accessibility", 3),
      ];
    case "conversation.assistant-text-response-output":
      return [
        textAreaField("content", "Preview response", "The assistant response will appear here.", "Content", 1),
        textField("accessibilityLabel", "Accessibility label", "Assistant response", "Accessibility", 2),
      ];
    case "conversation.history-reference":
      return [
        textField("title", "Title", "Conversation history", "Content", 1),
        textField("emptyMessage", "Empty message", "No conversation history yet.", "States", 2),
        textField("accessibilityLabel", "Accessibility label", "Conversation history", "Accessibility", 3),
      ];
    case "conversation.message-composer":
      return [
        modelResourceField(),
        textField("accessibilityLabel", "Accessibility label", "Message composer", "Accessibility", 2),
      ];
    case "conversation.message-history-display":
      return [
        textField("title", "Title", "Conversation", "Content", 1),
        textField("userRoleLabel", "User role label", "You", "Content", 2),
        textField("assistantRoleLabel", "Assistant role label", "Assistant", "Content", 3),
        textField("emptyMessage", "Empty message", "No messages yet.", "States", 4),
        textField("accessibilityLabel", "Accessibility label", "Conversation history", "Accessibility", 5),
      ];
    case "conversation.assistant-response-panel":
      return [
        textField("title", "Title", "Assistant response", "Content", 1),
        textField("accessibilityLabel", "Accessibility label", "Assistant response", "Accessibility", 2),
      ];
    case "conversation.chat-shell":
      return shellContentFields("Conversation", "Conversation interface");
    case "conversation.basic-assistant-system":
      return shellContentFields("Basic assistant", "Basic assistant system");
    default:
      return definitionId.startsWith("conversation.")
        ? [
            textField("title", "Title", readableName(definitionId), "Content", 1),
            textField("accessibilityLabel", "Accessibility label", readableName(definitionId), "Accessibility", 2),
          ]
        : [];
  }
}

function shellContentFields(
  defaultTitle: string,
  defaultAccessibilityLabel: string,
): readonly AssetConfigurationField[] {
  return [
    textField("title", "Title", defaultTitle, "Content", 1),
    textAreaField("description", "Description", "", "Content", 2),
    textField(
      "accessibilityLabel",
      "Accessibility label",
      defaultAccessibilityLabel,
      "Accessibility",
      3,
    ),
  ];
}

function themeFields(): readonly AssetConfigurationField[] {
  return [
    colorField("themeColorPrimary", "Primary color", "#2563eb", 1),
    colorField("themeColorSecondary", "Secondary color", "#475569", 2),
    colorField("themeColorTertiary", "Tertiary color", "#7c3aed", 3),
    colorField("themeColorSurface", "Surface color", "#ffffff", 4),
    colorField("themeColorCanvas", "Canvas color", "#f8fafc", 5),
    colorField("themeColorText", "Text color", "#0f172a", 6),
    colorField("themeColorMutedText", "Muted text color", "#64748b", 7),
    colorField("themeColorBorder", "Border color", "#cbd5e1", 8),
    colorField("themeColorSuccess", "Success color", "#15803d", 9),
    colorField("themeColorDanger", "Danger color", "#b91c1c", 10),
    enumField("themeFontFamily", "Font family", ["system", "humanist", "geometric", "serif"], "system", "Typography", 20),
    enumField("themeTextSize", "Text size", ["small", "medium", "large"], "medium", "Typography", 21),
    enumField("themeHeadingScale", "Heading scale", ["compact", "standard", "prominent"], "standard", "Typography", 22),
    enumField("themeDensity", "Density", ["compact", "comfortable", "spacious"], "comfortable", "Spacing", 30),
    enumField("themeButtonTreatment", "Button style", ["solid", "outline", "soft"], "solid", "Buttons", 40),
    enumField("themeButtonShape", "Button shape", ["square", "rounded", "pill"], "rounded", "Buttons", 41),
    enumField("themeFormTreatment", "Form style", ["outlined", "filled", "underlined"], "outlined", "Forms", 50),
    enumField("themeSurfaceTreatment", "Background style", ["flat", "outlined", "soft"], "outlined", "Backgrounds", 60),
  ].map((field) => withStyleMetadata(field, "theme"));
}

function commonStyleOverrideFields(): readonly AssetConfigurationField[] {
  return [
    enumField("styleSurfaceRole", "Background role", ["inherit", "canvas", "primary", "secondary", "tertiary", "surface", "transparent"], "inherit", "Style overrides", 100),
    enumField("styleTextRole", "Text role", ["inherit", "default", "muted", "accent", "on-primary"], "inherit", "Style overrides", 101),
    enumField("styleTypographyRole", "Typography role", ["inherit", "body", "label", "heading", "display"], "inherit", "Style overrides", 102),
    enumField("styleSpacing", "Spacing", ["inherit", "compact", "standard", "comfortable"], "inherit", "Style overrides", 103),
    enumField("styleBorder", "Border", ["inherit", "none", "subtle", "strong"], "inherit", "Style overrides", 104),
  ].map((field) => withStyleMetadata(field, "override"));
}

function buttonStyleOverrideFields(): readonly AssetConfigurationField[] {
  return [
    enumField("styleButtonRole", "Button role", ["inherit", "primary", "secondary", "tertiary", "danger"], "inherit", "Button override", 110),
    enumField("styleButtonTreatment", "Button style", ["inherit", "solid", "outline", "soft"], "inherit", "Button override", 111),
  ].map((field) => withStyleMetadata(field, "override"));
}

function formStyleOverrideFields(): readonly AssetConfigurationField[] {
  return [
    enumField("styleFormRole", "Form role", ["inherit", "default", "primary", "secondary"], "inherit", "Form override", 120),
    enumField("styleFormTreatment", "Form style", ["inherit", "outlined", "filled", "underlined"], "inherit", "Form override", 121),
    enumField("styleControlSize", "Control size", ["inherit", "small", "medium", "large"], "inherit", "Form override", 122),
  ].map((field) => withStyleMetadata(field, "override"));
}

function colorField(
  fieldId: string,
  label: string,
  defaultValue: string,
  order: number,
): AssetConfigurationField {
  return {
    fieldId,
    valueKind: "string",
    label,
    defaultValue,
    constraints: [
      {
        constraintKind: "pattern",
        value: "^#[0-9A-Fa-f]{6}$",
        message: "Choose a six-digit hexadecimal color.",
      },
    ],
    uiHint: { hintKind: "color", section: "Theme colors", order },
  };
}

function textField(
  fieldId: string,
  label: string,
  defaultValue: string,
  section: string,
  order: number,
): AssetConfigurationField {
  return {
    fieldId,
    valueKind: "string",
    label,
    defaultValue,
    uiHint: { hintKind: "text", section, order },
  };
}

function modelResourceField(): AssetConfigurationField {
  return {
    fieldId: "modelBinding",
    valueKind: "resource-reference",
    label: "Text generation model",
    description:
      "Choose a runnable text model authorized for the current workspace.",
    required: true,
    uiHint: {
      hintKind: "resource-picker",
      section: "Model",
      order: 1,
      metadata: {
        editorScope: "properties",
        resourceKind: "model",
        capabilityKind: "text-generation",
      },
    },
    metadata: {
      resourceKind: "model",
      capabilityKind: "text-generation",
      resourceScope: "workspace-model-registry",
    },
  };
}

function textAreaField(
  fieldId: string,
  label: string,
  defaultValue: string,
  section: string,
  order: number,
): AssetConfigurationField {
  return {
    fieldId,
    valueKind: "string",
    label,
    defaultValue,
    uiHint: { hintKind: "textarea", section, order },
  };
}

function numberField(
  fieldId: string,
  label: string,
  defaultValue: number,
  section: string,
  order: number,
): AssetConfigurationField {
  return {
    fieldId,
    valueKind: "number",
    label,
    defaultValue,
    uiHint: { hintKind: "number", section, order },
  };
}

function enumField(
  fieldId: string,
  label: string,
  choices: readonly string[],
  defaultValue: string,
  section: string,
  order: number,
): AssetConfigurationField {
  return {
    fieldId,
    valueKind: "enum",
    label,
    defaultValue,
    options: choices.map((value) => ({
      value,
      label: readableChoice(value),
    })),
    constraints: [{ constraintKind: "one-of", value: [...choices] }],
    uiHint: { hintKind: "select", section, order },
  };
}

function withStyleMetadata(
  field: AssetConfigurationField,
  scope: "theme" | "override",
): AssetConfigurationField {
  return {
    ...field,
    uiHint: {
      ...(field.uiHint ?? { hintKind: "select" }),
      metadata: {
        ...(field.uiHint?.metadata ?? {}),
        editorScope: scope === "theme" ? "styling" : "properties",
        semanticStyleField: true,
        styleScope: scope,
      },
    },
    metadata: {
      ...(field.metadata ?? {}),
      semanticStyleField: true,
      styleScope: scope,
    },
  };
}

function mergeFields(
  existing: readonly AssetConfigurationField[],
  additions: readonly AssetConfigurationField[],
): readonly AssetConfigurationField[] {
  const fields = new Map(existing.map((field) => [field.fieldId, field]));
  for (const field of additions) {
    fields.set(field.fieldId, { ...fields.get(field.fieldId), ...field });
  }
  return [...fields.values()];
}

function isButtonDefinition(definitionId: string): boolean {
  return ["builtin.form.submit-action", "builtin.form.cancel-action"].includes(
    definitionId,
  );
}

function isFormDefinition(definitionId: string): boolean {
  return definitionId.startsWith("builtin.form.");
}

function readableName(definitionId: string): string {
  return readableChoice(definitionId.split(".").pop() ?? definitionId);
}

function readableChoice(value: string): string {
  const words = value.replace(/[-_]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
