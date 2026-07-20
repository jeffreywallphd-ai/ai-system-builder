import type { RegisterSystemBuilderApiRoutesDependencies } from "../../api-express/system-builder";
import {
  DESKTOP_SYSTEM_BUILDER_CHANNELS,
  createIpcError,
  createIpcFailureResponse,
  createIpcSuccessResponse,
} from "../../../../contracts/ipc";
import {
  normalizeSystemBuilderRevisionId,
  normalizeSystemBuilderSystemId,
  normalizeSystemBuilderTemplateId,
} from "../../../../contracts/system-builder";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface RegisterSystemBuilderIpcDependencies extends Omit<
  RegisterSystemBuilderApiRoutesDependencies,
  "app"
> {
  ipcMain: IpcMainHandlePort;
}

export function registerSystemBuilderIpc(
  d: RegisterSystemBuilderIpcDependencies,
): void {
  handle(d, "create", (p) =>
    d.create.execute({
      ...p,
      workspaceId: createWorkspaceId(required(p.workspaceId)),
      actorId: "local-user",
    } as any),
  );
  handle(d, "listTemplates", () => d.listTemplates.execute());
  handle(d, "createFromTemplate", (p) =>
    d.createFromTemplate.execute({
      workspaceId: createWorkspaceId(required(p.workspaceId)),
      templateId: normalizeSystemBuilderTemplateId(required(p.templateId)),
      ...(typeof p.name === "string" ? { name: p.name } : {}),
      actorId: "local-user",
    }),
  );
  handle(d, "list", (p) =>
    d.list.execute({
      workspaceId: createWorkspaceId(required(p.workspaceId)),
      includeArchived: p.includeArchived === true,
    }),
  );
  handle(d, "listManagement", (p) =>
    d.listManagement.execute({
      ...p,
      workspaceId: createWorkspaceId(required(p.workspaceId)),
    } as any),
  );
  handle(d, "read", (p) =>
    d.read.execute({
      workspaceId: createWorkspaceId(required(p.workspaceId)),
      systemId: normalizeSystemBuilderSystemId(required(p.systemId)),
    }),
  );
  handle(d, "rename", (p) =>
    d.rename.execute({
      ...p,
      workspaceId: createWorkspaceId(required(p.workspaceId)),
      systemId: normalizeSystemBuilderSystemId(required(p.systemId)),
      actorId: "local-user",
    } as any),
  );
  handle(d, "archive", (p) =>
    d.archive.execute({
      ...p,
      workspaceId: createWorkspaceId(required(p.workspaceId)),
      systemId: normalizeSystemBuilderSystemId(required(p.systemId)),
      actorId: "local-user",
    } as any),
  );
  handle(d, "restore", (p) =>
    d.restore.execute({
      ...p,
      workspaceId: createWorkspaceId(required(p.workspaceId)),
      systemId: normalizeSystemBuilderSystemId(required(p.systemId)),
      actorId: "local-user",
    } as any),
  );
  handle(d, "clone", (p) =>
    d.clone.execute({
      ...p,
      workspaceId: createWorkspaceId(required(p.workspaceId)),
      sourceSystemId: normalizeSystemBuilderSystemId(
        required(p.sourceSystemId),
      ),
      actorId: "local-user",
    } as any),
  );
  handle(d, "saveRevision", (p) =>
    d.saveRevision.execute({
      ...p,
      workspaceId: createWorkspaceId(required(p.workspaceId)),
      systemId: normalizeSystemBuilderSystemId(required(p.systemId)),
      actorId: "local-user",
    } as any),
  );
  handle(d, "readRevision", (p) =>
    d.readRevision.execute({
      workspaceId: createWorkspaceId(required(p.workspaceId)),
      systemId: normalizeSystemBuilderSystemId(required(p.systemId)),
      ...(p.revisionId
        ? {
            revisionId: normalizeSystemBuilderRevisionId(
              required(p.revisionId),
            ),
          }
        : {}),
    }),
  );
  handle(d, "listRevisions", (p) =>
    d.listRevisions.execute({
      workspaceId: createWorkspaceId(required(p.workspaceId)),
      systemId: normalizeSystemBuilderSystemId(required(p.systemId)),
    }),
  );
  handle(d, "listComposerAssets", (p) =>
    d.listComposerAssets.execute({
      ...p,
      workspaceId: createWorkspaceId(required(p.workspaceId)),
    } as any),
  );
  handle(d, "previewLayoutChange", (p) =>
    d.previewLayoutChange.execute({
      ...p,
      workspaceId: createWorkspaceId(required(p.workspaceId)),
      systemId: normalizeSystemBuilderSystemId(required(p.systemId)),
      actorId: "local-user",
    } as any),
  );
}

function handle(
  d: RegisterSystemBuilderIpcDependencies,
  operation: keyof typeof DESKTOP_SYSTEM_BUILDER_CHANNELS,
  run: (payload: Record<string, unknown>) => Promise<any>,
): void {
  const channels = DESKTOP_SYSTEM_BUILDER_CHANNELS[operation];
  d.ipcMain.handle(channels.request.value, async (_event, request: any) => {
    const context = {
      requestId: request?.requestId,
      correlationId: request?.correlationId,
    };
    try {
      const value = await run(record(request?.payload));
      if (value && typeof value === "object" && "ok" in value)
        return value.ok
          ? createIpcSuccessResponse(
              channels.response as any,
              value.value,
              context,
            )
          : createIpcFailureResponse(
              createIpcError(
                channels.response as any,
                value.error.code?.includes("not-found")
                  ? "not-found"
                  : value.error.code?.includes("stale")
                    ? "conflict"
                    : "validation",
                value.error.message,
                context,
              ) as any,
              context,
            );
      return createIpcSuccessResponse(channels.response as any, value, context);
    } catch {
      return createIpcFailureResponse(
        createIpcError(
          channels.response as any,
          "validation",
          "System Builder request is invalid.",
          context,
        ) as any,
        context,
      );
    }
  });
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error();
  return value as Record<string, unknown>;
};
const required = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error();
  return value.trim();
};
