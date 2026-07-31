import type {
  AssetDefinition,
  AssetJsonValue,
  AssetPackManifest,
  AssetPackVersion,
} from "../../../contracts/asset";
import type {
  AssetImplementationBackingResourceBundleV1,
  AssetImplementationBackingResourceFile,
  SystemFoundationFunctionalDefault,
} from "../../../contracts/asset-implementation";
import {
  readSystemFoundationLayoutPreset,
  SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
  SYSTEM_FOUNDATION_PACK_MANIFEST,
  SYSTEM_FOUNDATION_PACK_V2_MANIFEST,
  SYSTEM_FOUNDATION_PACK_V3_MANIFEST,
  type SystemFoundationLayoutPreset,
  type SystemFoundationLayoutToken,
} from "./system-packs";
import {
  readSystemFoundationFunctionalDefault,
  SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS,
  SYSTEM_FOUNDATION_V2_FUNCTIONAL_DEFAULTS,
  SYSTEM_FOUNDATION_V3_FUNCTIONAL_DEFAULTS,
} from "./system-foundation-functional-default-catalog";

export interface SystemFoundationBackingResourceProgram {
  readonly definitionId: string;
  readonly displayName: string;
  readonly previewKind: SystemFoundationFunctionalDefault["previewKind"];
  readonly previewConfiguration: Readonly<Record<string, AssetJsonValue>>;
  readonly previewFixture: Readonly<Record<string, AssetJsonValue>>;
  readonly failClosed: boolean;
  readonly backendSteps: readonly string[];
  readonly styleClassName?: string;
  readonly semanticElement?: string;
  readonly regions: readonly SystemFoundationBackingResourceRegion[];
}

export interface SystemFoundationBackingResourceRegion {
  readonly slotId: string;
  readonly displayName: string;
  readonly maximumItems: number;
}

/** Immutable implementation resources for the original 1.0.0 release. */
export const SYSTEM_FOUNDATION_BACKING_RESOURCE_BUNDLES: ReadonlyMap<
  string,
  AssetImplementationBackingResourceBundleV1
> = createBackingResourceCatalog(
  SYSTEM_FOUNDATION_PACK_MANIFEST,
  SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS,
);

/** Implementation resources for the complete 2.0.0 release. */
export const SYSTEM_FOUNDATION_V2_BACKING_RESOURCE_BUNDLES: ReadonlyMap<
  string,
  AssetImplementationBackingResourceBundleV1
> = createBackingResourceCatalog(
  SYSTEM_FOUNDATION_PACK_V2_MANIFEST,
  SYSTEM_FOUNDATION_V2_FUNCTIONAL_DEFAULTS,
);

/** Implementation resources for the property-complete current 3.0.0 release. */
export const SYSTEM_FOUNDATION_V3_BACKING_RESOURCE_BUNDLES: ReadonlyMap<
  string,
  AssetImplementationBackingResourceBundleV1
> = createBackingResourceCatalog(
  SYSTEM_FOUNDATION_PACK_V3_MANIFEST,
  SYSTEM_FOUNDATION_V3_FUNCTIONAL_DEFAULTS,
);

export const SYSTEM_FOUNDATION_BACKING_RESOURCE_BUNDLES_BY_VERSION: ReadonlyMap<
  AssetPackVersion,
  ReadonlyMap<string, AssetImplementationBackingResourceBundleV1>
> = new Map([
  [
    SYSTEM_FOUNDATION_PACK_MANIFEST.version,
    SYSTEM_FOUNDATION_BACKING_RESOURCE_BUNDLES,
  ],
  [
    SYSTEM_FOUNDATION_PACK_V2_MANIFEST.version,
    SYSTEM_FOUNDATION_V2_BACKING_RESOURCE_BUNDLES,
  ],
  [
    SYSTEM_FOUNDATION_PACK_V3_MANIFEST.version,
    SYSTEM_FOUNDATION_V3_BACKING_RESOURCE_BUNDLES,
  ],
]);

