import type { AssetBinding, AssetInstance, AssetPlacement } from "../asset";
import type { WorkspaceId } from "../workspace";
import type { SystemBuilderComposition } from "./system-builder-composition";
import type { SystemBuilderStructure } from "./system-builder-structure";

export const SYSTEM_BUILDER_TEMPLATE_IDS = [
  "reference.controlled-chatbot@1.0.0",
  "reference.secured-data-review@1.0.0",
  "reference.secured-data-entry@1.0.0",
] as const;

export type SystemBuilderTemplateId =
  (typeof SYSTEM_BUILDER_TEMPLATE_IDS)[number];

export interface SystemBuilderTemplateSummary {
  readonly templateId: SystemBuilderTemplateId;
  readonly displayName: string;
  readonly description: string;
  readonly version: "1.0.0";
  readonly referenceSystemKind:
    "secured-data-entry" | "controlled-chatbot" | "secured-data-review";
}

export interface SystemBuilderTemplateMaterialization {
  readonly composition: SystemBuilderComposition;
  readonly description: string;
  readonly instances: readonly AssetInstance[];
  readonly bindings: readonly AssetBinding[];
  readonly structure?: SystemBuilderStructure;
  readonly placements?: readonly AssetPlacement[];
}

export interface CreateSystemBuilderFromTemplateCommand {
  readonly workspaceId: WorkspaceId;
  readonly templateId: SystemBuilderTemplateId;
  readonly name?: string;
  readonly actorId: string;
}

export function normalizeSystemBuilderTemplateId(
  value: string,
): SystemBuilderTemplateId {
  const normalized = value.trim();
  if (
    !SYSTEM_BUILDER_TEMPLATE_IDS.includes(normalized as SystemBuilderTemplateId)
  ) {
    throw new Error("System Builder template id is unsupported.");
  }
  return normalized as SystemBuilderTemplateId;
}
