import type { AssetBinding, AssetInstance, AssetPlacement, AssetReference } from "../asset";
import type { WorkspaceId } from "../workspace";
import type { SystemBuilderComposition } from "./system-builder-composition";
import type { SystemBuilderSystemId } from "./system-builder-id";
import type { SystemBuilderRevisionId } from "./system-builder-revision";
import type { SystemBuilderProfile, SystemBuilderStructure } from "./system-builder-structure";

interface SystemCommandContext {
  readonly workspaceId: WorkspaceId;
  readonly actorId: string;
}

export interface CreateSystemBuilderSystemCommand extends SystemCommandContext {
  readonly name: string;
  readonly description?: string;
  readonly compositionType?: SystemBuilderComposition["compositionType"];
  readonly profile?: SystemBuilderProfile;
  readonly layoutPresetRef?: AssetReference;
}

export interface ReadSystemBuilderSystemQuery {
  readonly workspaceId: WorkspaceId;
  readonly systemId: SystemBuilderSystemId;
}

export interface ListSystemBuilderSystemsQuery {
  readonly workspaceId: WorkspaceId;
  readonly includeArchived?: boolean;
}

export interface RenameSystemBuilderSystemCommand extends SystemCommandContext {
  readonly systemId: SystemBuilderSystemId;
  readonly expectedRevision: number;
  readonly name: string;
  readonly description?: string;
}

export interface CloneSystemBuilderSystemCommand extends SystemCommandContext {
  readonly sourceSystemId: SystemBuilderSystemId;
  readonly name: string;
}

export interface ChangeSystemBuilderArchiveStateCommand extends SystemCommandContext {
  readonly systemId: SystemBuilderSystemId;
  readonly expectedRevision: number;
}

export interface SaveSystemBuilderRevisionCommand extends SystemCommandContext {
  readonly systemId: SystemBuilderSystemId;
  readonly expectedRecordRevision: number;
  readonly composition: SystemBuilderComposition;
  readonly instances: readonly AssetInstance[];
  readonly bindings: readonly AssetBinding[];
  readonly structure?: SystemBuilderStructure;
  readonly placements?: readonly AssetPlacement[];
}

export interface ReadSystemBuilderRevisionQuery {
  readonly workspaceId: WorkspaceId;
  readonly systemId: SystemBuilderSystemId;
  readonly revisionId?: SystemBuilderRevisionId;
}

export interface ListSystemBuilderRevisionsQuery {
  readonly workspaceId: WorkspaceId;
  readonly systemId: SystemBuilderSystemId;
}
