import type { WorkspaceActorReference } from "./workspace-actor-reference";
import type { WorkspaceId } from "./workspace-id";
import type { WorkspaceMemberReference } from "./workspace-member-reference";
import type { WorkspaceStatus } from "./workspace-status";
import type { WorkspaceStorageRootDescriptor } from "./workspace-storage-root-descriptor";
import type {
  WorkspaceMetadata,
  WorkspaceSystemPackActivation,
} from "./workspace-system-pack-activation";
import type { OrganizationId } from "../organization";

export interface WorkspaceSettings {
  readonly defaultIncludeSystemFoundationAssets?: boolean;
}

/**
 * Passive workspace read/persistence contract. It carries metadata and optional
 * system-pack activation summaries only; it does not embed artifacts, images,
 * models, datasets, resource records, asset definitions, credentials, or a
 * permission engine.
 */
export interface WorkspaceRecord {
  /**
   * Required for new organization-owned records. Absence classifies an
   * existing record as legacy/unassigned; ordinary reads never infer it.
   */
  readonly organizationId?: OrganizationId;
  readonly workspaceId: WorkspaceId;
  readonly displayName: string;
  readonly description?: string;
  readonly status: WorkspaceStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly storageRoot?: WorkspaceStorageRootDescriptor;
  readonly ownerActorRef?: WorkspaceActorReference;
  readonly createdByActorRef?: WorkspaceActorReference;
  readonly members?: readonly WorkspaceMemberReference[];
  readonly settings?: WorkspaceSettings;
  readonly systemPackActivations?: readonly WorkspaceSystemPackActivation[];
  readonly metadata?: WorkspaceMetadata;
}
