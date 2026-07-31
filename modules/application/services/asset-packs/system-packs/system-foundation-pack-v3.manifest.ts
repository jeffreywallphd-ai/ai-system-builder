import type {
  AssetJsonValue,
  AssetPackAssetEntry,
  AssetPackManifest,
  AssetReference,
} from "../../../../contracts/asset";

import {
  SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
  SYSTEM_FOUNDATION_PACK_VERSION,
  SYSTEM_FOUNDATION_V2_PACK_VERSION,
} from "./system-foundation-pack.constants";
import { SYSTEM_FOUNDATION_PACK_MANIFEST } from "./system-foundation-pack.manifest";
import { SYSTEM_FOUNDATION_PACK_V2_MANIFEST } from "./system-foundation-pack-v2.manifest";
import { withSystemFoundationV3PresentationProperties } from "./system-foundation-v3-presentation-properties";

/**
 * Immutable System Foundation 3.0.0 release.
 *
 * V3 starts from the exact v2 release and versions every nested exact
 * reference before applying v3-only definition projections. Keeping this
 * construction separate prevents the current-version alias from rewriting a
 * previously published manifest.
 */
export const SYSTEM_FOUNDATION_PACK_V3_MANIFEST: AssetPackManifest = {
  ...replaceFoundationVersion(
    SYSTEM_FOUNDATION_PACK_V2_MANIFEST,
    SYSTEM_FOUNDATION_V2_PACK_VERSION,
    SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
  ),
  version: SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
  description:
    "System-owned functional foundation with property-complete presentation contracts and bounded semantic styling.",
  assets: SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.map(versionEntry),
  metadata: {
    ...(SYSTEM_FOUNDATION_PACK_V2_MANIFEST.metadata ?? {}),
    catalogVersion: SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
    previousVersion: SYSTEM_FOUNDATION_V2_PACK_VERSION,
    propertyCompletePresentation: true,
    boundedSemanticStyling: true,
  },
};

export const SYSTEM_FOUNDATION_CURRENT_PACK_MANIFEST =
  SYSTEM_FOUNDATION_PACK_V3_MANIFEST;

function versionEntry(entry: AssetPackAssetEntry): AssetPackAssetEntry {
  const versioned = replaceFoundationVersion(
    entry,
    SYSTEM_FOUNDATION_V2_PACK_VERSION,
    SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
  );
  const definition = withSystemFoundationV3PresentationProperties(
    versioned.definition,
  );
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
        version: SYSTEM_FOUNDATION_V2_PACK_VERSION,
      } as unknown as AssetJsonValue,
    },
  };
}

function replaceFoundationVersion<T>(
  value: T,
  fromVersion: string,
  toVersion: string,
): T {
  if (value === fromVersion) return toVersion as T;
  if (Array.isArray(value)) {
    return value.map((item) =>
      replaceFoundationVersion(item, fromVersion, toVersion),
    ) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        replaceFoundationVersion(item, fromVersion, toVersion),
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
  if (version === SYSTEM_FOUNDATION_V2_PACK_VERSION) {
    return SYSTEM_FOUNDATION_PACK_V2_MANIFEST;
  }
  if (version === SYSTEM_FOUNDATION_CURRENT_PACK_VERSION) {
    return SYSTEM_FOUNDATION_PACK_V3_MANIFEST;
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
