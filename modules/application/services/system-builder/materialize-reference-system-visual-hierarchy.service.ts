import type {
  AssetConfigurationValues,
  AssetInstance,
  AssetPlacement,
  AssetReference,
} from "../../../contracts/asset";
import {
  ASSET_PLACEMENT_SCHEMA_VERSION,
  normalizeAssetId,
  normalizeAssetPlacements,
} from "../../../contracts/asset";
import {
  exactSystemFoundationDefinitionReference,
  readSystemFoundationManifest,
} from "../asset-packs/system-packs";

type ReferenceSystemKind =
  "secured-data-entry" | "controlled-chatbot" | "secured-data-review";

interface VisualPlacementSpec {
  readonly parentSuffix: string;
  readonly slotId: string;
  readonly childSuffixes: readonly string[];
}

export interface MaterializeReferenceSystemVisualHierarchyInput {
  readonly systemId: string;
  readonly compositionId: string;
  readonly actorId: string;
  readonly timestamp: string;
  readonly instances: readonly AssetInstance[];
  readonly placements: readonly AssetPlacement[];
}

export interface MaterializedReferenceSystemVisualHierarchy {
  readonly instances: readonly AssetInstance[];
  readonly placements: readonly AssetPlacement[];
}

const profilePlacements: Readonly<
  Record<ReferenceSystemKind, readonly VisualPlacementSpec[]>
> = {
  "secured-data-entry": [
    placement("page", "content", ["entry-stack"]),
    placement("entry-stack", "items", ["form-card", "records-grid"]),
    placement("form-card", "content", ["form"]),
    placement("records-grid", "items", ["list-card", "detail-card"]),
    placement("list-card", "content", ["table"]),
    placement("detail-card", "content", ["detail"]),
    placement("form", "fields", [
      "title-input",
      "amount-input",
      "status-input",
      "due-date-input",
    ]),
    placement("form", "actions", ["visual-submit"]),
  ],
  "controlled-chatbot": [
    placement("page", "content", ["starter"]),
    placement("starter", "interface", ["chat-shell"]),
    placement("chat-shell", "status", ["status"]),
    placement("chat-shell", "history", ["history-display", "response-panel"]),
    placement("chat-shell", "composer", ["composer"]),
    placement("chat-shell", "states", ["empty"]),
    placement("response-panel", "content", ["assistant-output"]),
    placement("response-panel", "states", [
      "loading",
      "unsupported",
      "error",
      "success",
    ]),
    placement("composer", "input", ["user-input"]),
    placement("composer", "actions", ["visual-send"]),
  ],
  "secured-data-review": [
    placement("page", "content", ["review-grid"]),
    placement("review-grid", "items", ["browser", "detail-page"]),
    placement("browser", "filters", ["name-filter", "media-filter"]),
    placement("browser", "results", ["table"]),
    placement("browser", "states", ["loading", "empty"]),
    placement("detail-page", "summary", ["summary"]),
    placement("detail-page", "content", ["detail", "preview"]),
    placement("detail-page", "states", ["success"]),
    placement("preview", "previews", [
      "text-preview",
      "table-preview",
      "image-preview",
      "pdf-preview",
      "unsupported-preview",
    ]),
    placement("preview", "states", [
      "unavailable",
      "oversized",
      "unauthorized",
      "malformed",
    ]),
  ],
};

