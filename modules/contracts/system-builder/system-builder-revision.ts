import type {
  AssetBinding,
  AssetInstance,
  AssetPlacement,
  AssetValidationIssue,
} from "../asset";
import type { WorkspaceId } from "../workspace";
import type { SystemBuilderComposition } from "./system-builder-composition";
import type { SystemBuilderSystemId } from "./system-builder-id";
import type { SystemBuilderStructure } from "./system-builder-structure";

export type SystemBuilderRevisionId = string & {
  readonly __systemBuilderRevisionIdBrand: unique symbol;
};

export function normalizeSystemBuilderRevisionId(value: string): SystemBuilderRevisionId {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(normalized) || normalized.includes("..")) {
    const error = new Error("System Builder revision id must be a safe non-path identifier.");
    error.stack = undefined;
    throw error;
  }
  return normalized as SystemBuilderRevisionId;
}

export interface SystemBuilderRevision {
  readonly revisionId: SystemBuilderRevisionId;
  readonly systemId: SystemBuilderSystemId;
  readonly targetWorkspaceId: WorkspaceId;
  readonly revisionNumber: number;
  readonly composition: SystemBuilderComposition;
  readonly instances: readonly AssetInstance[];
  readonly bindings: readonly AssetBinding[];
  readonly structure?: SystemBuilderStructure;
  readonly placements?: readonly AssetPlacement[];
  readonly validationIssues: readonly AssetValidationIssue[];
  readonly createdAt: string;
  readonly createdBy: string;
}

