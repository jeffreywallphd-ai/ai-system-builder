import { createHash } from "node:crypto";

import type { AssetPackAssetEntry, AssetPackManifest } from "../../../contracts/asset";
import { captureAssetPackFingerprintInput } from "./asset-pack-fingerprint-input";
import { validateAssetPackAssetEntry, validateAssetPackManifest } from "./asset-pack-validation.service";

export const ASSET_PACK_SEMANTIC_FINGERPRINT_VERSION = "semantic-v2";
const PREFIX = `sha256:${ASSET_PACK_SEMANTIC_FINGERPRINT_VERSION}:`;
const INVALID = "Asset pack semantic fingerprint input is invalid.";

export type AssetPackFingerprintVerification =
  | { readonly status: "verified" }
  | { readonly status: "legacy-revalidation-required" }
  | { readonly status: "invalid" | "mismatch" };

/** Semantic identity only. Never grants trust, import approval or package-byte integrity. */
export function createAssetPackManifestFingerprint(manifest: AssetPackManifest): string {
  try {
    const captured = captureAssetPackFingerprintInput(manifest) as unknown as AssetPackManifest;
    optionalList(captured.tags, true);
    optionalList(captured.categories, true);
    optionalList(captured.dependencies);
    optionalList(captured.overrideRules);
    if (validateAssetPackManifest(captured).status === "invalid") throw new Error(INVALID);
    const { checksum: _checksum, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = captured;
    return hash("manifest", {
      ...rest,
      assets: captured.assets.map(semanticEntry).sort(compare),
      overrideRules: [...(captured.overrideRules ?? [])].sort(compare),
      dependencies: [...(captured.dependencies ?? [])].sort(compare),
      tags: [...(captured.tags ?? [])].sort(),
      categories: [...(captured.categories ?? [])].sort(),
    });
  } catch { throw new Error(INVALID); }
}

export function createAssetPackEntryFingerprint(entry: AssetPackAssetEntry | Omit<AssetPackAssetEntry, "fingerprint">): string {
  try {
    const captured = captureAssetPackFingerprintInput(entry) as unknown as AssetPackAssetEntry;
    // New entries may omit only the self-referential fingerprint being created.
    const forValidation = Object.prototype.hasOwnProperty.call(captured, "fingerprint") ? captured : { ...captured, fingerprint: "pending" };
    if (validateAssetPackAssetEntry(forValidation).some((i) => i.severity === "error")) throw new Error(INVALID);
    return hash("entry", semanticEntry(captured));
  } catch { throw new Error(INVALID); }
}

export function verifyAssetPackManifestFingerprint(manifest: AssetPackManifest, expected: string): AssetPackFingerprintVerification {
  return verify(expected, () => createAssetPackManifestFingerprint(manifest));
}

export function verifyAssetPackEntryFingerprint(entry: AssetPackAssetEntry, expected: string): AssetPackFingerprintVerification {
  return verify(expected, () => createAssetPackEntryFingerprint(entry));
}

function verify(expected: unknown, calculate: () => string): AssetPackFingerprintVerification {
  if (typeof expected !== "string") return { status: "invalid" };
  if (/^(?:sha256:[a-f0-9]{64}|fnv1a:[a-f0-9]{8})$/.test(expected)) return { status: "legacy-revalidation-required" };
  if (!/^sha256:semantic-v2:[a-f0-9]{64}$/.test(expected)) return { status: "invalid" };
  try { return { status: calculate() === expected ? "verified" : "mismatch" }; }
  catch { return { status: "invalid" }; }
}

function semanticEntry(entry: AssetPackAssetEntry): Record<string, unknown> {
  optionalList(entry.tags, true);
  const { fingerprint: _fingerprint, ...rest } = entry;
  return { ...rest, tags: [...(entry.tags ?? [])].sort() };
}

function optionalList(value: unknown, strings = false): void {
  if (value !== undefined && (!Array.isArray(value) || (strings && value.some((item) => typeof item !== "string")))) {
    throw new Error(INVALID);
  }
}

function canonical(value: unknown): string {
  // Only already captured and validated passive values reach this serializer.
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compare(left: unknown, right: unknown): number {
  const a = canonical(left); const b = canonical(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function hash(kind: "manifest" | "entry", value: unknown): string {
  return `${PREFIX}${createHash("sha256").update(canonical({ version: ASSET_PACK_SEMANTIC_FINGERPRINT_VERSION, kind, value })).digest("hex")}`;
}