export function createSystemFoundationBackingResourceBundle(
  definition: AssetDefinition,
  descriptor: SystemFoundationFunctionalDefault,
): AssetImplementationBackingResourceBundleV1 {
  const layoutPreset = readSystemFoundationLayoutPreset(
    descriptor.definitionId,
    descriptor.definitionVersion,
  );
  const files: AssetImplementationBackingResourceFile[] = [
    {
      path: "other/definition.json",
      role: "other",
      mediaType: "application/json",
      content: pretty({
        formatVersion: "1.0",
        kind: "system-foundation-definition",
        definition,
      }),
    },
  ];

  if (hasFrontend(descriptor.previewKind)) {
    files.push({
      path: "frontend/structure.json",
      role: "frontend-structure",
      mediaType: "application/json",
      content: pretty({
        formatVersion: "1.0",
        kind: "system-foundation-frontend",
        definitionId: descriptor.definitionId,
        definitionVersion: descriptor.definitionVersion,
        entryKey: descriptor.entryKey,
        previewKind: descriptor.previewKind,
        displayName: descriptor.displayName,
        configuration: descriptor.previewConfiguration,
        fixture: descriptor.previewFixture,
        semanticElement: semanticElementFor(definition),
        regions:
          definition.slots?.map((slot) => ({
            slotId: String(slot.slotId),
            displayName: slot.displayName,
            maximumItems: slot.cardinality.maxItems,
          })) ?? [],
        ...(layoutPreset ? { layoutPreset } : {}),
      }),
    });
    files.push({
      path: "frontend/styles.css",
      role: "frontend-style",
      mediaType: "text/css",
      content: foundationStyles(
        descriptor.definitionId,
        descriptor.definitionVersion,
        layoutPreset,
      ),
    });
  }

  if (hasBackend(descriptor.facetKind, descriptor.previewKind)) {
    files.push({
      path: "backend/logic.json",
      role: "backend-logic",
      mediaType: "application/json",
      content: pretty({
        formatVersion: "1.0",
        kind: "system-foundation-backend",
        definitionId: descriptor.definitionId,
        definitionVersion: descriptor.definitionVersion,
        entryKey: descriptor.entryKey,
        facetKind: descriptor.facetKind,
        previewKind: descriptor.previewKind,
        failClosed: descriptor.failClosed,
        requiredCapabilities: descriptor.requiredCapabilities,
        configuration: descriptor.previewConfiguration,
        fixture: descriptor.previewFixture,
        steps: backendSteps(descriptor),
      }),
    });
  }

  return { formatVersion: "1.0", files };
}

export function readSystemFoundationBackingResourceBundle(
  definitionId: string,
  version?: AssetPackVersion,
): AssetImplementationBackingResourceBundleV1 | undefined {
  if (version) {
    return SYSTEM_FOUNDATION_BACKING_RESOURCE_BUNDLES_BY_VERSION.get(
      version,
    )?.get(definitionId);
  }
  return (
    SYSTEM_FOUNDATION_V3_BACKING_RESOURCE_BUNDLES.get(definitionId) ??
    SYSTEM_FOUNDATION_V2_BACKING_RESOURCE_BUNDLES.get(definitionId) ??
    SYSTEM_FOUNDATION_BACKING_RESOURCE_BUNDLES.get(definitionId)
  );
}

export function readSystemFoundationBackingResourceProgram(
  definitionId: string,
  version?: AssetPackVersion,
): SystemFoundationBackingResourceProgram | undefined {
  const descriptor = readSystemFoundationFunctionalDefault(
    definitionId,
    version,
  );
  const bundle = readSystemFoundationBackingResourceBundle(
    definitionId,
    version,
  );
  if (!descriptor || !bundle) return undefined;
  const frontend = parseFile(bundle, "frontend/structure.json");
  const backend = parseFile(bundle, "backend/logic.json");
  const program = frontend ?? backend;
  if (!program) {
    return {
      definitionId,
      displayName: descriptor.displayName,
      previewKind: descriptor.previewKind,
      previewConfiguration: descriptor.previewConfiguration,
      previewFixture: descriptor.previewFixture,
      failClosed: descriptor.failClosed,
      backendSteps: [],
      regions: [],
    };
  }
  return {
    definitionId,
    displayName: stringValue(program.displayName) ?? descriptor.displayName,
    previewKind: descriptor.previewKind,
    previewConfiguration:
      objectValue(program.configuration) ?? descriptor.previewConfiguration,
    previewFixture: objectValue(program.fixture) ?? descriptor.previewFixture,
    failClosed:
      typeof program.failClosed === "boolean"
        ? program.failClosed
        : descriptor.failClosed,
    backendSteps: stringArray(program.steps),
    semanticElement: stringValue(program.semanticElement),
    regions: objectArray(program.regions).flatMap((region) => {
      const slotId = stringValue(region.slotId);
      const displayName = stringValue(region.displayName);
      const maximumItems = numberValue(region.maximumItems);
      return slotId && displayName && maximumItems !== undefined
        ? [{ slotId, displayName, maximumItems }]
        : [];
    }),
    ...(frontend ? { styleClassName: foundationClassName(definitionId) } : {}),
  };
}

