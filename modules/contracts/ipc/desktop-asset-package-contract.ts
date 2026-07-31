import type {
  AdmitAssetPackageCommand,
  AssetPackageInspectionSummary,
  AssetPackageRecord,
  SetAssetPackageActivationCommand,
} from "../asset-package";
import { createTransportOperation } from "../transport";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import type { IpcResponse } from "./ipc-response";

export const DESKTOP_ASSET_PACKAGE_OPERATIONS = {
  inspect: createTransportOperation("asset-package", "inspect"),
  admit: createTransportOperation("asset-package", "admit"),
  list: createTransportOperation("asset-package", "list"),
  activate: createTransportOperation("asset-package", "activate"),
  disable: createTransportOperation("asset-package", "disable"),
  rollback: createTransportOperation("asset-package", "rollback"),
} as const;

export const DESKTOP_ASSET_PACKAGE_CHANNELS = Object.fromEntries(
  Object.entries(DESKTOP_ASSET_PACKAGE_OPERATIONS).map(([key, operation]) => [
    key,
    { request: createIpcChannel(operation, "request"), response: createIpcChannel(operation, "response") },
  ]),
) as {
  readonly [K in keyof typeof DESKTOP_ASSET_PACKAGE_OPERATIONS]: {
    readonly request: ReturnType<typeof createIpcChannel>;
    readonly response: ReturnType<typeof createIpcChannel>;
  };
};

export type DesktopAssetPackageInspectRequest = IpcRequest<
  { readonly workspaceId: string; readonly bytes: Uint8Array },
  (typeof DESKTOP_ASSET_PACKAGE_OPERATIONS)["inspect"]
>;
export type DesktopAssetPackageAdmitRequest = IpcRequest<AdmitAssetPackageCommand, (typeof DESKTOP_ASSET_PACKAGE_OPERATIONS)["admit"]>;
export type DesktopAssetPackageMutationRequest = IpcRequest<SetAssetPackageActivationCommand, (typeof DESKTOP_ASSET_PACKAGE_OPERATIONS)["activate"]>;
export type DesktopAssetPackageInspectResponse = IpcResponse<AssetPackageInspectionSummary>;
export type DesktopAssetPackageRecordResponse = IpcResponse<AssetPackageRecord>;
export type DesktopAssetPackageListResponse = IpcResponse<readonly AssetPackageRecord[]>;

export const createDesktopAssetPackageRequest = <T>(
  operation: keyof typeof DESKTOP_ASSET_PACKAGE_OPERATIONS,
  payload: T,
  context?: { requestId?: string; correlationId?: string },
) => createIpcRequest(DESKTOP_ASSET_PACKAGE_CHANNELS[operation].request, payload, context);
