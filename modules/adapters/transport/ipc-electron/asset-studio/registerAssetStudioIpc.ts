import type { RegisterAssetStudioApiRoutesDependencies } from "../../api-express/asset-studio";
import {
  DESKTOP_ASSET_STUDIO_CHANNELS,
  createIpcError,
  createIpcFailureResponse,
  createIpcSuccessResponse,
} from "../../../../contracts/ipc";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type {
  CreateAssetStudioAssetDraftCommand,
  ListAssetStudioAssetDraftsQuery,
  ProposeAssetStudioChangeCommand,
  ReviewAssetStudioProposalCommand,
  StartAssetStudioCommand,
  TransitionAssetStudioAssetDraftCommand,
  UpdateAssetStudioAssetDraftCommand,
} from "../../../../contracts/asset-studio";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface RegisterAssetStudioIpcDependencies extends Omit<
  RegisterAssetStudioApiRoutesDependencies,
  "app"
> {
  ipcMain: IpcMainHandlePort;
}

export function registerAssetStudioIpc(
  d: RegisterAssetStudioIpcDependencies,
): void {
  handle(d, "start", async (payload) =>
    d.start.execute({
      ...payload,
      workspaceId: createWorkspaceId(required(payload.workspaceId)),
      actorId: "local-user",
    } as unknown as StartAssetStudioCommand),
  );
  handle(d, "list", async (payload) =>
    d.list.execute(createWorkspaceId(required(payload.workspaceId))),
  );
  handle(d, "read", async (payload) =>
    d.read.execute(
      createWorkspaceId(required(payload.workspaceId)),
      required(payload.workflowId),
    ),
  );
  handle(d, "propose", async (payload) =>
    d.propose.execute({
      ...payload,
      workspaceId: createWorkspaceId(required(payload.workspaceId)),
      actorId: "local-user",
    } as unknown as ProposeAssetStudioChangeCommand),
  );
  handle(d, "review", async (payload) =>
    d.review.execute({
      ...payload,
      workspaceId: createWorkspaceId(required(payload.workspaceId)),
      actorId: "local-user",
    } as unknown as ReviewAssetStudioProposalCommand),
  );
  handle(d, "createAssetDraft", async (payload) =>
    d.assetDrafts.create({
      ...payload,
      workspaceId: createWorkspaceId(required(payload.workspaceId)),
      actorId: "local-user",
    } as unknown as CreateAssetStudioAssetDraftCommand),
  );
  handle(d, "updateAssetDraft", async (payload) =>
    d.assetDrafts.update({
      ...payload,
      workspaceId: createWorkspaceId(required(payload.workspaceId)),
      actorId: "local-user",
    } as unknown as UpdateAssetStudioAssetDraftCommand),
  );
  handle(d, "readAssetDraft", async (payload) =>
    d.assetDrafts.read({
      workspaceId: createWorkspaceId(required(payload.workspaceId)),
      draftId: required(payload.draftId) as never,
    }),
  );
  handle(d, "listAssetDrafts", async (payload) =>
    d.assetDrafts.list({
      ...payload,
      workspaceId: createWorkspaceId(required(payload.workspaceId)),
    } as unknown as ListAssetStudioAssetDraftsQuery),
  );
  handle(d, "reviewAssetDraft", async (payload) =>
    d.assetDrafts.review({
      ...payload,
      workspaceId: createWorkspaceId(required(payload.workspaceId)),
      actorId: "local-user",
    } as unknown as TransitionAssetStudioAssetDraftCommand),
  );
  handle(d, "publishAssetDraft", async (payload) =>
    d.assetDrafts.publish({
      ...payload,
      workspaceId: createWorkspaceId(required(payload.workspaceId)),
      actorId: "local-user",
    } as unknown as TransitionAssetStudioAssetDraftCommand),
  );
  handle(d, "abandonAssetDraft", async (payload) =>
    d.assetDrafts.abandon({
      ...payload,
      workspaceId: createWorkspaceId(required(payload.workspaceId)),
      actorId: "local-user",
    } as unknown as TransitionAssetStudioAssetDraftCommand),
  );
}

function handle(
  d: RegisterAssetStudioIpcDependencies,
  operation: keyof typeof DESKTOP_ASSET_STUDIO_CHANNELS,
  run: (payload: Record<string, unknown>) => Promise<any>,
): void {
  const channels = DESKTOP_ASSET_STUDIO_CHANNELS[operation];
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
                transportCode(value.error?.code),
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
          "Asset Studio request is invalid.",
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
const transportCode = (
  code: unknown,
): "validation" | "conflict" | "not-found" | "unavailable" => {
  const value = String(code);
  return value.includes("not-found")
    ? "not-found"
    : value.includes("invalid") || value.includes("validation")
      ? "validation"
      : value.includes("unavailable")
        ? "unavailable"
        : "conflict";
};
