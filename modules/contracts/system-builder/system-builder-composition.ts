import type { AssetComposition } from "../asset";

export const SYSTEM_BUILDER_COMPOSITION_TYPES = ["system", "system-of-subsystems"] as const;

export type SystemBuilderCompositionType = (typeof SYSTEM_BUILDER_COMPOSITION_TYPES)[number];

export type SystemBuilderComposition = Omit<AssetComposition, "compositionType"> & {
  readonly compositionType: SystemBuilderCompositionType;
};

export function isSystemBuilderCompositionType(value: unknown): value is SystemBuilderCompositionType {
  return typeof value === "string" && SYSTEM_BUILDER_COMPOSITION_TYPES.includes(value as SystemBuilderCompositionType);
}

export function normalizeSystemBuilderCompositionType(value: string): SystemBuilderCompositionType {
  const normalized = value.trim().toLowerCase();
  if (!isSystemBuilderCompositionType(normalized)) {
    throw new Error(`System Builder composition type must be one of ${SYSTEM_BUILDER_COMPOSITION_TYPES.join(", ")}.`);
  }
  return normalized;
}
