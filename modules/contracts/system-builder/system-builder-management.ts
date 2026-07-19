import type { WorkspaceId } from "../workspace";
import type { SystemBuilderRevisionId } from "./system-builder-revision";
import type { SystemBuilderStatus } from "./system-builder-status";
import type { SystemBuilderSystemId } from "./system-builder-id";

export const SYSTEM_BUILDER_MANAGEMENT_VIEWS = [
  "active",
  "all",
  "unpublished",
  "published",
  "draft-changes",
  "archived",
] as const;

export type SystemBuilderManagementView =
  (typeof SYSTEM_BUILDER_MANAGEMENT_VIEWS)[number];

export const SYSTEM_BUILDER_MANAGEMENT_SORTS = [
  "updated-desc",
  "name-asc",
  "name-desc",
] as const;

export type SystemBuilderManagementSort =
  (typeof SYSTEM_BUILDER_MANAGEMENT_SORTS)[number];

export type SystemBuilderPublicationStatus =
  "unpublished" | "published" | "draft-changes";

export interface ListSystemBuilderManagementQuery {
  readonly workspaceId: WorkspaceId;
  readonly searchText?: string;
  readonly view?: SystemBuilderManagementView;
  readonly sort?: SystemBuilderManagementSort;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface SystemBuilderManagementReleaseSummary {
  readonly releaseId: string;
  readonly systemRevisionId: SystemBuilderRevisionId;
  readonly approvedAt: string;
}

export interface SystemBuilderManagementActions {
  readonly canPreview: boolean;
  readonly canOpenInCompose: boolean;
  readonly canDelete: boolean;
  readonly canRestore: boolean;
  readonly deleteStrategy: "archive";
  readonly unavailableReason?: string;
}

export interface SystemBuilderManagementItem {
  readonly systemId: SystemBuilderSystemId;
  readonly name: string;
  readonly description?: string;
  readonly designStatus: SystemBuilderStatus;
  readonly archived: boolean;
  readonly publicationStatus: SystemBuilderPublicationStatus;
  readonly recordRevision: number;
  readonly currentRevisionId?: SystemBuilderRevisionId;
  readonly assetCount: number;
  readonly releaseCount: number;
  readonly latestRelease?: SystemBuilderManagementReleaseSummary;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly actions: SystemBuilderManagementActions;
}

export interface SystemBuilderManagementPage {
  readonly items: readonly SystemBuilderManagementItem[];
  readonly totalCount: number;
  readonly nextCursor?: string;
  readonly query: {
    readonly searchText?: string;
    readonly view: SystemBuilderManagementView;
    readonly sort: SystemBuilderManagementSort;
    readonly limit: number;
  };
}
