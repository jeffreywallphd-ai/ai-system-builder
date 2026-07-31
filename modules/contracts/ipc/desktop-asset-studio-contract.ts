import type {
  AssetStudioAssetDraftListView,
  AssetStudioAssetDraftRecord,
  AssetStudioAssetDraftView,
  AssetStudioProposalView,
  AssetStudioWorkflowRecord,
  CreateAssetStudioAssetDraftCommand,
  ListAssetStudioAssetDraftsQuery,
  ProposeAssetStudioChangeCommand,
  ReadAssetStudioAssetDraftQuery,
  ReviewAssetStudioProposalCommand,
  StartAssetStudioCommand,
  TransitionAssetStudioAssetDraftCommand,
  UpdateAssetStudioAssetDraftCommand,
} from "../asset-studio";
import type { AssetImplementationDraft } from "../asset-implementation";
import { createTransportOperation } from "../transport";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import type { IpcResponse } from "./ipc-response";

export const DESKTOP_ASSET_STUDIO_OPERATIONS = {
  start: createTransportOperation("asset-studio", "start"),
  propose: createTransportOperation("asset-studio", "propose"),
  review: createTransportOperation("asset-studio", "review"),
  read: createTransportOperation("asset-studio", "read"),
  list: createTransportOperation("asset-studio", "list"),
  createAssetDraft: createTransportOperation(
    "asset-studio",
    "create-asset-draft",
  ),
  updateAssetDraft: createTransportOperation(
    "asset-studio",
    "update-asset-draft",
  ),
  readAssetDraft: createTransportOperation("asset-studio", "read-asset-draft"),
  listAssetDrafts: createTransportOperation(
    "asset-studio",
    "list-asset-drafts",
  ),
  reviewAssetDraft: createTransportOperation(
    "asset-studio",
    "review-asset-draft",
  ),
  publishAssetDraft: createTransportOperation(
    "asset-studio",
    "publish-asset-draft",
  ),
  abandonAssetDraft: createTransportOperation(
    "asset-studio",
    "abandon-asset-draft",
  ),
} as const;

export const DESKTOP_ASSET_STUDIO_CHANNELS = Object.fromEntries(
  Object.entries(DESKTOP_ASSET_STUDIO_OPERATIONS).map(([key, operation]) => [
    key,
    {
      request: createIpcChannel(operation, "request"),
      response: createIpcChannel(operation, "response"),
    },
  ]),
) as {
  readonly [K in keyof typeof DESKTOP_ASSET_STUDIO_OPERATIONS]: {
    readonly request: ReturnType<typeof createIpcChannel>;
    readonly response: ReturnType<typeof createIpcChannel>;
  };
};

export type DesktopAssetStudioProposeRequest = IpcRequest<
  Omit<ProposeAssetStudioChangeCommand, "actorId">,
  (typeof DESKTOP_ASSET_STUDIO_OPERATIONS)["propose"]
>;
export type DesktopAssetStudioStartRequest = IpcRequest<
  Omit<StartAssetStudioCommand, "actorId">,
  (typeof DESKTOP_ASSET_STUDIO_OPERATIONS)["start"]
>;
export type DesktopAssetStudioReviewRequest = IpcRequest<
  Omit<ReviewAssetStudioProposalCommand, "actorId">,
  (typeof DESKTOP_ASSET_STUDIO_OPERATIONS)["review"]
>;
export type DesktopAssetStudioReadRequest = IpcRequest<
  { readonly workspaceId: string; readonly workflowId: string },
  (typeof DESKTOP_ASSET_STUDIO_OPERATIONS)["read"]
>;
export type DesktopAssetStudioListRequest = IpcRequest<
  { readonly workspaceId: string },
  (typeof DESKTOP_ASSET_STUDIO_OPERATIONS)["list"]
>;
export type DesktopAssetStudioCreateAssetDraftRequest = IpcRequest<
  Omit<CreateAssetStudioAssetDraftCommand, "actorId">,
  (typeof DESKTOP_ASSET_STUDIO_OPERATIONS)["createAssetDraft"]
>;
export type DesktopAssetStudioUpdateAssetDraftRequest = IpcRequest<
  Omit<UpdateAssetStudioAssetDraftCommand, "actorId">,
  (typeof DESKTOP_ASSET_STUDIO_OPERATIONS)["updateAssetDraft"]
>;
export type DesktopAssetStudioReadAssetDraftRequest = IpcRequest<
  ReadAssetStudioAssetDraftQuery,
  (typeof DESKTOP_ASSET_STUDIO_OPERATIONS)["readAssetDraft"]
>;
export type DesktopAssetStudioListAssetDraftsRequest = IpcRequest<
  ListAssetStudioAssetDraftsQuery,
  (typeof DESKTOP_ASSET_STUDIO_OPERATIONS)["listAssetDrafts"]
>;
export type DesktopAssetStudioReviewAssetDraftRequest = IpcRequest<
  Omit<TransitionAssetStudioAssetDraftCommand, "actorId">,
  (typeof DESKTOP_ASSET_STUDIO_OPERATIONS)["reviewAssetDraft"]
>;
export type DesktopAssetStudioPublishAssetDraftRequest = IpcRequest<
  Omit<TransitionAssetStudioAssetDraftCommand, "actorId">,
  (typeof DESKTOP_ASSET_STUDIO_OPERATIONS)["publishAssetDraft"]
>;
export type DesktopAssetStudioAbandonAssetDraftRequest = IpcRequest<
  Omit<TransitionAssetStudioAssetDraftCommand, "actorId">,
  (typeof DESKTOP_ASSET_STUDIO_OPERATIONS)["abandonAssetDraft"]
>;
export type DesktopAssetStudioProposalResponse =
  IpcResponse<AssetStudioProposalView>;
export type DesktopAssetStudioDraftResponse =
  IpcResponse<AssetImplementationDraft>;
export type DesktopAssetStudioWorkflowResponse =
  IpcResponse<AssetStudioWorkflowRecord>;
export type DesktopAssetStudioListResponse = IpcResponse<
  readonly AssetStudioWorkflowRecord[]
>;
export type DesktopAssetStudioAssetDraftResponse =
  IpcResponse<AssetStudioAssetDraftRecord>;
export type DesktopAssetStudioAssetDraftViewResponse =
  IpcResponse<AssetStudioAssetDraftView>;
export type DesktopAssetStudioAssetDraftListResponse =
  IpcResponse<AssetStudioAssetDraftListView>;

export const createDesktopAssetStudioRequest = <T>(
  operation: keyof typeof DESKTOP_ASSET_STUDIO_OPERATIONS,
  payload: T,
  context?: { requestId?: string; correlationId?: string },
) =>
  createIpcRequest(
    DESKTOP_ASSET_STUDIO_CHANNELS[operation].request,
    payload,
    context,
  );
