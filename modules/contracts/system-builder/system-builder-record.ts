import type { AssetReference } from "../asset";
import type { AssetCompositionPlanId } from "../asset-composition";
import type { WorkspaceId } from "../workspace";
import type { SystemBuilderComposition } from "./system-builder-composition";
import type { SystemBuilderSystemId } from "./system-builder-id";
import type { SystemBuilderStatus } from "./system-builder-status";
import type { SystemBuilderRevisionId } from "./system-builder-revision";

/**
 * Workspace-owned design-time state for a composed system.
 *
 * Operational builder-application, host, installer, runtime, and resource-health
 * fields do not belong on this record.
 */
export interface SystemBuilderRecord {
  readonly systemId: SystemBuilderSystemId;
  readonly targetWorkspaceId: WorkspaceId;
  readonly name: string;
  readonly description?: string;
  readonly status: SystemBuilderStatus;
  readonly revision: number;
  readonly currentRevisionId?: SystemBuilderRevisionId;
  readonly composition: SystemBuilderComposition;
  readonly sourceCompositionPlanId?: AssetCompositionPlanId;
  readonly systemDefinitionRef?: AssetReference;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly archivedAt?: string;
}
