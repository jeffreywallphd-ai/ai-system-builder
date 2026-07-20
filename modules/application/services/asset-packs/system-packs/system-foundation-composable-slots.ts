import type {
  AssetDefinition,
  AssetSlotDefinition,
  AssetType,
} from "../../../../contracts/asset";
import { ASSET_SLOT_DEFINITION_SCHEMA_VERSION } from "../../../../contracts/asset";

interface SlotSpec {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly maximum: number;
  readonly types?: readonly AssetType[];
  readonly regionKind?: string;
}

const UI_TYPES = [
  "ui-component",
  "page",
  "feature",
] as const satisfies readonly AssetType[];
const ACTION_TYPES = ["ui-component"] as const satisfies readonly AssetType[];

const slotsByDefinitionId: Readonly<Record<string, readonly SlotSpec[]>> = {
  "builtin.ui.container": [
    slot(
      "content",
      "Content",
      "Related visual content grouped by this container.",
      64,
    ),
  ],
  "builtin.ui.section": [
    slot("content", "Content", "The primary content of this section.", 64),
    slot(
      "actions",
      "Actions",
      "Optional controls associated with this section.",
      8,
      ACTION_TYPES,
    ),
  ],
  "builtin.ui.panel": [
    slot(
      "content",
      "Content",
      "The primary information or controls in this panel.",
      64,
    ),
    slot(
      "actions",
      "Actions",
      "Optional controls associated with this panel.",
      8,
      ACTION_TYPES,
    ),
  ],
  "builtin.ui.card": [
    slot("media", "Media", "Optional leading or top visual media.", 1, [
      "ui-component",
    ]),
    slot(
      "content",
      "Content",
      "The primary configurable content of this card.",
      32,
    ),
    slot(
      "actions",
      "Actions",
      "Optional controls associated with this card.",
      8,
      ACTION_TYPES,
    ),
  ],
  "builtin.ui.stack": [
    slot("items", "Items", "Ordered visual items arranged by the stack.", 64),
  ],
  "builtin.ui.grid": [
    slot("items", "Items", "Ordered visual items arranged by the grid.", 64),
  ],
  "builtin.ui.tabs": [
    slot(
      "tabs",
      "Tabs",
      "Ordered content surfaces represented by the tab set.",
      12,
    ),
  ],
  "builtin.ui.collapsible-section": [
    slot(
      "content",
      "Content",
      "Content revealed by the disclosure control.",
      64,
    ),
  ],
  "builtin.shell.page": [
    slot(
      "content",
      "Content",
      "Screen-level content contained by this page.",
      64,
    ),
    slot(
      "actions",
      "Actions",
      "Optional page-level controls.",
      8,
      ACTION_TYPES,
    ),
  ],
  "builtin.shell.feature": [
    slot("content", "Content", "Visual content contained by this feature.", 64),
    slot("actions", "Actions", "Optional feature controls.", 8, ACTION_TYPES),
    slot("states", "States", "User-visible feature states.", 12, [
      "ui-component",
    ]),
  ],
  "builtin.shell.dashboard-section": [
    slot(
      "content",
      "Content",
      "Summary content contained by this dashboard section.",
      64,
    ),
  ],
  "builtin.shell.settings-panel": [
    slot("content", "Content", "Settings form and validation content.", 64),
    slot("actions", "Actions", "Settings controls.", 8, ACTION_TYPES),
  ],
  "builtin.shell.resource-browser": [
    slot(
      "filters",
      "Filters",
      "Controls that narrow the visible resource list.",
      16,
      ["ui-component"],
    ),
    slot("results", "Results", "The resource list or table.", 8, [
      "ui-component",
    ]),
    slot("states", "States", "Loading, empty, error, and success states.", 12, [
      "ui-component",
    ]),
    slot("actions", "Actions", "Resource browser controls.", 8, ACTION_TYPES),
  ],
  "builtin.shell.detail-page": [
    slot(
      "summary",
      "Summary",
      "Summary information for the selected item.",
      16,
      ["ui-component"],
    ),
    slot("content", "Content", "Detailed content and previews.", 32),
    slot("actions", "Actions", "Detail-page controls.", 8, ACTION_TYPES),
    slot("states", "States", "User-visible detail states.", 12, [
      "ui-component",
    ]),
  ],
  "builtin.shell.wizard-step": [
    slot("content", "Content", "The form or information for this step.", 64),
    slot(
      "actions",
      "Actions",
      "Next, back, or skip controls.",
      8,
      ACTION_TYPES,
    ),
  ],
  "builtin.shell.navigation-group": [
    slot(
      "items",
      "Items",
      "Ordered navigation concepts in this group.",
      32,
      UI_TYPES,
    ),
  ],
  "builtin.form.form": [
    slot("fields", "Fields", "Ordered form fields and field groups.", 64, [
      "ui-component",
    ]),
    slot(
      "actions",
      "Actions",
      "Submit, cancel, and related form controls.",
      8,
      ACTION_TYPES,
    ),
    slot("messages", "Messages", "Validation and form status messages.", 12, [
      "ui-component",
    ]),
  ],
  "builtin.form.field-group": [
    slot("fields", "Fields", "Ordered fields in this group.", 32, [
      "ui-component",
    ]),
    slot("messages", "Messages", "Validation messages for this group.", 8, [
      "ui-component",
    ]),
  ],
  "builtin.display.detail-view": [
    slot("content", "Content", "Detailed values and nested summaries.", 32, [
      "ui-component",
    ]),
    slot(
      "actions",
      "Actions",
      "Optional detail-view controls.",
      8,
      ACTION_TYPES,
    ),
  ],
  "builtin.preview.artifact": [
    slot(
      "previews",
      "Previews",
      "Qualified type-specific preview alternatives.",
      8,
      ["ui-component"],
    ),
    slot(
      "states",
      "States",
      "Unavailable, oversized, or malformed preview states.",
      8,
      ["ui-component"],
    ),
  ],
  "conversation.basic-assistant-system": [
    slot(
      "interface",
      "Interface",
      "The user-visible conversation interface.",
      4,
      ["feature", "ui-component"],
    ),
  ],
  "conversation.chat-shell": [
    slot(
      "status",
      "Status",
      "Conversation readiness and completion status.",
      4,
      ["ui-component"],
    ),
    slot(
      "history",
      "History",
      "Conversation history and assistant response content.",
      16,
      ["ui-component"],
    ),
    slot(
      "composer",
      "Composer",
      "The message input and submission surface.",
      4,
      ["ui-component"],
    ),
    slot("states", "States", "Empty and error conversation states.", 12, [
      "ui-component",
    ]),
  ],
  "conversation.message-history-display": [
    slot(
      "messages",
      "Messages",
      "Visible conversation messages.",
      64,
      UI_TYPES,
    ),
  ],
  "conversation.assistant-response-panel": [
    slot("content", "Content", "The assistant response content.", 8, UI_TYPES),
    slot(
      "states",
      "States",
      "Generating, unsupported, error, and completion states.",
      12,
      ["ui-component"],
    ),
  ],
  "conversation.message-composer": [
    slot("input", "Input", "The user message input.", 2, UI_TYPES),
    slot("actions", "Actions", "Message submission controls.", 4, ACTION_TYPES),
  ],
};

