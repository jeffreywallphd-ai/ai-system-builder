import type { AssetDefinition } from "../../../contracts/asset";
import { copyBoundedPassiveData, passiveTimestamp } from "../../../contracts/shared";
import { BUILT_IN_ASSET_DEFINITION_CATALOG } from "./built-ins/built-in-asset-definition-catalog";
import { readSystemFoundationManifest } from "../asset-packs/system-packs/system-foundation-pack-v3.manifest";

export type CodeOwnedAssetDefinition =
  | { readonly kind: "legacy" }
  | { readonly kind: "foundation"; readonly packId: string; readonly packVersion: string };

type Source = {
  readonly definition: AssetDefinition;
  readonly authority: CodeOwnedAssetDefinition;
  readonly enriched: (timestamp: string) => AssetDefinition;
  readonly timestampField: "lastSeededAt" | "installedAt";
  readonly markerField: "builtInSeed" | "assetPackInstall";
};

// Snapshot code-owned content once. Editable marker fingerprints are never the
// content comparison: the complete admitted record must equal an expected body.
const sources = new Map<string, Source>();
for (const seed of BUILT_IN_ASSET_DEFINITION_CATALOG) {
  if (typeof seed.fingerprint !== "string") throw new Error("Code-owned definition source is invalid.");
  const definition = copyBoundedPassiveData(seed.definition) as AssetDefinition;
  const seedId = seed.seedId, seedVersion = seed.seedVersion, fingerprint = seed.fingerprint;
  sources.set(key(definition), {
    definition, authority: { kind: "legacy" },
    markerField: "builtInSeed", timestampField: "lastSeededAt",
    enriched: (lastSeededAt) => ({ ...definition, metadata: {
      ...definition.metadata, builtInSeed: {
        seedId, seedVersion, fingerprint, managedBy: "asset-kernel", lastSeededAt,
      },
    } }),
  });
}
for (const version of ["1.0.0", "2.0.0", "3.0.0"]) {
  const manifest = readSystemFoundationManifest(version)!;
  for (const entry of manifest.assets) {
    const definition = copyBoundedPassiveData(entry.definition) as AssetDefinition;
    const packId = manifest.packId, packVersion = manifest.version;
    const entryId = entry.entryId, fingerprint = entry.fingerprint, sourceLayer = entry.sourceLayer;
    sources.set(key(definition), {
      definition, authority: { kind: "foundation", packId, packVersion },
      markerField: "assetPackInstall", timestampField: "installedAt",
      enriched: (installedAt) => ({
        ...definition,
        metadata: {
          ...definition.metadata, sourcePackId: packId, sourcePackVersion: packVersion,
          sourceLayer, sourcePackEntryId: entryId, sourcePackFingerprint: fingerprint,
          assetPackInstall: {
            packId, packVersion, entryId, fingerprint, sourceKind: "system",
            sourceLayer: "system-default", trustStatus: "system-trusted",
            managedBy: "asset-kernel", installedAt,
          },
        },
        provenance: { ...definition.provenance, metadata: {
          ...definition.provenance.metadata, sourcePackId: packId,
          sourcePackVersion: packVersion, sourceLayer, sourcePackEntryId: entryId,
        } },
      }),
    });
  }
}

/** Own one complete passive copy before read-side projection and classification. */
export function admitAssetDefinitionForRead(input: unknown): {
  readonly definition: AssetDefinition;
  readonly authority: CodeOwnedAssetDefinition | undefined;
} {
  const definition = copyBoundedPassiveData(input) as AssetDefinition;
  return { definition, authority: matchAdmittedDefinition(definition) };
}

/** Read-side classification only; no install, seeding, hash migration or writes. */
export function matchCodeOwnedAssetDefinition(input: unknown): CodeOwnedAssetDefinition | undefined {
  try { return admitAssetDefinitionForRead(input).authority; }
  catch { return undefined; } // Malformed, accessor-bearing or oversized bodies cannot earn a badge.
}

// Only the safe admission above supplies this private matcher. An invalid
// authority marker on otherwise passive custom content must not deny the read.
function matchAdmittedDefinition(candidate: AssetDefinition): CodeOwnedAssetDefinition | undefined {
  try {
    if (!candidate || typeof candidate.definitionId !== "string" || typeof candidate.version !== "string") return undefined;
    const source = sources.get(key(candidate));
    if (!source) return undefined;
    if (equalContent(candidate, source.definition)) return { ...source.authority };
    const marker = candidate.metadata?.[source.markerField];
    if (!marker || typeof marker !== "object" || Array.isArray(marker)) return undefined;
    const timestamp = passiveTimestamp((marker as Record<string, unknown>)[source.timestampField]);
    if (equalContent(candidate, source.enriched(timestamp))) return { ...source.authority };
  } catch {
    // Invalid marker timestamps cannot confer authority; the admitted body is still readable.
  }
  return undefined;
}

function key(definition: AssetDefinition): string {
  return `${definition.definitionId}@${definition.version}`;
}

function equalContent(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => equalContent(value, right[index]));
  }
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  // JSON persistence omits undefined object fields. Array positions above retain
  // their meanings; neither ordering nor display normalization changes content.
  const keys = Object.keys(a).filter((name) => a[name] !== undefined);
  return keys.length === Object.keys(b).filter((name) => b[name] !== undefined).length
    && keys.every((name) => Object.prototype.hasOwnProperty.call(b, name) && equalContent(a[name], b[name]));
}