export function materializeReferenceSystemVisualHierarchy(
  input: MaterializeReferenceSystemVisualHierarchyInput,
): MaterializedReferenceSystemVisualHierarchy {
  const kind = referenceSystemKind(input.instances);
  if (!kind) {
    return {
      instances: input.instances,
      placements: normalizeAssetPlacements(input.placements),
    };
  }

  const generatedEmptyIds = new Set(
    input.instances
      .filter((instance) =>
        String(instance.instanceId).startsWith(`${input.systemId}.page-`),
      )
      .filter((instance) => String(instance.instanceId).includes("-content-"))
      .map((instance) => String(instance.instanceId)),
  );
  const foundationVersion = referenceFoundationVersion(input.instances);
  const instances = input.instances.filter(
    (instance) => !generatedEmptyIds.has(String(instance.instanceId)),
  );
  const placements = input.placements.filter(
    (item) =>
      !generatedEmptyIds.has(String(item.childInstanceRef.id)) &&
      !generatedEmptyIds.has(String(item.parentInstanceRef.id)),
  );
  const bySuffix = new Map<string, AssetInstance>();
  for (const instance of instances) {
    const suffix = instanceSuffix(input.systemId, instance);
    if (suffix) bySuffix.set(suffix, instance);
  }

  const pageLayout = instances.find((instance) =>
    String(instance.definitionRef.id).startsWith("builtin.layout.page."),
  );
  const shell = instances.find((instance) =>
    String(instance.definitionRef.id).startsWith("builtin.layout.application."),
  );
  const navigation = bySuffix.get("navigation");
  const page = bySuffix.get("page");
  if (shell && navigation) {
    const navigationSlot = navigationSlotFor(shell);
    if (navigationSlot) {
      addPlacement(
        placements,
        input.systemId,
        shell,
        navigationSlot,
        navigation,
      );
    }
  }
  if (pageLayout && page) {
    addPlacement(placements, input.systemId, pageLayout, "content", page);
  }

  if (kind === "secured-data-entry") {
    addSyntheticVisuals(instances, bySuffix, input, foundationVersion, [
      visual("entry-stack", "Request workspace", "builtin.ui.stack", {}),
      visual("form-card", "New request", "builtin.ui.card", {
        title: "New request",
        description: "Create a secured service request.",
      }),
      visual("records-grid", "Request records", "builtin.ui.grid", {}),
      visual("list-card", "Recent requests", "builtin.ui.card", {
        title: "Recent requests",
        description: "Review the latest authorized requests.",
      }),
      visual("detail-card", "Selected request", "builtin.ui.card", {
        title: "Selected request",
        description: "Inspect the currently selected request.",
      }),
    ]);
    const action = addVisualAction(
      instances,
      input,
      foundationVersion,
      "visual-submit",
      "Save request",
      "Save request",
    );
    bySuffix.set("visual-submit", action);
  } else if (kind === "controlled-chatbot") {
    const action = addVisualAction(
      instances,
      input,
      foundationVersion,
      "visual-send",
      "Send message",
      "Send",
    );
    bySuffix.set("visual-send", action);
  } else if (kind === "secured-data-review") {
    addSyntheticVisuals(instances, bySuffix, input, foundationVersion, [
      visual("review-grid", "Artifact review workspace", "builtin.ui.grid", {}),
    ]);
  }

  for (const spec of profilePlacements[kind]) {
    const parent = bySuffix.get(spec.parentSuffix);
    if (!parent) continue;
    for (const childSuffix of spec.childSuffixes) {
      const child = bySuffix.get(childSuffix);
      if (child) {
        addPlacement(placements, input.systemId, parent, spec.slotId, child);
      }
    }
  }
  return {
    instances,
    placements: normalizeAssetPlacements(placements),
  };
}

interface SyntheticVisualSpec {
  readonly suffix: string;
  readonly displayName: string;
  readonly definitionId: string;
  readonly configuration: AssetConfigurationValues;
}

function visual(
  suffix: string,
  displayName: string,
  definitionId: string,
  configuration: AssetConfigurationValues,
): SyntheticVisualSpec {
  return { suffix, displayName, definitionId, configuration };
}

function addSyntheticVisuals(
  instances: AssetInstance[],
  bySuffix: Map<string, AssetInstance>,
  input: MaterializeReferenceSystemVisualHierarchyInput,
  foundationVersion: string,
  specs: readonly SyntheticVisualSpec[],
): void {
  for (const spec of specs) {
    const existing = bySuffix.get(spec.suffix);
    if (existing) continue;
    const definitionRef = exactSystemFoundationDefinitionReference(
      spec.definitionId,
      foundationVersion,
    );
    const definition = readSystemFoundationManifest(
      foundationVersion,
    )?.assets.find(
      (entry) =>
        String(entry.definition.definitionId) === String(definitionRef.id),
    )?.definition;
    if (!definition) continue;
    const instance: AssetInstance = {
      instanceId: normalizeAssetId(`${input.systemId}.${spec.suffix}`),
      definitionRef,
      displayName: spec.displayName,
      lifecycleStatus: "draft",
      selectedConfiguration: {
        ...(definition.defaultConfiguration ?? {}),
        ...spec.configuration,
      },
      parentCompositionRef: {
        kind: "asset-composition",
        id: normalizeAssetId(input.compositionId),
      },
      provenance: {
        sourceKind: "system-generated",
        createdAt: input.timestamp,
        createdBy: input.actorId,
      },
      metadata: { referencePreviewStructure: true },
    };
    instances.push(instance);
    bySuffix.set(spec.suffix, instance);
  }
}

