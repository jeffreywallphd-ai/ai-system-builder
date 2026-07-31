import type { SystemReleaseId } from "../../../contracts/system-build";
import type {
  SystemReviewAuditEntry,
  SystemReviewDescriptor,
} from "../../../contracts/system-review";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface SystemReviewResolvedDefinition {
  readonly descriptor: SystemReviewDescriptor;
  readonly allowedRoles: readonly string[];
  readonly protectedMetadataFields: readonly string[];
  readonly unmaskRoles: readonly string[];
}

export interface SystemReviewReleaseDefinitionPort {
  resolve(
    workspaceId: WorkspaceId,
    releaseId: SystemReleaseId,
  ): Promise<SystemReviewResolvedDefinition | undefined>;
}

export interface SystemReviewAuditRepositoryPort {
  appendAudit(entry: SystemReviewAuditEntry): Promise<void>;
  listAudit(
    workspaceId: WorkspaceId,
    releaseId: SystemReleaseId,
    limit: number,
  ): Promise<readonly SystemReviewAuditEntry[]>;
}
