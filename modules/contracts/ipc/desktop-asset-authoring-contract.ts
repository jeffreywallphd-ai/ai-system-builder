import type {
  AssetAuthoringConflictStatus,
  AssetAuthoringEffectiveSourceSummary,
  AssetCustomizationTargetSourceKind,
  AssetOverrideRecord,
  AssetOverrideStatus,
  AuthoredAssetDraftRecord,
  AuthoredAssetRecord,
  AuthoredAssetRevisionRecord,
  AuthoredAssetId,
  AssetDraftId,
  AssetOverrideId,
  AssetRevisionId,
  CreateAssetDraftCommand,
  CreateAssetOverrideCommand,
  CreateWorkspaceAuthoredAssetCommand,
  DisableAssetOverrideCommand,
  PublishAssetDraftCommand,
  UpdateAssetDraftCommand,
  UpdateAssetOverrideCommand,
  AssetAuthoringFailureCode,
  AbandonAssetDerivedCustomizationCommand,
  AssetDerivedCustomizationDraftRecord,
  AssetDerivedCustomizationTargetDetail,
  CreateAssetDerivedCustomizationCommand,
  ListAssetDerivedCustomizationsQuery,
  ListAssetDerivedCustomizationTargetsQuery,
  ListAssetDerivedCustomizationTargetsResult,
  PublishAssetDerivedCustomizationCommand,
  ReadAssetDerivedCustomizationTargetQuery,
  ReviewAssetDerivedCustomizationCommand,
  UpdateAssetDerivedCustomizationCommand,
} from "../asset-authoring";
import { ASSET_DERIVED_CUSTOMIZATION_OPERATIONS } from "../asset-authoring";
import type { WorkspaceId } from "../workspace";
import { createTransportOperation } from "../transport";
import { createIpcChannel, type IpcChannel } from "./ipc-channel";
import { createIpcError } from "./ipc-error";
import { createIpcFailureResponse, createIpcSuccessResponse, type IpcResponse } from "./ipc-response";
import type { IpcRequest } from "./ipc-request";
import type { IpcOperation } from "./ipc-operation";

export const DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_OPERATION = createTransportOperation("asset-authoring", "create-workspace-authored-asset");
export const DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_OPERATION = createTransportOperation("asset-authoring", "create-draft");
export const DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_OPERATION = createTransportOperation("asset-authoring", "update-draft");
export const DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_OPERATION = createTransportOperation("asset-authoring", "publish-draft");
export const DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_OPERATION = createTransportOperation("asset-authoring", "create-override");
export const DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_OPERATION = createTransportOperation("asset-authoring", "update-override");
export const DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_OPERATION = createTransportOperation("asset-authoring", "disable-override");
export const DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_OPERATION = createTransportOperation("asset-authoring", "list-authored-assets");
export const DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_OPERATION = createTransportOperation("asset-authoring", "read-authored-asset");
export const DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_OPERATION = createTransportOperation("asset-authoring", "list-drafts");
export const DESKTOP_ASSET_AUTHORING_READ_DRAFT_OPERATION = createTransportOperation("asset-authoring", "read-draft");
export const DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_OPERATION = createTransportOperation("asset-authoring", "list-revisions");
export const DESKTOP_ASSET_AUTHORING_READ_REVISION_OPERATION = createTransportOperation("asset-authoring", "read-revision");
export const DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_OPERATION = createTransportOperation("asset-authoring", "list-overrides");
export const DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_OPERATION = createTransportOperation("asset-authoring", "read-override");
export const DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_OPERATION = createTransportOperation("asset-authoring", "list-effective-summaries");

export const DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS = Object.freeze({
  listTargets: channels(ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.listTargets),
  readTarget: channels(ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.readTarget),
  create: channels(ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.create),
  update: channels(ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.update),
  review: channels(ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.review),
  publish: channels(ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.publish),
  abandon: channels(ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.abandon),
  list: channels(ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.list),
  read: channels(ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.read),
});

