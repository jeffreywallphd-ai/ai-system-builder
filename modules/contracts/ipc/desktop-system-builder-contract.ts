import type {
  ChangeSystemBuilderArchiveStateCommand,
  CloneSystemBuilderSystemCommand,
  CreateSystemBuilderSystemCommand,
  RenameSystemBuilderSystemCommand,
  SaveSystemBuilderRevisionCommand,
  SystemBuilderRecord,
  SystemBuilderRevision,
  SystemBuilderComposerCatalog,
  SystemBuilderComposerAssetDetail,
  ListSystemBuilderManagementQuery,
  ReadSystemBuilderComposerAssetQuery,
  SystemBuilderManagementPage,
  PreviewSystemBuilderLayoutChangeCommand,
  SystemBuilderLayoutChangePreview,
  PreviewSystemBuilderFoundationUpgradeCommand,
  UpgradeSystemBuilderFoundationCommand,
  SystemBuilderFoundationUpgradePreview,
} from "../system-builder";
import { createTransportOperation } from "../transport";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import type { IpcResponse } from "./ipc-response";

export const DESKTOP_SYSTEM_BUILDER_OPERATIONS = {
  create: createTransportOperation("system-builder", "create"),
  listTemplates: createTransportOperation("system-builder", "list-templates"),
  createFromTemplate: createTransportOperation(
    "system-builder",
    "create-from-template",
  ),
  list: createTransportOperation("system-builder", "list"),
  listManagement: createTransportOperation("system-builder", "list-management"),
  read: createTransportOperation("system-builder", "read"),
  rename: createTransportOperation("system-builder", "rename"),
  archive: createTransportOperation("system-builder", "archive"),
  restore: createTransportOperation("system-builder", "restore"),
  clone: createTransportOperation("system-builder", "clone"),
  saveRevision: createTransportOperation("system-builder", "save-revision"),
  readRevision: createTransportOperation("system-builder", "read-revision"),
  listRevisions: createTransportOperation("system-builder", "list-revisions"),
  listComposerAssets: createTransportOperation(
    "system-builder",
    "list-composer-assets",
  ),
  readComposerAsset: createTransportOperation(
    "system-builder",
    "read-composer-asset",
  ),
  previewLayoutChange: createTransportOperation(
    "system-builder",
    "preview-layout-change",
  ),
  previewFoundationUpgrade: createTransportOperation(
    "system-builder",
    "preview-foundation-upgrade",
  ),
  upgradeFoundation: createTransportOperation(
    "system-builder",
    "upgrade-foundation",
  ),
} as const;

export const DESKTOP_SYSTEM_BUILDER_CHANNELS = Object.fromEntries(
  Object.entries(DESKTOP_SYSTEM_BUILDER_OPERATIONS).map(([key, operation]) => [
    key,
    {
      request: createIpcChannel(operation, "request"),
      response: createIpcChannel(operation, "response"),
    },
  ]),
) as {
  readonly [K in keyof typeof DESKTOP_SYSTEM_BUILDER_OPERATIONS]: {
    readonly request: ReturnType<typeof createIpcChannel>;
    readonly response: ReturnType<typeof createIpcChannel>;
  };
};

type WithoutActor<T> = Omit<T, "actorId">;
export type DesktopCreateSystemBuilderRequest = IpcRequest<
  WithoutActor<CreateSystemBuilderSystemCommand>,
  (typeof DESKTOP_SYSTEM_BUILDER_OPERATIONS)["create"]
>;
export type DesktopRenameSystemBuilderRequest = IpcRequest<
  WithoutActor<RenameSystemBuilderSystemCommand>,
  (typeof DESKTOP_SYSTEM_BUILDER_OPERATIONS)["rename"]
>;
export type DesktopChangeSystemBuilderArchiveRequest = IpcRequest<
  WithoutActor<ChangeSystemBuilderArchiveStateCommand>,
  (typeof DESKTOP_SYSTEM_BUILDER_OPERATIONS)["archive"]
>;
export type DesktopCloneSystemBuilderRequest = IpcRequest<
  WithoutActor<CloneSystemBuilderSystemCommand>,
  (typeof DESKTOP_SYSTEM_BUILDER_OPERATIONS)["clone"]
>;
export type DesktopSaveSystemBuilderRevisionRequest = IpcRequest<
  WithoutActor<SaveSystemBuilderRevisionCommand>,
  (typeof DESKTOP_SYSTEM_BUILDER_OPERATIONS)["saveRevision"]
>;
export type DesktopListSystemBuilderManagementRequest = IpcRequest<
  ListSystemBuilderManagementQuery,
  (typeof DESKTOP_SYSTEM_BUILDER_OPERATIONS)["listManagement"]
>;
export type DesktopPreviewSystemBuilderLayoutChangeRequest = IpcRequest<
  WithoutActor<PreviewSystemBuilderLayoutChangeCommand>,
  (typeof DESKTOP_SYSTEM_BUILDER_OPERATIONS)["previewLayoutChange"]
>;
export type DesktopPreviewSystemBuilderFoundationUpgradeRequest = IpcRequest<
  WithoutActor<PreviewSystemBuilderFoundationUpgradeCommand>,
  (typeof DESKTOP_SYSTEM_BUILDER_OPERATIONS)["previewFoundationUpgrade"]
>;
export type DesktopUpgradeSystemBuilderFoundationRequest = IpcRequest<
  WithoutActor<UpgradeSystemBuilderFoundationCommand>,
  (typeof DESKTOP_SYSTEM_BUILDER_OPERATIONS)["upgradeFoundation"]
>;
export type DesktopSystemBuilderRecordResponse =
  IpcResponse<SystemBuilderRecord>;
export type DesktopSystemBuilderListResponse = IpcResponse<
  readonly SystemBuilderRecord[]
>;
export type DesktopSystemBuilderManagementResponse =
  IpcResponse<SystemBuilderManagementPage>;
export type DesktopSystemBuilderRevisionResponse =
  IpcResponse<SystemBuilderRevision>;
export type DesktopSystemBuilderRevisionListResponse = IpcResponse<
  readonly SystemBuilderRevision[]
>;
export type DesktopSystemBuilderComposerCatalogResponse =
  IpcResponse<SystemBuilderComposerCatalog>;
export type DesktopReadSystemBuilderComposerAssetRequest = IpcRequest<
  ReadSystemBuilderComposerAssetQuery,
  (typeof DESKTOP_SYSTEM_BUILDER_OPERATIONS)["readComposerAsset"]
>;
export type DesktopSystemBuilderComposerAssetDetailResponse =
  IpcResponse<SystemBuilderComposerAssetDetail>;
export type DesktopSystemBuilderLayoutChangePreviewResponse =
  IpcResponse<SystemBuilderLayoutChangePreview>;
export type DesktopSystemBuilderFoundationUpgradePreviewResponse =
  IpcResponse<SystemBuilderFoundationUpgradePreview>;

export const createDesktopSystemBuilderRequest = <T>(
  operation: keyof typeof DESKTOP_SYSTEM_BUILDER_OPERATIONS,
  payload: T,
  context?: { requestId?: string; correlationId?: string },
) =>
  createIpcRequest(
    DESKTOP_SYSTEM_BUILDER_CHANNELS[operation].request,
    payload,
    context,
  );
