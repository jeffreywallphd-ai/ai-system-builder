import type { AssetConfigurationMetadata } from "./asset-configuration-value";

export const ASSET_AI_CONTEXT_SAFETY_NOTE_CATEGORIES = [
  "data-sensitivity",
  "filesystem-access",
  "network-access",
  "secret-access",
  "runtime-execution",
  "external-provider",
  "thin-client",
  "automation",
  "user-approval",
  "security",
  "privacy",
  "operational",
  "unknown",
] as const;

export type AssetAiContextSafetyNoteCategory =
  (typeof ASSET_AI_CONTEXT_SAFETY_NOTE_CATEGORIES)[number];

export const ASSET_AI_CONTEXT_SAFETY_NOTE_SEVERITIES = [
  "info",
  "warning",
  "critical",
] as const;

export type AssetAiContextSafetyNoteSeverity =
  (typeof ASSET_AI_CONTEXT_SAFETY_NOTE_SEVERITIES)[number];

export interface AssetAiContextSafetyNote {
  readonly safetyNoteId?: string;
  readonly category: AssetAiContextSafetyNoteCategory;
  readonly summary: string;
  readonly details?: string;
  readonly severity?: AssetAiContextSafetyNoteSeverity;
  readonly recommendedAction?: string;
  readonly metadata?: AssetConfigurationMetadata;
}

export function isAssetAiContextSafetyNoteCategory(
  value: string,
): value is AssetAiContextSafetyNoteCategory {
  return ASSET_AI_CONTEXT_SAFETY_NOTE_CATEGORIES.includes(
    value as AssetAiContextSafetyNoteCategory,
  );
}

export function normalizeAssetAiContextSafetyNoteCategory(
  value: string,
): AssetAiContextSafetyNoteCategory {
  const normalized = value.trim().toLowerCase();

  if (!isAssetAiContextSafetyNoteCategory(normalized)) {
    throw new Error(
      `Asset AI-context safety note category must be one of ${ASSET_AI_CONTEXT_SAFETY_NOTE_CATEGORIES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}

export function isAssetAiContextSafetyNoteSeverity(
  value: string,
): value is AssetAiContextSafetyNoteSeverity {
  return ASSET_AI_CONTEXT_SAFETY_NOTE_SEVERITIES.includes(
    value as AssetAiContextSafetyNoteSeverity,
  );
}

export function normalizeAssetAiContextSafetyNoteSeverity(
  value: string,
): AssetAiContextSafetyNoteSeverity {
  const normalized = value.trim().toLowerCase();

  if (!isAssetAiContextSafetyNoteSeverity(normalized)) {
    throw new Error(
      `Asset AI-context safety note severity must be one of ${ASSET_AI_CONTEXT_SAFETY_NOTE_SEVERITIES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