export const DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_OPERATION, "request"); export const DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_OPERATION, "response");
export const DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_OPERATION, "request"); export const DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_OPERATION, "response");
export const DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_OPERATION, "request"); export const DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_OPERATION, "response");
export const DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_OPERATION, "request"); export const DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_OPERATION, "response");
export const DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_OPERATION, "request"); export const DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_OPERATION, "response");
export const DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_OPERATION, "request"); export const DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_OPERATION, "response");
export const DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_OPERATION, "request"); export const DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_OPERATION, "response");
export const DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_OPERATION, "request"); export const DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_OPERATION, "response");
export const DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_OPERATION, "request"); export const DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_OPERATION, "response");
export const DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_OPERATION, "request"); export const DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_OPERATION, "response");
export const DESKTOP_ASSET_AUTHORING_READ_DRAFT_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_READ_DRAFT_OPERATION, "request"); export const DESKTOP_ASSET_AUTHORING_READ_DRAFT_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_READ_DRAFT_OPERATION, "response");
export const DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_OPERATION, "request"); export const DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_OPERATION, "response");
export const DESKTOP_ASSET_AUTHORING_READ_REVISION_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_READ_REVISION_OPERATION, "request"); export const DESKTOP_ASSET_AUTHORING_READ_REVISION_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_READ_REVISION_OPERATION, "response");
export const DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_OPERATION, "request"); export const DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_OPERATION, "response");
export const DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_OPERATION, "request"); export const DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_OPERATION, "response");
export const DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_OPERATION, "request"); export const DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_OPERATION, "response");

export interface DesktopAssetAuthoringListAuthoredAssetsRequestPayload { readonly workspaceId: WorkspaceId; readonly status?: AuthoredAssetRecord["status"]; readonly assetKind?: string; readonly authoredAssetId?: AuthoredAssetId; readonly text?: string; readonly limit?: number; readonly cursor?: string; }
export interface DesktopAssetAuthoringReadAuthoredAssetRequestPayload { readonly workspaceId: WorkspaceId; readonly authoredAssetId: AuthoredAssetId; }
export interface DesktopAssetAuthoringListDraftsRequestPayload { readonly targetWorkspaceId: WorkspaceId; readonly status?: AuthoredAssetDraftRecord["status"]; readonly assetKind?: string; readonly authoredAssetId?: AuthoredAssetId; readonly draftId?: AssetDraftId; readonly text?: string; readonly limit?: number; readonly cursor?: string; }
export interface DesktopAssetAuthoringReadDraftRequestPayload { readonly targetWorkspaceId: WorkspaceId; readonly draftId: AssetDraftId; }
export interface DesktopAssetAuthoringListRevisionsRequestPayload { readonly workspaceId: WorkspaceId; readonly status?: AuthoredAssetRevisionRecord["status"]; readonly assetKind?: string; readonly authoredAssetId?: AuthoredAssetId; readonly revisionId?: AssetRevisionId; readonly text?: string; readonly limit?: number; readonly cursor?: string; }
export interface DesktopAssetAuthoringReadRevisionRequestPayload { readonly workspaceId: WorkspaceId; readonly revisionId: AssetRevisionId; }
export interface DesktopAssetAuthoringListOverridesRequestPayload { readonly targetWorkspaceId: WorkspaceId; readonly status?: AssetOverrideStatus; readonly conflictStatus?: AssetAuthoringConflictStatus; readonly assetKind?: string; readonly authoredAssetId?: AuthoredAssetId; readonly draftId?: AssetDraftId; readonly overrideId?: AssetOverrideId; readonly sourceKind?: AssetCustomizationTargetSourceKind; readonly text?: string; readonly limit?: number; readonly cursor?: string; }
export interface DesktopAssetAuthoringReadOverrideRequestPayload { readonly targetWorkspaceId: WorkspaceId; readonly overrideId: AssetOverrideId; }
export interface DesktopAssetAuthoringListEffectiveSummariesRequestPayload { readonly targetWorkspaceId: WorkspaceId; readonly sourceKind?: AssetAuthoringEffectiveSourceSummary["effectiveSourceKind"]; readonly conflictStatus?: AssetAuthoringConflictStatus; readonly assetKind?: string; readonly authoredAssetId?: AuthoredAssetId; readonly draftId?: AssetDraftId; readonly overrideId?: AssetOverrideId; readonly text?: string; readonly limit?: number; readonly cursor?: string; }

