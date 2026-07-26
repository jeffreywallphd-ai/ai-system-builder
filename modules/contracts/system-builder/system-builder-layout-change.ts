import type {
  AssetBinding,
  AssetInstance,
  AssetPlacement,
  AssetReference,
  AssetValidationIssue,
} from "../asset";
import type { WorkspaceId } from "../workspace";
import type { SystemBuilderComposition } from "./system-builder-composition";
import type { SystemBuilderSystemId } from "./system-builder-id";
import type { SystemBuilderStructure } from "./system-builder-structure";

export interface PreviewSystemBuilderLayoutChangeCommand {
  readonly workspaceId: WorkspaceId;
  readonly actorId: string;
  readonly systemId: SystemBuilderSystemId;
  readonly expectedRecordRevision: number;
  readonly targetLayoutPresetRef: AssetReference;
  readonly composition: SystemBuilderComposition;
  readonly instances: readonly AssetInstance[];
  readonly bindings: readonly AssetBinding[];
  readonly structure?: SystemBuilderStructure;
  readonly placements?: readonly AssetPlacement[];
}

export type SystemBuilderLayoutChangeDisposition =
  "preserved" | "moved" | "unassigned";

export interface SystemBuilderLayoutChangeItem {
  readonly instanceRef: AssetReference;
  readonly disposition: SystemBuilderLayoutChangeDisposition;
  readonly fromSlotId: string;
  readonly toSlotId?: string;
}

export interface SystemBuilderLayoutChangePreview {
  readonly sourceLayoutPresetRef?: AssetReference;
  readonly targetLayoutPresetRef: AssetReference;
  readonly composition: SystemBuilderComposition;
  readonly structure: SystemBuilderStructure;
  readonly instances: readonly AssetInstance[];
  readonly bindings: readonly AssetBinding[];
  readonly placements: readonly AssetPlacement[];
  readonly changes: readonly SystemBuilderLayoutChangeItem[];
  readonly unassignedInstanceRefs: readonly AssetReference[];
  readonly validationIssues: readonly AssetValidationIssue[];
}
