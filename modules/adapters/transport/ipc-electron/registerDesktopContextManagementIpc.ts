import type { ApplicationRequestContext } from "../../../application/ports";
import {
  registerContextManagementIpc,
  type RegisterContextManagementIpcDependencies,
} from "./context-management/registerContextManagementIpc";
import type {
  IpcMainHandlePort,
  IpcSenderTrustPolicy,
} from "./ipcMainHandlePort";
import {
  lazyProvidedObject,
  type AsyncFeatureProvider,
  type LazyProvidedObjectOptions,
} from "./lazyFeatureProvider";

export type DesktopContextManagementIpcFeature = Pick<
  RegisterContextManagementIpcDependencies,
  "contextManagement"
>;

export interface RegisterDesktopContextManagementIpcDependencies {
  readonly ipcMain: IpcMainHandlePort;
  readonly senderTrust: IpcSenderTrustPolicy;
  readonly getContextManagementFeature: AsyncFeatureProvider<DesktopContextManagementIpcFeature>;
  readonly lifecycle?: LazyProvidedObjectOptions;
  readonly getAuthoritativeRequestContext?: () => Pick<
    ApplicationRequestContext,
    "organizationId" | "principalId"
  >;
}

export function registerDesktopContextManagementIpc(
  dependencies: RegisterDesktopContextManagementIpcDependencies,
): void {
  registerContextManagementIpc({
    ipcMain: dependencies.ipcMain,
    senderTrust: dependencies.senderTrust,
    contextManagement: lazyProvidedObject(
      dependencies.getContextManagementFeature,
      (feature) => feature.contextManagement,
      dependencies.lifecycle,
    ),
    getAuthoritativeRequestContext:
      dependencies.getAuthoritativeRequestContext,
  });
}