export type DesktopAssetAuthoringCreateWorkspaceAuthoredAssetRequest = IpcRequest<CreateWorkspaceAuthoredAssetCommand, typeof DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_REQUEST_CHANNEL.value>;
export type DesktopAssetAuthoringCreateDraftRequest = IpcRequest<CreateAssetDraftCommand, typeof DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL.value>;
export type DesktopAssetAuthoringUpdateDraftRequest = IpcRequest<UpdateAssetDraftCommand, typeof DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_REQUEST_CHANNEL.value>;
export type DesktopAssetAuthoringPublishDraftRequest = IpcRequest<PublishAssetDraftCommand, typeof DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_REQUEST_CHANNEL.value>;
export type DesktopAssetAuthoringCreateOverrideRequest = IpcRequest<CreateAssetOverrideCommand, typeof DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_REQUEST_CHANNEL.value>;
export type DesktopAssetAuthoringUpdateOverrideRequest = IpcRequest<UpdateAssetOverrideCommand, typeof DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_REQUEST_CHANNEL.value>;
export type DesktopAssetAuthoringDisableOverrideRequest = IpcRequest<DisableAssetOverrideCommand, typeof DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_REQUEST_CHANNEL.value>;
export type DesktopAssetAuthoringListAuthoredAssetsRequest = IpcRequest<DesktopAssetAuthoringListAuthoredAssetsRequestPayload, typeof DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_REQUEST_CHANNEL.value>;
export type DesktopAssetAuthoringReadAuthoredAssetRequest = IpcRequest<DesktopAssetAuthoringReadAuthoredAssetRequestPayload, typeof DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_REQUEST_CHANNEL.value>;
export type DesktopAssetAuthoringListDraftsRequest = IpcRequest<DesktopAssetAuthoringListDraftsRequestPayload, typeof DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_REQUEST_CHANNEL.value>;
export type DesktopAssetAuthoringReadDraftRequest = IpcRequest<DesktopAssetAuthoringReadDraftRequestPayload, typeof DESKTOP_ASSET_AUTHORING_READ_DRAFT_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_READ_DRAFT_REQUEST_CHANNEL.value>;
export type DesktopAssetAuthoringListRevisionsRequest = IpcRequest<DesktopAssetAuthoringListRevisionsRequestPayload, typeof DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_REQUEST_CHANNEL.value>;
export type DesktopAssetAuthoringReadRevisionRequest = IpcRequest<DesktopAssetAuthoringReadRevisionRequestPayload, typeof DESKTOP_ASSET_AUTHORING_READ_REVISION_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_READ_REVISION_REQUEST_CHANNEL.value>;
export type DesktopAssetAuthoringListOverridesRequest = IpcRequest<DesktopAssetAuthoringListOverridesRequestPayload, typeof DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_REQUEST_CHANNEL.value>;
export type DesktopAssetAuthoringReadOverrideRequest = IpcRequest<DesktopAssetAuthoringReadOverrideRequestPayload, typeof DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_REQUEST_CHANNEL.value>;
export type DesktopAssetAuthoringListEffectiveSummariesRequest = IpcRequest<DesktopAssetAuthoringListEffectiveSummariesRequestPayload, typeof DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_REQUEST_CHANNEL.value>;

