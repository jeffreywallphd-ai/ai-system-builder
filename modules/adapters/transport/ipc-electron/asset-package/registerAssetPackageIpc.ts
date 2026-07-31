import type { RegisterAssetPackageApiRoutesDependencies } from "../../api-express/asset-package";
import { DESKTOP_ASSET_PACKAGE_CHANNELS, createIpcError, createIpcFailureResponse, createIpcSuccessResponse } from "../../../../contracts/ipc";
import { normalizeSha256Digest } from "../../../../contracts/asset-implementation";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface RegisterAssetPackageIpcDependencies extends Omit<RegisterAssetPackageApiRoutesDependencies, "app"> { ipcMain: IpcMainHandlePort }

export function registerAssetPackageIpc(d: RegisterAssetPackageIpcDependencies): void {
  handle(d, "list", async (payload) => d.list.execute(createWorkspaceId(required(payload.workspaceId))));
  handle(d, "inspect", async (payload) => d.inspect.execute({ workspaceId: createWorkspaceId(required(payload.workspaceId)), bytes: toBytes(payload.bytes), actorId: "local-user" }));
  handle(d, "admit", async (payload) => d.admit.execute({ workspaceId: createWorkspaceId(required(payload.workspaceId)), inspectionId: required(payload.inspectionId), packageDigest: normalizeSha256Digest(required(payload.packageDigest)), approvalScope: payload.approvalScope === "organization" ? "organization" : "workspace", approvedCapabilities: strings(payload.approvedCapabilities), actorId: "local-user" }));
  for (const operation of ["activate", "disable", "rollback"] as const) {
    handle(d, operation, async (payload) => d[operation].execute({ workspaceId: createWorkspaceId(required(payload.workspaceId)), recordId: required(payload.recordId), actorId: "local-user" }));
  }
}

function handle(d: RegisterAssetPackageIpcDependencies, operation: keyof typeof DESKTOP_ASSET_PACKAGE_CHANNELS, run: (payload: Record<string, unknown>) => Promise<any>): void {
  const channels = DESKTOP_ASSET_PACKAGE_CHANNELS[operation];
  d.ipcMain.handle(channels.request.value, async (_event, request: any) => {
    const context = { requestId: request?.requestId, correlationId: request?.correlationId };
    try {
      const value = await run(record(request?.payload));
      if (value && typeof value === "object" && "ok" in value) {
        if (value.ok) return createIpcSuccessResponse(channels.response as any, value.value, context);
        return createIpcFailureResponse(createIpcError(channels.response as any, "conflict", value.error.message, context) as any, context);
      }
      return createIpcSuccessResponse(channels.response as any, value, context);
    } catch {
      return createIpcFailureResponse(createIpcError(channels.response as any, "validation", "Asset package request is invalid.", context) as any, context);
    }
  });
}
const record = (value: unknown): Record<string, unknown> => { if (typeof value !== "object" || !value || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; };
const required = (value: unknown): string => { if (typeof value !== "string" || !value.trim()) throw new Error(); return value.trim(); };
const strings = (value: unknown): readonly string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
const toBytes = (value: unknown): Uint8Array => value instanceof Uint8Array ? value : Array.isArray(value) && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255) ? Uint8Array.from(value) : (() => { throw new Error(); })();
