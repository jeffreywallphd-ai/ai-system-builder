import type {
  AssetDefinition,
  AssetJsonValue,
  AssetPackAssetEntry,
  AssetPackManifest,
  AssetReference,
} from "../../../../contracts/asset";

import {
  SYSTEM_FOUNDATION_LAYOUT_ENTRIES,
  createSystemRootSlotDefinition,
} from "./system-foundation-layout-presets";
import {
  SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
  SYSTEM_FOUNDATION_PACK_VERSION,
} from "./system-foundation-pack.constants";
import { SYSTEM_FOUNDATION_PACK_MANIFEST } from "./system-foundation-pack.manifest";

export const SYSTEM_FOUNDATION_PACK_V2_MANIFEST: AssetPackManifest = {
  ...SYSTEM_FOUNDATION_PACK_MANIFEST,
  version: SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
  description:
    "System-owned functional foundation with canonical named-slot layout presets.",
  assets: [
    ...SYSTEM_FOUNDATION_PACK_MANIFEST.assets.map(versionEntry),
    ...SYSTEM_FOUNDATION_LAYOUT_ENTRIES,
  ],
  metadata: {
    ...(SYSTEM_FOUNDATION_PACK_MANIFEST.metadata ?? {}),
    catalogVersion: SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
    previousVersion: SYSTEM_FOUNDATION_PACK_VERSION,
    containsSlotLayouts: true,
    applicationLayoutCount: 8,
    pageLayoutCount: 6,
  },
};

function versionEntry(entry: AssetPackAssetEntry): AssetPackAssetEntry {
  const versioned = replaceFoundationVersion(entry);
  const definition = withRootSlot(versioned.definition);
  const fingerprint = `fnv1a:${fnv1a(stableStringify(definition))}`;
  return {
    ...versioned,
    definition,
    definitionRef: {
      ...versioned.definitionRef,
      version: SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
    },
    fingerprint,
    metadata: {
      ...(versioned.metadata ?? {}),
      fingerprint,
      previousDefinitionRef: {
        kind: "asset-definition-version",
        id: String(entry.definition.definitionId),
        version: SYSTEM_FOUNDATION_PACK_VERSION,
      } as unknown as AssetJsonValue,
    },
  };
}

function withRootSlot(definition: AssetDefinition): AssetDefinition {
  return String(definition.definitionId) === "builtin.system.system"
    ? { ...definition, slots: [createSystemRootSlotDefinition()] }
    : definition;
}

function replaceFoundationVersion<T>(value: T): T {
  if (value === SYSTEM_FOUNDATION_PACK_VERSION) {
    return SYSTEM_FOUNDATION_CURRENT_PACK_VERSION as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceFoundationVersion(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        replaceFoundationVersion(item),
      ]),
    ) as T;
  }
  return value;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${stableStringify(entryValue)}`,
    )
    .join(",")}}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function readSystemFoundationManifest(
  version: string,
): AssetPackManifest | undefined {
  if (version === SYSTEM_FOUNDATION_PACK_VERSION) {
    return SYSTEM_FOUNDATION_PACK_MANIFEST;
  }
  if (version === SYSTEM_FOUNDATION_CURRENT_PACK_VERSION) {
    return SYSTEM_FOUNDATION_PACK_V2_MANIFEST;
  }
  return undefined;
}

export function exactSystemFoundationDefinitionReference(
  definitionId: string,
  version = SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
): AssetReference {
  const manifest = readSystemFoundationManifest(version);
  const entry = manifest?.assets.find(
    (candidate) => String(candidate.definition.definitionId) === definitionId,
  );
  if (!entry) {
    throw new Error(
      "The requested System Foundation definition is unavailable.",
    );
  }
  return entry.definitionRef;
}