export type DesktopAssetAuthoringCreateWorkspaceAuthoredAssetResponse = IpcResponse<AuthoredAssetRecord, Record<string, unknown>, typeof DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_RESPONSE_CHANNEL.value>;
export type DesktopAssetAuthoringCreateDraftResponse = IpcResponse<AuthoredAssetDraftRecord, Record<string, unknown>, typeof DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_RESPONSE_CHANNEL.value>;
export type DesktopAssetAuthoringUpdateDraftResponse = IpcResponse<AuthoredAssetDraftRecord, Record<string, unknown>, typeof DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_RESPONSE_CHANNEL.value>;
export type DesktopAssetAuthoringPublishDraftResponse = IpcResponse<AuthoredAssetRevisionRecord, Record<string, unknown>, typeof DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_RESPONSE_CHANNEL.value>;
export type DesktopAssetAuthoringCreateOverrideResponse = IpcResponse<AssetOverrideRecord, Record<string, unknown>, typeof DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_RESPONSE_CHANNEL.value>;
export type DesktopAssetAuthoringUpdateOverrideResponse = IpcResponse<AssetOverrideRecord, Record<string, unknown>, typeof DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_RESPONSE_CHANNEL.value>;
export type DesktopAssetAuthoringDisableOverrideResponse = IpcResponse<AssetOverrideRecord, Record<string, unknown>, typeof DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_RESPONSE_CHANNEL.value>;
export type DesktopAssetAuthoringListAuthoredAssetsResponse = IpcResponse<{ readonly assets: readonly AuthoredAssetRecord[]; readonly nextCursor?: string }, Record<string, unknown>, typeof DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_RESPONSE_CHANNEL.value>;
export type DesktopAssetAuthoringReadAuthoredAssetResponse = IpcResponse<AuthoredAssetRecord, Record<string, unknown>, typeof DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_RESPONSE_CHANNEL.value>;
export type DesktopAssetAuthoringListDraftsResponse = IpcResponse<{ readonly drafts: readonly AuthoredAssetDraftRecord[]; readonly nextCursor?: string }, Record<string, unknown>, typeof DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_RESPONSE_CHANNEL.value>;
export type DesktopAssetAuthoringReadDraftResponse = IpcResponse<AuthoredAssetDraftRecord, Record<string, unknown>, typeof DESKTOP_ASSET_AUTHORING_READ_DRAFT_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_READ_DRAFT_RESPONSE_CHANNEL.value>;
export type DesktopAssetAuthoringListRevisionsResponse = IpcResponse<{ readonly revisions: readonly AuthoredAssetRevisionRecord[]; readonly nextCursor?: string }, Record<string, unknown>, typeof DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_RESPONSE_CHANNEL.value>;
export type DesktopAssetAuthoringReadRevisionResponse = IpcResponse<AuthoredAssetRevisionRecord, Record<string, unknown>, typeof DESKTOP_ASSET_AUTHORING_READ_REVISION_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_READ_REVISION_RESPONSE_CHANNEL.value>;
export type DesktopAssetAuthoringListOverridesResponse = IpcResponse<{ readonly overrides: readonly AssetOverrideRecord[]; readonly nextCursor?: string }, Record<string, unknown>, typeof DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_RESPONSE_CHANNEL.value>;
export type DesktopAssetAuthoringReadOverrideResponse = IpcResponse<AssetOverrideRecord, Record<string, unknown>, typeof DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_RESPONSE_CHANNEL.value>;
export type DesktopAssetAuthoringListEffectiveSummariesResponse = IpcResponse<{ readonly items: readonly AssetAuthoringEffectiveSourceSummary[]; readonly nextCursor?: string }, Record<string, unknown>, typeof DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_OPERATION, Record<string, never>, typeof DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_RESPONSE_CHANNEL.value>;

export type DesktopAssetDerivedCustomizationListTargetsRequest = IpcRequest<ListAssetDerivedCustomizationTargetsQuery, typeof ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.listTargets, Record<string, never>, typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.listTargets.request.value>;
export type DesktopAssetDerivedCustomizationReadTargetRequest = IpcRequest<ReadAssetDerivedCustomizationTargetQuery, typeof ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.readTarget, Record<string, never>, typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.readTarget.request.value>;
export type DesktopAssetDerivedCustomizationCreateRequest = IpcRequest<Omit<CreateAssetDerivedCustomizationCommand, "actorId">, typeof ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.create, Record<string, never>, typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.create.request.value>;
export type DesktopAssetDerivedCustomizationUpdateRequest = IpcRequest<Omit<UpdateAssetDerivedCustomizationCommand, "actorId">, typeof ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.update, Record<string, never>, typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.update.request.value>;
export type DesktopAssetDerivedCustomizationReviewRequest = IpcRequest<Omit<ReviewAssetDerivedCustomizationCommand, "actorId">, typeof ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.review, Record<string, never>, typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.review.request.value>;
export type DesktopAssetDerivedCustomizationPublishRequest = IpcRequest<Omit<PublishAssetDerivedCustomizationCommand, "actorId">, typeof ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.publish, Record<string, never>, typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.publish.request.value>;
export type DesktopAssetDerivedCustomizationAbandonRequest = IpcRequest<Omit<AbandonAssetDerivedCustomizationCommand, "actorId">, typeof ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.abandon, Record<string, never>, typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.abandon.request.value>;
export type DesktopAssetDerivedCustomizationListRequest = IpcRequest<ListAssetDerivedCustomizationsQuery, typeof ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.list, Record<string, never>, typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.list.request.value>;
export type DesktopAssetDerivedCustomizationReadRequest = IpcRequest<{ readonly workspaceId: WorkspaceId; readonly customizationId: string }, typeof ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.read, Record<string, never>, typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.read.request.value>;

