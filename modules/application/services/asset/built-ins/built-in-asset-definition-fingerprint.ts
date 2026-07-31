import type { AssetDefinition, AssetJsonValue } from "../../../../contracts/asset";

export function createBuiltInAssetDefinitionFingerprint(definition: AssetDefinition): string {
  return `fnv1a:${fnv1a(stableStringify(definition))}`;
}

function stableStringify(value: AssetJsonValue | AssetDefinition | undefined): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item as AssetJsonValue)).join(",")}]`;
  const entries = Object.entries(value as Record<string, AssetJsonValue | undefined>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
