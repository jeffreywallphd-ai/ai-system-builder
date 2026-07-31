import { normalizeAssetId, normalizeAssetReferenceKind } from "../../../../contracts/asset";
import {
  normalizeEffectiveAssetProjectionId,
  normalizeCreateEffectiveAssetProjectionCommand,
  normalizeEffectiveAssetProjectionSource,
  normalizeReadEffectiveAssetProjectionCommand,
  normalizeRefreshEffectiveAssetProjectionCommand,
  normalizeSafeEffectiveAssetProjectedFieldPatch,
  normalizeEffectiveAssetProjectionPolicy,
  normalizeEffectiveAssetProjectionSourceKind,
  normalizeEffectiveAssetProjectionStatus,
  type CreateEffectiveAssetProjectionCommand,
  type CreateEffectiveAssetProjectionResult,
  type PreviewDraftEffectiveAssetProjectionCommand,
  type RefreshEffectiveAssetProjectionCommand,
  type RefreshEffectiveAssetProjectionResult,
} from "../../../../contracts/effective-asset-projections";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { EffectiveAssetProjectionRepositoryPort } from "../../../../application/ports/effective-asset-projections";
import type { WorkspaceEffectiveAssetProjectionReadModelService } from "../../../../application/services/asset/workspace-effective-asset-projection-read-model.service";
import type {
  CreateAuthoredAssetEffectiveProjectionUseCase,
  CreateOverrideEffectiveProjectionUseCase,
  PreviewDraftEffectiveAssetProjectionUseCase,
  RefreshAuthoredAssetEffectiveProjectionUseCase,
  RefreshOverrideEffectiveProjectionUseCase,
} from "../../../../application/use-cases/effective-asset-projections";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

const C = {
  createAuthored: "effective-asset-projections:create-authored",
  refreshAuthored: "effective-asset-projections:refresh-authored",
  previewDraft: "effective-asset-projections:preview-draft",
  createOverride: "effective-asset-projections:create-override",
  refreshOverride: "effective-asset-projections:refresh-override",
  list: "effective-asset-projections:list",
  read: "effective-asset-projections:read",
  readByRef: "effective-asset-projections:read-by-effective-reference",
  listBlocked: "effective-asset-projections:list-blocked",
} as const;

const S = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const txt = (v: unknown): boolean => S(v).length > 0;
type PayloadEnvelope = { payload?: Record<string, unknown> };
type ProjectionCommandResult = CreateEffectiveAssetProjectionResult | RefreshEffectiveAssetProjectionResult;

export interface RegisterEffectiveAssetProjectionIpcDependencies {
  ipcMain: IpcMainHandlePort;
  createAuthored?: CreateAuthoredAssetEffectiveProjectionUseCase;
  refreshAuthored?: RefreshAuthoredAssetEffectiveProjectionUseCase;
  previewDraft?: PreviewDraftEffectiveAssetProjectionUseCase;
  createOverride?: CreateOverrideEffectiveProjectionUseCase;
  refreshOverride?: RefreshOverrideEffectiveProjectionUseCase;
  readModel?: WorkspaceEffectiveAssetProjectionReadModelService;
  projectionRepository?: EffectiveAssetProjectionRepositoryPort;
}

const fail = (op: string, code: string, message: string) => ({ ok: false, error: { operation: op, code, message } });
const ok = (op: string, value: unknown) => ({ ok: true, operation: op, value });

function normalizePreviewDraftCommand(payload: PreviewDraftEffectiveAssetProjectionCommand): PreviewDraftEffectiveAssetProjectionCommand {
  const normalizedSource = normalizeEffectiveAssetProjectionSource(payload.source);
  return {
    targetWorkspaceId: createWorkspaceId(payload.targetWorkspaceId),
    source: normalizedSource,
    policy: "draft-preview-only",
    ...(payload.projectedFieldPatch ? { projectedFieldPatch: normalizeSafeEffectiveAssetProjectedFieldPatch(payload.projectedFieldPatch) } : {}),
  };
}

