import type { RegisterSystemBuildApiRoutesDependencies } from "../../api-express/system-build";
import { DESKTOP_SYSTEM_BUILD_CHANNELS, createIpcError, createIpcFailureResponse, createIpcSuccessResponse } from "../../../../contracts/ipc";
import { normalizeSystemBuildId, normalizeSystemReleaseId } from "../../../../contracts/system-build";
import { normalizeSystemBuilderRevisionId, normalizeSystemBuilderSystemId } from "../../../../contracts/system-builder";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface RegisterSystemBuildIpcDependencies extends Omit<RegisterSystemBuildApiRoutesDependencies, "app"> { ipcMain: IpcMainHandlePort }

export function registerSystemBuildIpc(d: RegisterSystemBuildIpcDependencies): void {
  handle(d, "prepare", (p) => d.prepare.execute({ workspaceId: createWorkspaceId(required(p.workspaceId)), systemId: normalizeSystemBuilderSystemId(required(p.systemId)), systemRevisionId: normalizeSystemBuilderRevisionId(required(p.systemRevisionId)) }));
  handle(d, "request", (p) => {
    exactKeys(p, ["buildId", "workspaceId", "systemId", "systemRevisionId"]);
    return d.guidedRequest.execute({
    buildId: normalizeSystemBuildId(required(p.buildId)),
    workspaceId: createWorkspaceId(required(p.workspaceId)),
    systemId: normalizeSystemBuilderSystemId(required(p.systemId)),
    systemRevisionId: normalizeSystemBuilderRevisionId(required(p.systemRevisionId)),
    actorId: "local-user",
    });
  });
  handle(d, "cancel", (p) => d.cancel.execute({ workspaceId: createWorkspaceId(required(p.workspaceId)), buildId: normalizeSystemBuildId(required(p.buildId)), actorId: "local-user" }));
  handle(d, "read", (p) => d.read.execute({ workspaceId: createWorkspaceId(required(p.workspaceId)), buildId: normalizeSystemBuildId(required(p.buildId)) }));
  handle(d, "list", (p) => d.list.execute({ workspaceId: createWorkspaceId(required(p.workspaceId)), ...(p.systemId ? { systemId: normalizeSystemBuilderSystemId(required(p.systemId)) } : {}) }));
  handle(d, "approve", (p) => d.approve.execute({ workspaceId: createWorkspaceId(required(p.workspaceId)), buildId: normalizeSystemBuildId(required(p.buildId)), expectedLockDigest: required(p.expectedLockDigest), ...(p.releaseId ? { releaseId: normalizeSystemReleaseId(required(p.releaseId)) } : {}), actorId: "local-user" }));
  handle(d, "readRelease", (p) => d.readRelease.execute({ workspaceId: createWorkspaceId(required(p.workspaceId)), releaseId: normalizeSystemReleaseId(required(p.releaseId)) }));
  handle(d, "listReleases", (p) => d.listReleases.execute({ workspaceId: createWorkspaceId(required(p.workspaceId)), ...(p.systemId ? { systemId: normalizeSystemBuilderSystemId(required(p.systemId)) } : {}) }));
  handle(d, "publicationWorkspace", (p) => d.publicationWorkspace.execute({ workspaceId: createWorkspaceId(required(p.workspaceId)) }));
  handle(d, "compareReleases", (p) => d.compareReleases.execute({ workspaceId: createWorkspaceId(required(p.workspaceId)), leftReleaseId: normalizeSystemReleaseId(required(p.leftReleaseId)), rightReleaseId: normalizeSystemReleaseId(required(p.rightReleaseId)) }));
}

function handle(d: RegisterSystemBuildIpcDependencies, operation: keyof typeof DESKTOP_SYSTEM_BUILD_CHANNELS, run: (payload: Record<string, unknown>) => Promise<unknown>): void {
  const channels = DESKTOP_SYSTEM_BUILD_CHANNELS[operation];
  d.ipcMain.handle(channels.request.value, async (_event, request: unknown) => {
    const envelope = request as { requestId?: string; correlationId?: string; payload?: unknown };
    const context = { requestId: envelope?.requestId, correlationId: envelope?.correlationId };
    try {
      const value = await run(record(envelope?.payload));
      if (value && typeof value === "object" && "ok" in value) {
        const result = value as { ok: boolean; value?: unknown; error?: { code?: string; message?: string } };
        return result.ok ? createIpcSuccessResponse(channels.response as never, result.value, context) : createIpcFailureResponse(createIpcError(channels.response as never, result.error?.code?.includes("not-found") ? "not-found" : result.error?.code?.includes("conflict") ? "conflict" : "validation", result.error?.message ?? "The request failed.", context) as never, context);
      }
      return createIpcSuccessResponse(channels.response as never, value, context);
    } catch { return createIpcFailureResponse(createIpcError(channels.response as never, "validation", "System build request is invalid.", context) as never, context); }
  });
}
const record = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; };
const required = (value: unknown): string => { if (typeof value !== "string" || !value.trim()) throw new Error(); return value.trim(); };
function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error();
}
