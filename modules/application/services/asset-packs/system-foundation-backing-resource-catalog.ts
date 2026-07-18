import type { AssetDefinition, AssetJsonValue } from "../../../contracts/asset";
import type {
  AssetImplementationBackingResourceBundleV1,
  AssetImplementationBackingResourceFile,
  SystemFoundationFunctionalDefault,
} from "../../../contracts/asset-implementation";
import { SYSTEM_FOUNDATION_PACK_MANIFEST } from "./system-packs";
import {
  readSystemFoundationFunctionalDefault,
  SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS,
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
}

const definitionsById = new Map(
  SYSTEM_FOUNDATION_PACK_MANIFEST.assets.map((entry) => [
    String(entry.definition.definitionId),
    entry.definition,
  ]),
);

export const SYSTEM_FOUNDATION_BACKING_RESOURCE_BUNDLES: ReadonlyMap<
  string,
  AssetImplementationBackingResourceBundleV1
> = new Map(
  SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS.map((descriptor) => {
    const definition = definitionsById.get(descriptor.definitionId);
    if (!definition) {
      throw new Error(
        `System foundation backing definition is missing: ${descriptor.definitionId}.`,
      );
    }
    return [
      descriptor.definitionId,
      createSystemFoundationBackingResourceBundle(definition, descriptor),
    ];
  }),
);

export function createSystemFoundationBackingResourceBundle(
  definition: AssetDefinition,
  descriptor: SystemFoundationFunctionalDefault,
): AssetImplementationBackingResourceBundleV1 {
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
        entryKey: descriptor.entryKey,
        previewKind: descriptor.previewKind,
        displayName: descriptor.displayName,
        configuration: descriptor.previewConfiguration,
        fixture: descriptor.previewFixture,
      }),
    });
    files.push({
      path: "frontend/styles.css",
      role: "frontend-style",
      mediaType: "text/css",
      content: foundationStyles(descriptor.definitionId),
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
): AssetImplementationBackingResourceBundleV1 | undefined {
  return SYSTEM_FOUNDATION_BACKING_RESOURCE_BUNDLES.get(definitionId);
}

export function readSystemFoundationBackingResourceProgram(
  definitionId: string,
): SystemFoundationBackingResourceProgram | undefined {
  const descriptor = readSystemFoundationFunctionalDefault(definitionId);
  const bundle = readSystemFoundationBackingResourceBundle(definitionId);
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
    ...(frontend ? { styleClassName: foundationClassName(definitionId) } : {}),
  };
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

function hasFrontend(kind: SystemFoundationFunctionalDefault["previewKind"]): boolean {
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
    return ["Validate typed input", "Invoke authorized data capability", "Return typed output"];
  }
  return ["Validate typed input", "Apply bounded implementation", "Return typed output"];
}

function foundationStyles(definitionId: string): string {
  const className = foundationClassName(definitionId);
  return [
    `.${className} { display: grid; gap: 0.75rem; min-inline-size: 0; }`,
    `.${className} :where(input, textarea, select, button) { max-inline-size: 100%; }`,
    `.${className} [role="status"] { overflow-wrap: anywhere; }`,
    "",
  ].join("\n");
}

function foundationClassName(definitionId: string): string {
  return `foundation-${definitionId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
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