export function withCurrentFoundationComposableSlots(
  definition: AssetDefinition,
): AssetDefinition {
  if (definition.slots?.length) return definition;
  const specs = slotsByDefinitionId[String(definition.definitionId)];
  return specs?.length
    ? { ...definition, slots: specs.map(createSlotDefinition) }
    : definition;
}

export function currentFoundationComposableDefinitionIds(): readonly string[] {
  return Object.keys(slotsByDefinitionId);
}

function slot(
  id: string,
  label: string,
  description: string,
  maximum: number,
  types: readonly AssetType[] = UI_TYPES,
): SlotSpec {
  return {
    id,
    label,
    description,
    maximum,
    types,
    regionKind: id,
  };
}

function createSlotDefinition(spec: SlotSpec): AssetSlotDefinition {
  return {
    schemaVersion: ASSET_SLOT_DEFINITION_SCHEMA_VERSION,
    slotId: spec.id as AssetSlotDefinition["slotId"],
    displayName: spec.label,
    description: spec.description,
    cardinality: { minItems: 0, maxItems: spec.maximum },
    acceptedAssetTypes: spec.types ?? UI_TYPES,
    metadata: {
      fixed: true,
      semanticRegion: true,
      regionKind: spec.regionKind ?? spec.id,
    },
  };
}