function createBackingResourceCatalog(
  manifest: AssetPackManifest,
  descriptors: readonly SystemFoundationFunctionalDefault[],
): ReadonlyMap<string, AssetImplementationBackingResourceBundleV1> {
  const definitionsById = new Map(
    manifest.assets.map((entry) => [
      String(entry.definition.definitionId),
      entry.definition,
    ]),
  );
  return new Map(
    descriptors.map((descriptor) => {
      const definition = definitionsById.get(descriptor.definitionId);
      if (!definition) {
        throw new Error(
          `System foundation backing definition is missing: ${descriptor.definitionId}@${descriptor.definitionVersion}.`,
        );
      }
      return [
        descriptor.definitionId,
        createSystemFoundationBackingResourceBundle(definition, descriptor),
      ];
    }),
  );
}

function parseFile(
  bundle: AssetImplementationBackingResourceBundleV1,
  path: string,
): Record<string, AssetJsonValue> | undefined {
  const file = bundle.files.find((candidate) => candidate.path === path);
  if (!file) return undefined;
  const parsed = JSON.parse(file.content) as unknown;
  return objectValue(parsed);
}

function hasFrontend(
  kind: SystemFoundationFunctionalDefault["previewKind"],
): boolean {
  return ["layout", "form", "data", "state", "conversation"].includes(kind);
}

function hasBackend(
  facetKind: SystemFoundationFunctionalDefault["facetKind"],
  previewKind: SystemFoundationFunctionalDefault["previewKind"],
): boolean {
  return (
    ["logic", "workflow", "data", "policy"].includes(facetKind) ||
    ["workflow", "policy"].includes(previewKind)
  );
}

function backendSteps(
  descriptor: SystemFoundationFunctionalDefault,
): readonly string[] {
  const fixtureSteps = stringArray(descriptor.previewFixture.steps);
  if (fixtureSteps.length) return fixtureSteps;
  if (descriptor.previewKind === "policy") {
    return ["Validate required evidence", "Deny when evidence is absent"];
  }
  if (descriptor.facetKind === "data") {
    return [
      "Validate typed input",
      "Invoke authorized data capability",
      "Return typed output",
    ];
  }
  return [
    "Validate typed input",
    "Apply bounded implementation",
    "Return typed output",
  ];
}

function foundationStyles(
  definitionId: string,
  version: AssetPackVersion,
  layoutPreset?: SystemFoundationLayoutPreset,
): string {
  const className = foundationClassName(definitionId);
  const semanticTheme =
    version === SYSTEM_FOUNDATION_CURRENT_PACK_VERSION
      ? semanticThemeStyles(className, definitionId)
      : [];
  if (!layoutPreset) {
    return [
      ...semanticTheme,
      `.${className} { display: grid; gap: 0.75rem; min-inline-size: 0; }`,
      `.${className} :where(input, textarea, select, button) { max-inline-size: 100%; }`,
      `.${className} [role="status"] { overflow-wrap: anywhere; }`,
      "",
    ].join("\n");
  }

  const compact = layoutRules(className, layoutPreset.responsive.compact);
  const regular = indent(
    layoutRules(className, layoutPreset.responsive.regular),
  );
  const wide = indent(layoutRules(className, layoutPreset.responsive.wide));
  const slotRules = layoutPreset.slots.map(
    (slot) =>
      `.${className} > [data-slot="${slot.slotId}"] { grid-area: ${slot.slotId}; min-inline-size: 0; }`,
  );
  return [
    ...semanticTheme,
    compact,
    ...slotRules,
    `@media (min-width: 48rem) {\n${regular}\n}`,
    `@media (min-width: 80rem) {\n${wide}\n}`,
    "",
  ].join("\n");
}

