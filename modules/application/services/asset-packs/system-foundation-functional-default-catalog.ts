import type {
  AssetDefinition,
  AssetMetadata,
  AssetPackVersion,
  AssetType,
} from "../../../contracts/asset";
import type {
  AssetImplementationFacetKind,
  SystemFoundationFunctionalDefault,
  SystemFoundationPreviewKind,
} from "../../../contracts/asset-implementation";

import {
  SYSTEM_FOUNDATION_PACK_MANIFEST,
  SYSTEM_FOUNDATION_PACK_V2_MANIFEST,
} from "./system-packs";

const ALL_PROFILES = [
  "local-desktop",
  "campus-server",
  "cloud-server",
  "thin-client",
] as const;

/** Immutable functional descriptors for the original 1.0.0 release. */
export const SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS: readonly SystemFoundationFunctionalDefault[] =
  SYSTEM_FOUNDATION_PACK_MANIFEST.assets.map((entry) =>
    createFunctionalDefault(entry.definition),
  );

/** Functional descriptors for the complete 2.0.0 release, including layouts. */
export const SYSTEM_FOUNDATION_V2_FUNCTIONAL_DEFAULTS: readonly SystemFoundationFunctionalDefault[] =
  SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.map((entry) =>
    createFunctionalDefault(entry.definition),
  );

export const SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS_BY_VERSION: ReadonlyMap<
  AssetPackVersion,
  readonly SystemFoundationFunctionalDefault[]
> = new Map([
  [
    SYSTEM_FOUNDATION_PACK_MANIFEST.version,
    SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS,
  ],
  [
    SYSTEM_FOUNDATION_PACK_V2_MANIFEST.version,
    SYSTEM_FOUNDATION_V2_FUNCTIONAL_DEFAULTS,
  ],
]);

const functionalDefaultByExactReference = new Map(
  [...SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS_BY_VERSION.values()]
    .flat()
    .map((item) => [exactKey(item.definitionId, item.definitionVersion), item]),
);

const legacyFunctionalDefaultByDefinitionId = new Map(
  SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS.map((item) => [
    item.definitionId,
    item,
  ]),
);

const currentFunctionalDefaultByDefinitionId = new Map(
  SYSTEM_FOUNDATION_V2_FUNCTIONAL_DEFAULTS.map((item) => [
    item.definitionId,
    item,
  ]),
);

export function readSystemFoundationFunctionalDefault(
  definitionId: string,
  version?: AssetPackVersion,
): SystemFoundationFunctionalDefault | undefined {
  if (version) {
    return functionalDefaultByExactReference.get(
      exactKey(definitionId, version),
    );
  }
  return (
    legacyFunctionalDefaultByDefinitionId.get(definitionId) ??
    currentFunctionalDefaultByDefinitionId.get(definitionId)
  );
}

function exactKey(definitionId: string, version: string): string {
  return `${definitionId}@${version}`;
}

function createFunctionalDefault(
  definition: AssetDefinition,
): SystemFoundationFunctionalDefault {
  const previewKind = previewKindFor(definition);
  const failClosed =
    definition.assetType === "policy" ||
    definition.metadata?.failClosed === true;
  return {
    definitionId: String(definition.definitionId),
    definitionVersion: definition.version,
    displayName: definition.displayName,
    entryKey: `foundation.${String(definition.definitionId)}`,
    facetKind: facetKindFor(definition.assetType),
    runtimeKind:
      previewKind === "layout" ||
      previewKind === "form" ||
      previewKind === "data" ||
      previewKind === "state" ||
      previewKind === "conversation"
        ? "trusted-built-in"
        : "declarative-engine",
    deploymentProfiles: ALL_PROFILES,
    previewKind,
    previewConfiguration: definition.defaultConfiguration ?? {},
    previewFixture: fixtureFor(
      previewKind,
      definition.displayName,
      failClosed,
      definition,
    ),
    failClosed,
    requiredCapabilities: [],
  };
}

function facetKindFor(assetType: AssetType): AssetImplementationFacetKind {
  switch (assetType) {
    case "ui-component":
    case "page":
    case "feature":
      return "ui";
    case "workflow":
    case "workflow-step":
      return "workflow";
    case "data-source":
    case "dataset":
    case "model":
    case "document":
    case "schema":
    case "adapter-binding":
      return "data";
    case "policy":
      return "policy";
    case "test":
      return "test";
    case "tool":
      return "logic";
    default:
      return "declarative";
  }
}

function previewKindFor(
  definition: AssetDefinition,
): SystemFoundationPreviewKind {
  const id = String(definition.definitionId);
  if (id.startsWith("builtin.form.") || id === "builtin.feature.record-form")
    return "form";
  if (
    id.startsWith("builtin.display.") ||
    id.startsWith("builtin.preview.") ||
    id === "builtin.feature.data-preview"
  )
    return "data";
  if (id.startsWith("builtin.state.")) return "state";
  if (id.startsWith("conversation.")) return "conversation";
  if (definition.assetType === "policy" || id.startsWith("builtin.security."))
    return "policy";
  if (
    definition.assetType === "workflow" ||
    definition.assetType === "workflow-step" ||
    id.startsWith("builtin.logic.")
  )
    return "workflow";
  if (
    id.startsWith("builtin.ui.") ||
    id.startsWith("builtin.shell.") ||
    id.startsWith("builtin.layout.")
  )
    return "layout";
  return "semantic";
}

function fixtureFor(
  kind: SystemFoundationPreviewKind,
  displayName: string,
  failClosed: boolean,
  definition: AssetDefinition,
): AssetMetadata {
  switch (kind) {
    case "form":
      return {
        title: displayName,
        fields: [
          {
            id: "name",
            label: "Name",
            value: "Example record",
            required: true,
          },
          {
            id: "summary",
            label: "Summary",
            value: "Safe preview data",
            required: false,
          },
        ],
        submitLabel: "Save",
      };
    case "data":
      return {
        title: displayName,
        columns: ["Name", "Status"],
        rows: [
          ["Example record", "Ready"],
          ["Second record", "Draft"],
        ],
      };
    case "conversation":
      return {
        title: displayName,
        messages: [
          { role: "user", text: "Show a safe preview." },
          {
            role: "assistant",
            text: "This is a bounded system-default preview.",
          },
        ],
      };
    case "workflow":
      return {
        title: displayName,
        steps: ["Validate input", "Apply finite rule", "Produce typed output"],
      };
    case "policy":
      return {
        title: displayName,
        decision: "deny",
        reason: failClosed
          ? "Required evidence has not been provided."
          : "Policy review is required.",
      };
    case "state":
      return {
        title: displayName,
        message: "This preview demonstrates the declared application state.",
      };
    case "layout":
      return {
        title: displayName,
        regions: definition.slots?.map((slot) => slot.displayName) ?? [
          "Header",
          "Content",
          "Actions",
        ],
      };
    default:
      return {
        title: displayName,
        summary:
          "Portable semantic asset interpreted by the system foundation engine.",
      };
  }
}