function referenceSystemKind(
  instances: readonly AssetInstance[],
): ReferenceSystemKind | undefined {
  for (const instance of instances) {
    const value = instance.metadata?.referenceSystemKind;
    if (
      value === "secured-data-entry" ||
      value === "controlled-chatbot" ||
      value === "secured-data-review"
    ) {
      return value;
    }
  }
  return undefined;
}

function navigationSlotFor(shell: AssetInstance): string | undefined {
  const definition = readSystemFoundationManifest(
    shell.definitionRef.version ?? "",
  )?.assets.find(
    (entry) =>
      String(entry.definition.definitionId) === String(shell.definitionRef.id),
  )?.definition;
  const ids = definition?.slots?.map((slot) => String(slot.slotId)) ?? [];
  return ["start-sidebar", "top-bar", "footer"].find((id) => ids.includes(id));
}

function addVisualAction(
  instances: AssetInstance[],
  input: MaterializeReferenceSystemVisualHierarchyInput,
  foundationVersion: string,
  suffix: string,
  displayName: string,
  label: string,
): AssetInstance {
  const existing = instances.find(
    (instance) => instanceSuffix(input.systemId, instance) === suffix,
  );
  if (existing) return existing;
  const definitionRef = exactSystemFoundationDefinitionReference(
    "builtin.form.submit-action",
    foundationVersion,
  );
  const definition = readSystemFoundationManifest(
    foundationVersion,
  )?.assets.find(
    (entry) =>
      String(entry.definition.definitionId) === String(definitionRef.id),
  )?.definition;
  const selectedConfiguration: AssetConfigurationValues = {
    ...(definition?.defaultConfiguration ?? {}),
    label,
  };
  const instance: AssetInstance = {
    instanceId: normalizeAssetId(`${input.systemId}.${suffix}`),
    definitionRef,
    displayName,
    lifecycleStatus: "draft",
    selectedConfiguration,
    parentCompositionRef: {
      kind: "asset-composition",
      id: normalizeAssetId(input.compositionId),
    },
    provenance: {
      sourceKind: "system-generated",
      createdAt: input.timestamp,
      createdBy: input.actorId,
    },
    metadata: { referencePreviewControl: true },
  };
  instances.push(instance);
  return instance;
}

function referenceFoundationVersion(
  instances: readonly AssetInstance[],
): string {
  const version = instances.find(
    (instance) => String(instance.definitionRef.id) === "builtin.system.system",
  )?.definitionRef.version;
  if (!version || !readSystemFoundationManifest(version)) {
    throw new Error("The reference system Foundation release is unavailable.");
  }
  return version;
}

function addPlacement(
  placements: AssetPlacement[],
  systemId: string,
  parent: AssetInstance,
  slotId: string,
  child: AssetInstance,
): void {
  if (
    placements.some(
      (item) => String(item.childInstanceRef.id) === String(child.instanceId),
    )
  ) {
    return;
  }
  const order = placements.filter(
    (item) =>
      String(item.parentInstanceRef.id) === String(parent.instanceId) &&
      String(item.slotId) === slotId,
  ).length;
  placements.push({
    schemaVersion: ASSET_PLACEMENT_SCHEMA_VERSION,
    placementId: normalizeAssetId(
      `${systemId}.placement-${placements.length + 1}`,
    ),
    parentInstanceRef: instanceReference(parent),
    slotId: slotId as AssetPlacement["slotId"],
    childInstanceRef: instanceReference(child),
    order,
  });
}

function placement(
  parentSuffix: string,
  slotId: string,
  childSuffixes: readonly string[],
): VisualPlacementSpec {
  return { parentSuffix, slotId, childSuffixes };
}

function instanceSuffix(
  systemId: string,
  instance: AssetInstance,
): string | undefined {
  const value = String(instance.instanceId);
  const prefix = `${systemId}.`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : undefined;
}

function instanceReference(instance: AssetInstance): AssetReference {
  return {
    kind: "asset-instance",
    id: normalizeAssetId(String(instance.instanceId)),
  };
}