function semanticThemeStyles(
  className: string,
  definitionId: string,
): readonly string[] {
  const shared = [
    `.${className}[data-style-surface-role="primary"] { background: var(--aisb-theme-color-primary); color: var(--aisb-theme-color-on-primary, #ffffff); }`,
    `.${className}[data-style-surface-role="secondary"] { background: var(--aisb-theme-color-secondary); color: var(--aisb-theme-color-on-primary, #ffffff); }`,
    `.${className}[data-style-surface-role="tertiary"] { background: var(--aisb-theme-color-tertiary); color: var(--aisb-theme-color-on-primary, #ffffff); }`,
    `.${className}[data-style-surface-role="surface"] { background: var(--aisb-theme-color-surface); color: var(--aisb-theme-color-text); }`,
    `.${className}[data-style-text-role="muted"] { color: var(--aisb-theme-color-muted-text); }`,
    `.${className}[data-style-text-role="accent"] { color: var(--aisb-theme-color-primary); }`,
    `.${className}[data-style-spacing="compact"] { gap: var(--aisb-theme-space-compact); padding: var(--aisb-theme-space-compact); }`,
    `.${className}[data-style-spacing="comfortable"] { gap: var(--aisb-theme-space-comfortable); padding: var(--aisb-theme-space-comfortable); }`,
    `.${className}[data-style-border="subtle"] { border: 1px solid var(--aisb-theme-color-border); }`,
    `.${className}[data-style-border="strong"] { border: 2px solid var(--aisb-theme-color-border); }`,
    `.${className}[data-style-button-treatment="outline"] { background: transparent; border: 1px solid currentColor; }`,
    `.${className}[data-style-button-treatment="soft"] { background: color-mix(in srgb, var(--aisb-theme-color-primary) 14%, transparent); color: var(--aisb-theme-color-primary); }`,
    `.${className}[data-style-form-treatment="filled"] :where(input, textarea, select) { background: color-mix(in srgb, var(--aisb-theme-color-secondary) 10%, var(--aisb-theme-color-surface)); }`,
    `.${className}[data-style-form-treatment="underlined"] :where(input, textarea, select) { border-width: 0 0 1px; border-radius: 0; }`,
  ];
  if (definitionId !== "builtin.system.system") return shared;
  return [
    `.${className} { --aisb-theme-color-primary: #2563eb; --aisb-theme-color-secondary: #475569; --aisb-theme-color-tertiary: #7c3aed; --aisb-theme-color-surface: #ffffff; --aisb-theme-color-canvas: #f8fafc; --aisb-theme-color-text: #0f172a; --aisb-theme-color-muted-text: #64748b; --aisb-theme-color-border: #cbd5e1; --aisb-theme-color-success: #15803d; --aisb-theme-color-danger: #b91c1c; --aisb-theme-space-compact: 0.5rem; --aisb-theme-space-standard: 0.75rem; --aisb-theme-space-comfortable: 1rem; color: var(--aisb-theme-color-text); background: var(--aisb-theme-color-canvas); font-family: var(--aisb-theme-font-family, system-ui, sans-serif); }`,
    ...shared,
  ];
}

function layoutRules(
  className: string,
  variant: SystemFoundationLayoutPreset["responsive"]["compact"],
): string {
  return [
    `.${className} {`,
    "  display: grid;",
    "  gap: 0.75rem;",
    "  min-inline-size: 0;",
    `  grid-template-columns: ${columnsFor(variant.columnPattern)};`,
    `  grid-template-areas: ${areasFor(variant.areas)};`,
    "}",
  ].join("\n");
}

function columnsFor(token: SystemFoundationLayoutToken): string {
  switch (token) {
    case "start-content":
      return "minmax(12rem, 18rem) minmax(0, 1fr)";
    case "content-end":
      return "minmax(0, 1fr) minmax(14rem, 20rem)";
    case "equal-split":
      return "repeat(2, minmax(0, 1fr))";
    case "three-panel":
      return "minmax(12rem, 18rem) minmax(0, 1fr) minmax(14rem, 20rem)";
    default:
      return "minmax(0, 1fr)";
  }
}

function areasFor(areas: readonly (readonly string[])[]): string {
  return areas.map((row) => `"${row.join(" ")}"`).join(" ");
}

function indent(value: string): string {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function foundationClassName(definitionId: string): string {
  return `foundation-${definitionId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

function semanticElementFor(definition: AssetDefinition): string {
  const id = String(definition.definitionId);
  if (id === "builtin.system.system") return "application";
  if (id.startsWith("builtin.layout.application.")) return "application-layout";
  if (id === "builtin.shell.navigation-group") return "navigation";
  if (id === "builtin.shell.page") return "main";
  if (id === "builtin.ui.card") return "article";
  if (id === "builtin.ui.section") return "section";
  if (id === "builtin.ui.collapsible-section") return "details";
  if (id === "builtin.form.form") return "form";
  if (id.startsWith("builtin.form.")) return "form-control";
  if (id.startsWith("builtin.display.")) return "data-display";
  if (id.startsWith("builtin.state.")) return "status";
  if (id.startsWith("conversation.")) return "conversation";
  if (definition.assetType === "page") return "section";
  if (definition.assetType === "feature") return "feature";
  return "group";
}

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function objectValue(
  value: unknown,
): Readonly<Record<string, AssetJsonValue>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, AssetJsonValue>>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function objectArray(
  value: unknown,
): readonly Readonly<Record<string, AssetJsonValue>>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const object = objectValue(item);
        return object ? [object] : [];
      })
    : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