export function registerEffectiveAssetProjectionIpc(d: RegisterEffectiveAssetProjectionIpcDependencies): void {
  const cmd = <TCommand>(
    channel: string,
    operation: string,
    workspaceField: "targetWorkspaceId",
    uc: { execute: (command: TCommand) => Promise<ProjectionCommandResult> } | undefined,
    normalize: (payload: Record<string, unknown>) => TCommand,
  ) => d.ipcMain.handle(channel, async (_e, request: PayloadEnvelope) => {
    const workspace = S(request?.payload?.[workspaceField]);
    if (!txt(workspace)) return fail(operation, "validation", `${workspaceField} is required.`);
    if (!uc) return fail(operation, "unavailable", "Operation unavailable.");
    try {
      const payload = { ...(request.payload ?? {}), [workspaceField]: createWorkspaceId(workspace) };
      const result = await uc.execute(normalize(payload));
      return result.status === "failure" ? fail(operation, result.failure.kind, "Operation failed.") : ok(operation, result.value);
    } catch {
      return fail(operation, "validation", "Invalid command payload.");
    }
  });

  cmd(C.createAuthored, C.createAuthored, "targetWorkspaceId", d.createAuthored, (payload) => normalizeCreateEffectiveAssetProjectionCommand(payload as CreateEffectiveAssetProjectionCommand));
  cmd(C.previewDraft, C.previewDraft, "targetWorkspaceId", d.previewDraft, (payload) => normalizePreviewDraftCommand(payload as PreviewDraftEffectiveAssetProjectionCommand));
  cmd(C.createOverride, C.createOverride, "targetWorkspaceId", d.createOverride, (payload) => normalizeCreateEffectiveAssetProjectionCommand(payload as CreateEffectiveAssetProjectionCommand));
  cmd(C.refreshAuthored, C.refreshAuthored, "targetWorkspaceId", d.refreshAuthored, (payload) => normalizeRefreshEffectiveAssetProjectionCommand(payload as RefreshEffectiveAssetProjectionCommand));
  cmd(C.refreshOverride, C.refreshOverride, "targetWorkspaceId", d.refreshOverride, (payload) => normalizeRefreshEffectiveAssetProjectionCommand(payload as RefreshEffectiveAssetProjectionCommand));

  d.ipcMain.handle(C.list, async (_e, request: PayloadEnvelope) => {
    const workspace = S(request?.payload?.targetWorkspaceId);
    if (!txt(workspace) || !d.readModel) return fail(C.list, txt(workspace) ? "unavailable" : "validation", txt(workspace) ? "Read unavailable." : "targetWorkspaceId is required.");
    try {
      return ok(C.list, await d.readModel.listByWorkspace({
        targetWorkspaceId: createWorkspaceId(workspace),
        limit: typeof request.payload?.limit === "number" ? request.payload.limit : undefined,
        cursor: typeof request.payload?.cursor === "string" ? request.payload.cursor : undefined,
        status: txt(request.payload?.status) ? normalizeEffectiveAssetProjectionStatus(S(request.payload?.status)) : undefined,
        sourceKind: txt(request.payload?.sourceKind) ? normalizeEffectiveAssetProjectionSourceKind(S(request.payload?.sourceKind)) : undefined,
        policy: txt(request.payload?.policy) ? normalizeEffectiveAssetProjectionPolicy(S(request.payload?.policy)) : undefined,
      }));
    } catch {
      return fail(C.list, "validation", "Invalid projection list request.");
    }
  });

  d.ipcMain.handle(C.read, async (_e, request: PayloadEnvelope) => {
    const workspace = S(request?.payload?.targetWorkspaceId);
    const projectionId = S(request?.payload?.projectionId);
    if (!txt(workspace) || !txt(projectionId) || !d.readModel) return fail(C.read, (!txt(workspace) || !txt(projectionId)) ? "validation" : "unavailable", (!txt(workspace) || !txt(projectionId)) ? "targetWorkspaceId and projectionId are required." : "Read unavailable.");
    try {
      const normalized = normalizeReadEffectiveAssetProjectionCommand({ targetWorkspaceId: createWorkspaceId(workspace), projectionId: normalizeEffectiveAssetProjectionId(projectionId) });
      const value = await d.readModel.readByProjectionId(normalized.targetWorkspaceId, normalized.projectionId);
      return value ? ok(C.read, value) : fail(C.read, "not-found", "Projection not found.");
    } catch {
      return fail(C.read, "validation", "Invalid request.");
    }
  });

  d.ipcMain.handle(C.readByRef, async (_e, request: PayloadEnvelope) => {
    const workspace = S(request?.payload?.targetWorkspaceId);
    const ref = request?.payload?.effectiveAssetReference;
    if (!txt(workspace) || !d.readModel || typeof ref !== "object" || ref === null) return fail(C.readByRef, "validation", "Invalid request or unavailable.");
    try {
      const refObj = ref as Record<string, unknown>;
      const kind = normalizeAssetReferenceKind(S(refObj.kind));
      const id = normalizeAssetId(S(refObj.id));
      const version = txt(refObj.version) ? S(refObj.version) : undefined;
      const value = await d.readModel.readByEffectiveAssetReference(createWorkspaceId(workspace), { kind, id, version });
      return value ? ok(C.readByRef, value) : fail(C.readByRef, "not-found", "Projection not found.");
    } catch {
      return fail(C.readByRef, "validation", "Invalid request or unavailable.");
    }
  });

  d.ipcMain.handle(C.listBlocked, async (_e, request: PayloadEnvelope) => {
    const workspace = S(request?.payload?.targetWorkspaceId);
    if (!txt(workspace) || !d.projectionRepository) return fail(C.listBlocked, txt(workspace) ? "unavailable" : "validation", txt(workspace) ? "Read unavailable." : "targetWorkspaceId is required.");
    const records = await d.projectionRepository.listBlockedConflictedOrStaleEffectiveAssetProjectionRecords(createWorkspaceId(workspace));
    return ok(C.listBlocked, { summaries: records });
  });
}
