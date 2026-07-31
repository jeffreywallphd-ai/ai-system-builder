import { createHash } from "node:crypto";

import type {
  AssetPackAssetEntry,
  AssetPackManifest,
} from "../../../contracts/asset";
import { sanitizeAssetViewValue } from "../asset/asset-safe-metadata";
import { stableStringify } from "./asset-pack-serialization.service";

export function createAssetPackManifestFingerprint(
  manifest: AssetPackManifest,
): string {
  return sha256(stableStringify(normalizeManifestFingerprintInput(manifest)));
}

export function createAssetPackEntryFingerprint(
  entry: AssetPackAssetEntry,
): string {
  return sha256(stableStringify(normalizeEntryFingerprintInput(entry)));
}

function normalizeManifestFingerprintInput(
  manifest: AssetPackManifest,
): Record<string, unknown> {
  const {
    checksum: _checksum,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    assets,
    overrideRules,
    dependencies,
    tags,
    categories,
    metadata,
    ...rest
  } = manifest;

  return sanitizeAssetViewValue({
    ...rest,
    assets: assets
      .map(normalizeEntryFingerprintInput)
      .sort(compareByStableString),
    overrideRules: (overrideRules ?? []).map(stripUnsafeValues).sort(compareByStableString),
    dependencies: (dependencies ?? []).map(stripUnsafeValues).sort(compareByStableString),
    tags: [...(tags ?? [])].sort(),
    categories: [...(categories ?? [])].sort(),
    metadata: stripUnsafeValues(metadata),
  }) as Record<string, unknown>;
}

function normalizeEntryFingerprintInput(
  entry: AssetPackAssetEntry,
): Record<string, unknown> {
  const {
    fingerprint: _fingerprint,
    tags,
    metadata,
    ...rest
  } = entry;
  return sanitizeAssetViewValue({
    ...rest,
    tags: [...(tags ?? [])].sort(),
    metadata: stripUnsafeValues(metadata),
  }) as Record<string, unknown>;
}

function stripUnsafeValues(value: unknown): unknown {
  return sanitizeAssetViewValue(value);
}

function compareByStableString(left: unknown, right: unknown): number {
  return stableStringify(left).localeCompare(stableStringify(right));
}

function sha256(input: string): string {
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}