export type DesktopAssetDerivedCustomizationListTargetsResponse = IpcResponse<ListAssetDerivedCustomizationTargetsResult, Record<string, unknown>, typeof ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.listTargets, Record<string, never>, typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.listTargets.response.value>;
export type DesktopAssetDerivedCustomizationReadTargetResponse = IpcResponse<AssetDerivedCustomizationTargetDetail, Record<string, unknown>, typeof ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.readTarget, Record<string, never>, typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.readTarget.response.value>;
export type DesktopAssetDerivedCustomizationCreateResponse = IpcResponse<AssetDerivedCustomizationDraftRecord, Record<string, unknown>, typeof ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.create, Record<string, never>, typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.create.response.value>;
export type DesktopAssetDerivedCustomizationUpdateResponse = IpcResponse<AssetDerivedCustomizationDraftRecord, Record<string, unknown>, typeof ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.update, Record<string, never>, typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.update.response.value>;
export type DesktopAssetDerivedCustomizationReviewResponse = IpcResponse<AssetDerivedCustomizationDraftRecord, Record<string, unknown>, typeof ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.review, Record<string, never>, typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.review.response.value>;
export type DesktopAssetDerivedCustomizationPublishResponse = IpcResponse<AssetDerivedCustomizationDraftRecord, Record<string, unknown>, typeof ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.publish, Record<string, never>, typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.publish.response.value>;
export type DesktopAssetDerivedCustomizationAbandonResponse = IpcResponse<AssetDerivedCustomizationDraftRecord, Record<string, unknown>, typeof ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.abandon, Record<string, never>, typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.abandon.response.value>;
export type DesktopAssetDerivedCustomizationListResponse = IpcResponse<{ readonly customizations: readonly AssetDerivedCustomizationDraftRecord[]; readonly nextCursor?: string }, Record<string, unknown>, typeof ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.list, Record<string, never>, typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.list.response.value>;
export type DesktopAssetDerivedCustomizationReadResponse = IpcResponse<AssetDerivedCustomizationDraftRecord, Record<string, unknown>, typeof ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.read, Record<string, never>, typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.read.response.value>;

type DesktopAssetAuthoringResponseChannel = IpcChannel<IpcOperation, "response">;

export const createDesktopAssetAuthoringOperationSuccessResponse = <TValue>(responseChannel: DesktopAssetAuthoringResponseChannel, value: TValue, options?: { requestId?: string; correlationId?: string }) => createIpcSuccessResponse(responseChannel as never, value, options);
export const createDesktopAssetAuthoringFailureResponse = (responseChannel: DesktopAssetAuthoringResponseChannel, operation: string, code: AssetAuthoringFailureCode, message: string, options?: { requestId?: string; correlationId?: string }) => createIpcFailureResponse(createIpcError(responseChannel as never, code === "unsupported" ? "not-supported" : code, message, { requestId: options?.requestId, correlationId: options?.correlationId, details: { operation } }) as never);

function channels<TOperation extends IpcOperation>(operation: TOperation) {
  return Object.freeze({
    operation,
    request: createIpcChannel(operation, "request"),
    response: createIpcChannel(operation, "response"),
  });
}
