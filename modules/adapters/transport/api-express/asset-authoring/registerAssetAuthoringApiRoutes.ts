import type { WorkspaceAssetAuthoringReadModelService } from "../../../../application/services/asset/workspace-asset-authoring-read-model.service";
import type { AssetDerivedCustomizationApplicationPort, AuthoredAssetRepositoryPort, AssetDraftRepositoryPort, AssetOverrideRepositoryPort, AssetRevisionRepositoryPort } from "../../../../application/ports/asset-authoring";
import type { CreateWorkspaceAuthoredAssetUseCase, CreateAssetDraftUseCase, UpdateAssetDraftUseCase, PublishAssetDraftUseCase, CreateAssetOverrideUseCase, UpdateAssetOverrideUseCase, DisableAssetOverrideUseCase } from "../../../../application/use-cases/asset-authoring";
import { createApiAssetAuthoringFailureResponse, createApiAssetAuthoringOperationSuccessResponse, API_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_OPERATION, API_ASSET_AUTHORING_CREATE_DRAFT_OPERATION, API_ASSET_AUTHORING_UPDATE_DRAFT_OPERATION, API_ASSET_AUTHORING_PUBLISH_DRAFT_OPERATION, API_ASSET_AUTHORING_CREATE_OVERRIDE_OPERATION, API_ASSET_AUTHORING_UPDATE_OVERRIDE_OPERATION, API_ASSET_AUTHORING_DISABLE_OVERRIDE_OPERATION, API_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_OPERATION, API_ASSET_AUTHORING_READ_AUTHORED_ASSET_OPERATION, API_ASSET_AUTHORING_LIST_DRAFTS_OPERATION, API_ASSET_AUTHORING_READ_DRAFT_OPERATION, API_ASSET_AUTHORING_LIST_REVISIONS_OPERATION, API_ASSET_AUTHORING_READ_REVISION_OPERATION, API_ASSET_AUTHORING_LIST_OVERRIDES_OPERATION, API_ASSET_AUTHORING_READ_OVERRIDE_OPERATION, API_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_OPERATION, API_ASSET_DERIVED_CUSTOMIZATION_LIST_TARGETS_OPERATION, API_ASSET_DERIVED_CUSTOMIZATION_READ_TARGET_OPERATION, API_ASSET_DERIVED_CUSTOMIZATION_CREATE_OPERATION, API_ASSET_DERIVED_CUSTOMIZATION_UPDATE_OPERATION, API_ASSET_DERIVED_CUSTOMIZATION_REVIEW_OPERATION, API_ASSET_DERIVED_CUSTOMIZATION_PUBLISH_OPERATION, API_ASSET_DERIVED_CUSTOMIZATION_ABANDON_OPERATION, API_ASSET_DERIVED_CUSTOMIZATION_LIST_OPERATION, API_ASSET_DERIVED_CUSTOMIZATION_READ_OPERATION } from "../../../../contracts/api";
import { normalizeAssetCustomizationId, normalizeAssetDraftId, normalizeAssetOverrideId, normalizeAssetRevisionId, normalizeAuthoredAssetId, normalizeExactAssetDefinitionReference, type AssetAuthoringFailureCode } from "../../../../contracts/asset-authoring";
import { normalizeAssetImplementationReleaseId } from "../../../../contracts/asset-implementation";
import { normalizeAssetId } from "../../../../contracts/asset";
import { createWorkspaceId } from "../../../../contracts/workspace";

interface App { get: (p: string, h: (req: Req, res: Res) => Promise<void> | void) => void; post: (p: string, h: (req: Req, res: Res) => Promise<void> | void) => void; patch: (p: string, h: (req: Req, res: Res) => Promise<void> | void) => void; }
type Req = { params?: Record<string, unknown>; query?: Record<string, unknown>; body?: Record<string, unknown>; securityContext?: { principal?: { id?: string } } };
type Res = { status: (code: number) => Res; json: (payload: unknown) => void };
type AssetAuthoringCommandUseCase<TCommand, TResult> = { execute(command: TCommand): Promise<TResult> };

export interface RegisterAssetAuthoringApiRoutesDependencies {
  app: App;
  createWorkspaceAuthoredAssetUseCase?: CreateWorkspaceAuthoredAssetUseCase;
  createAssetDraftUseCase?: CreateAssetDraftUseCase;
  updateAssetDraftUseCase?: UpdateAssetDraftUseCase;
  publishAssetDraftUseCase?: PublishAssetDraftUseCase;
  createAssetOverrideUseCase?: CreateAssetOverrideUseCase;
  updateAssetOverrideUseCase?: UpdateAssetOverrideUseCase;
  disableAssetOverrideUseCase?: DisableAssetOverrideUseCase;
  authoredAssetRepository?: AuthoredAssetRepositoryPort;
  assetDraftRepository?: AssetDraftRepositoryPort;
  assetRevisionRepository?: AssetRevisionRepositoryPort;
  assetOverrideRepository?: AssetOverrideRepositoryPort;
  effectiveSummaryReader?: WorkspaceAssetAuthoringReadModelService;
  derivedCustomizations?: AssetDerivedCustomizationApplicationPort;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const toLimit = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(1, Math.min(100, Math.trunc(numeric))) : 25;
};

const fail = (res: Res, operation: string, code: AssetAuthoringFailureCode, status: number, message: string) =>
  res.status(status).json(createApiAssetAuthoringFailureResponse(operation, code, message));

const mapStatus = (code: string) =>
  code === "validation" ? 400 : code === "not-found" ? 404 : code === "conflict" ? 409 : code === "unsupported" ? 501 : code === "unavailable" ? 503 : 500;

const required = (req: Req, key: string) => {
  const value = text(req.params?.[key]);
  return value ? { ok: true as const, value } : { ok: false as const };
};

const bodyWorkspaceMatches = (req: Req, key: string, workspaceId: string) => !req.body?.[key] || text(req.body[key]) === workspaceId;

export function registerAssetAuthoringApiRoutes(dependencies: RegisterAssetAuthoringApiRoutesDependencies): void {
  const command = <TCommand, TResult>(
    method: "post" | "patch",
    path: string,
    operation: string,
    useCase: AssetAuthoringCommandUseCase<TCommand, TResult> | undefined,
    workspaceField: "workspaceId" | "targetWorkspaceId",
  ) => dependencies.app[method](path, async (req, res) => {
    const workspace = required(req, "workspaceId");
    if (!workspace.ok) return fail(res, operation, "validation", 400, "workspaceId is required.");
    if (!bodyWorkspaceMatches(req, workspaceField, workspace.value)) return fail(res, operation, "validation", 400, "workspace route/body mismatch.");
    if (!useCase) return fail(res, operation, "unavailable", 503, "Operation unavailable.");

    try {
      const result = await useCase.execute(commandBody(req, workspaceField, workspace.value) as TCommand);
      if ((result as { kind?: string }).kind === "failure") {
        const failure = (result as { failure: { code: AssetAuthoringFailureCode; message: string } }).failure;
        return fail(res, operation, failure.code, mapStatus(failure.code), failure.message);
      }
      return res.status(200).json(createApiAssetAuthoringOperationSuccessResponse(operation, (result as { value: unknown }).value));
    } catch {
      return fail(res, operation, "internal", 500, "Operation failed.");
    }
  });

  command("post", "/api/asset-authoring/workspaces/:workspaceId/authored-assets", API_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_OPERATION, dependencies.createWorkspaceAuthoredAssetUseCase, "workspaceId");
  command("post", "/api/asset-authoring/workspaces/:workspaceId/drafts", API_ASSET_AUTHORING_CREATE_DRAFT_OPERATION, dependencies.createAssetDraftUseCase, "targetWorkspaceId");
  command("patch", "/api/asset-authoring/workspaces/:workspaceId/drafts/:draftId", API_ASSET_AUTHORING_UPDATE_DRAFT_OPERATION, dependencies.updateAssetDraftUseCase, "targetWorkspaceId");
  command("post", "/api/asset-authoring/workspaces/:workspaceId/drafts/:draftId/publish", API_ASSET_AUTHORING_PUBLISH_DRAFT_OPERATION, dependencies.publishAssetDraftUseCase, "targetWorkspaceId");
  command("post", "/api/asset-authoring/workspaces/:workspaceId/overrides", API_ASSET_AUTHORING_CREATE_OVERRIDE_OPERATION, dependencies.createAssetOverrideUseCase, "targetWorkspaceId");
  command("patch", "/api/asset-authoring/workspaces/:workspaceId/overrides/:overrideId", API_ASSET_AUTHORING_UPDATE_OVERRIDE_OPERATION, dependencies.updateAssetOverrideUseCase, "targetWorkspaceId");
  command("post", "/api/asset-authoring/workspaces/:workspaceId/overrides/:overrideId/disable", API_ASSET_AUTHORING_DISABLE_OVERRIDE_OPERATION, dependencies.disableAssetOverrideUseCase, "targetWorkspaceId");

  dependencies.app.get("/api/asset-authoring/workspaces/:workspaceId/authored-assets", async (req, res) => {
    if (!dependencies.authoredAssetRepository) return fail(res, API_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_OPERATION, "unavailable", 503, "Read unavailable.");
    const workspace = required(req, "workspaceId");
    if (!workspace.ok) return fail(res, API_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_OPERATION, "validation", 400, "workspaceId is required.");
    const result = await dependencies.authoredAssetRepository.listAuthoredAssetRecords({ workspaceId: createWorkspaceId(workspace.value), status: optionalText(req.query?.status) as never, limit: toLimit(req.query?.limit), cursor: optionalText(req.query?.cursor) });
    return res.status(200).json(createApiAssetAuthoringOperationSuccessResponse(API_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_OPERATION, { assets: result.records, nextCursor: result.nextCursor }));
  });

  dependencies.app.get("/api/asset-authoring/workspaces/:workspaceId/authored-assets/:authoredAssetId", async (req, res) => {
    if (!dependencies.authoredAssetRepository) return fail(res, API_ASSET_AUTHORING_READ_AUTHORED_ASSET_OPERATION, "unavailable", 503, "Read unavailable.");
    const workspace = required(req, "workspaceId");
    const id = required(req, "authoredAssetId");
    if (!workspace.ok || !id.ok) return fail(res, API_ASSET_AUTHORING_READ_AUTHORED_ASSET_OPERATION, "validation", 400, "workspaceId and authoredAssetId are required.");
    const item = await dependencies.authoredAssetRepository.readAuthoredAssetRecordByWorkspace(createWorkspaceId(workspace.value), normalizeAuthoredAssetId(id.value));
    if (!item) return fail(res, API_ASSET_AUTHORING_READ_AUTHORED_ASSET_OPERATION, "not-found", 404, "Authored asset was not found.");
    return res.status(200).json(createApiAssetAuthoringOperationSuccessResponse(API_ASSET_AUTHORING_READ_AUTHORED_ASSET_OPERATION, item));
  });

  dependencies.app.get("/api/asset-authoring/workspaces/:workspaceId/drafts", async (req, res) => {
    if (!dependencies.assetDraftRepository) return fail(res, API_ASSET_AUTHORING_LIST_DRAFTS_OPERATION, "unavailable", 503, "Read unavailable.");
    const workspace = required(req, "workspaceId");
    if (!workspace.ok) return fail(res, API_ASSET_AUTHORING_LIST_DRAFTS_OPERATION, "validation", 400, "workspaceId is required.");
    const result = await dependencies.assetDraftRepository.listAssetDraftRecords({ workspaceId: createWorkspaceId(workspace.value), status: optionalText(req.query?.status) as never, limit: toLimit(req.query?.limit), cursor: optionalText(req.query?.cursor) });
    return res.status(200).json(createApiAssetAuthoringOperationSuccessResponse(API_ASSET_AUTHORING_LIST_DRAFTS_OPERATION, { drafts: result.records, nextCursor: result.nextCursor }));
  });

  dependencies.app.get("/api/asset-authoring/workspaces/:workspaceId/drafts/:draftId", async (req, res) => {
    if (!dependencies.assetDraftRepository) return fail(res, API_ASSET_AUTHORING_READ_DRAFT_OPERATION, "unavailable", 503, "Read unavailable.");
    const workspace = required(req, "workspaceId");
    const id = required(req, "draftId");
    if (!workspace.ok || !id.ok) return fail(res, API_ASSET_AUTHORING_READ_DRAFT_OPERATION, "validation", 400, "workspaceId and draftId are required.");
    const item = await dependencies.assetDraftRepository.readAssetDraftRecord(createWorkspaceId(workspace.value), normalizeAssetDraftId(id.value));
    if (!item) return fail(res, API_ASSET_AUTHORING_READ_DRAFT_OPERATION, "not-found", 404, "Draft was not found.");
    return res.status(200).json(createApiAssetAuthoringOperationSuccessResponse(API_ASSET_AUTHORING_READ_DRAFT_OPERATION, item));
  });

  dependencies.app.get("/api/asset-authoring/workspaces/:workspaceId/revisions", async (req, res) => {
    if (!dependencies.assetRevisionRepository) return fail(res, API_ASSET_AUTHORING_LIST_REVISIONS_OPERATION, "unavailable", 503, "Read unavailable.");
    const workspace = required(req, "workspaceId");
    const authoredAssetId = optionalText(req.query?.authoredAssetId);
    if (!workspace.ok || !authoredAssetId) return fail(res, API_ASSET_AUTHORING_LIST_REVISIONS_OPERATION, "validation", 400, "workspaceId and authoredAssetId are required.");
    const result = await dependencies.assetRevisionRepository.listAssetRevisionRecords({ workspaceId: createWorkspaceId(workspace.value), authoredAssetId: normalizeAuthoredAssetId(authoredAssetId), status: optionalText(req.query?.status) as never, limit: toLimit(req.query?.limit), cursor: optionalText(req.query?.cursor) });
    return res.status(200).json(createApiAssetAuthoringOperationSuccessResponse(API_ASSET_AUTHORING_LIST_REVISIONS_OPERATION, { revisions: result.records, nextCursor: result.nextCursor }));
  });

  dependencies.app.get("/api/asset-authoring/workspaces/:workspaceId/revisions/:revisionId", async (req, res) => {
    if (!dependencies.assetRevisionRepository) return fail(res, API_ASSET_AUTHORING_READ_REVISION_OPERATION, "unavailable", 503, "Read unavailable.");
    const workspace = required(req, "workspaceId");
    const authoredAssetId = optionalText(req.query?.authoredAssetId);
    const revisionId = required(req, "revisionId");
    if (!workspace.ok || !authoredAssetId || !revisionId.ok) return fail(res, API_ASSET_AUTHORING_READ_REVISION_OPERATION, "validation", 400, "workspaceId, authoredAssetId, and revisionId are required.");
    const item = await dependencies.assetRevisionRepository.readAssetRevisionRecord(createWorkspaceId(workspace.value), normalizeAuthoredAssetId(authoredAssetId), normalizeAssetRevisionId(revisionId.value));
    if (!item) return fail(res, API_ASSET_AUTHORING_READ_REVISION_OPERATION, "not-found", 404, "Revision was not found.");
    return res.status(200).json(createApiAssetAuthoringOperationSuccessResponse(API_ASSET_AUTHORING_READ_REVISION_OPERATION, item));
  });

  dependencies.app.get("/api/asset-authoring/workspaces/:workspaceId/overrides", async (req, res) => {
    if (!dependencies.assetOverrideRepository) return fail(res, API_ASSET_AUTHORING_LIST_OVERRIDES_OPERATION, "unavailable", 503, "Read unavailable.");
    const workspace = required(req, "workspaceId");
    if (!workspace.ok) return fail(res, API_ASSET_AUTHORING_LIST_OVERRIDES_OPERATION, "validation", 400, "workspaceId is required.");
    const result = await dependencies.assetOverrideRepository.listAssetOverrideRecords({ targetWorkspaceId: createWorkspaceId(workspace.value), status: optionalText(req.query?.status) as never, conflictStatus: optionalText(req.query?.conflictStatus) as never, limit: toLimit(req.query?.limit), cursor: optionalText(req.query?.cursor) });
    return res.status(200).json(createApiAssetAuthoringOperationSuccessResponse(API_ASSET_AUTHORING_LIST_OVERRIDES_OPERATION, { overrides: result.records, nextCursor: result.nextCursor }));
  });

  dependencies.app.get("/api/asset-authoring/workspaces/:workspaceId/overrides/:overrideId", async (req, res) => {
    if (!dependencies.assetOverrideRepository) return fail(res, API_ASSET_AUTHORING_READ_OVERRIDE_OPERATION, "unavailable", 503, "Read unavailable.");
    const workspace = required(req, "workspaceId");
    const id = required(req, "overrideId");
    if (!workspace.ok || !id.ok) return fail(res, API_ASSET_AUTHORING_READ_OVERRIDE_OPERATION, "validation", 400, "workspaceId and overrideId are required.");
    const item = await dependencies.assetOverrideRepository.readAssetOverrideRecord(createWorkspaceId(workspace.value), normalizeAssetOverrideId(id.value));
    if (!item) return fail(res, API_ASSET_AUTHORING_READ_OVERRIDE_OPERATION, "not-found", 404, "Override was not found.");
    return res.status(200).json(createApiAssetAuthoringOperationSuccessResponse(API_ASSET_AUTHORING_READ_OVERRIDE_OPERATION, item));
  });

  dependencies.app.get("/api/asset-authoring/workspaces/:workspaceId/effective-summaries", async (_req, res) =>
    fail(res, API_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_OPERATION, "unavailable", 503, "Workspace-wide effective summaries are deferred in Phase 8."));

  registerDerivedCustomizationRoutes(dependencies);
}

function registerDerivedCustomizationRoutes(dependencies: RegisterAssetAuthoringApiRoutesDependencies): void {
  const unavailable = (res: Res, operation: string) =>
    fail(res, operation, "unavailable", 503, "Derived customization is unavailable.");
  const workspace = (req: Req) => {
    const value = required(req, "workspaceId");
    return value.ok ? createWorkspaceId(value.value) : undefined;
  };

  dependencies.app.get("/api/asset-authoring/workspaces/:workspaceId/customization-targets", async (req, res) => {
    const service = dependencies.derivedCustomizations;
    if (!service) return unavailable(res, API_ASSET_DERIVED_CUSTOMIZATION_LIST_TARGETS_OPERATION);
    const workspaceId = workspace(req);
    if (!workspaceId) return fail(res, API_ASSET_DERIVED_CUSTOMIZATION_LIST_TARGETS_OPERATION, "validation", 400, "workspaceId is required.");
    try {
      const value = await service.listTargets({ workspaceId, text: optionalText(req.query?.text), sourceKind: optionalText(req.query?.sourceKind) as never, eligibility: optionalText(req.query?.eligibility) as never, limit: toLimit(req.query?.limit), cursor: optionalText(req.query?.cursor) });
      return res.status(200).json(createApiAssetAuthoringOperationSuccessResponse(API_ASSET_DERIVED_CUSTOMIZATION_LIST_TARGETS_OPERATION, value));
    } catch {
      return fail(res, API_ASSET_DERIVED_CUSTOMIZATION_LIST_TARGETS_OPERATION, "validation", 400, "Customization target query is invalid.");
    }
  });

  dependencies.app.get("/api/asset-authoring/workspaces/:workspaceId/customization-targets/:implementationReleaseId", async (req, res) => {
    const service = dependencies.derivedCustomizations;
    if (!service) return unavailable(res, API_ASSET_DERIVED_CUSTOMIZATION_READ_TARGET_OPERATION);
    const workspaceId = workspace(req);
    const releaseId = required(req, "implementationReleaseId");
    const definitionId = optionalText(req.query?.definitionId);
    const definitionVersion = optionalText(req.query?.definitionVersion);
    if (!workspaceId || !releaseId.ok || !definitionId || !definitionVersion) return fail(res, API_ASSET_DERIVED_CUSTOMIZATION_READ_TARGET_OPERATION, "validation", 400, "workspaceId, definitionId, definitionVersion, and implementationReleaseId are required.");
    try {
      const value = await service.readTarget({ workspaceId, definitionRef: normalizeExactAssetDefinitionReference({ kind: "asset-definition-version", id: normalizeAssetId(definitionId), version: definitionVersion }), implementationReleaseId: normalizeAssetImplementationReleaseId(releaseId.value) });
      if (!value) return fail(res, API_ASSET_DERIVED_CUSTOMIZATION_READ_TARGET_OPERATION, "not-found", 404, "Customization target was not found.");
      return res.status(200).json(createApiAssetAuthoringOperationSuccessResponse(API_ASSET_DERIVED_CUSTOMIZATION_READ_TARGET_OPERATION, value));
    } catch {
      return fail(res, API_ASSET_DERIVED_CUSTOMIZATION_READ_TARGET_OPERATION, "validation", 400, "Customization target identity is invalid.");
    }
  });

  dependencies.app.get("/api/asset-authoring/workspaces/:workspaceId/derived-customizations", async (req, res) => {
    const service = dependencies.derivedCustomizations;
    if (!service) return unavailable(res, API_ASSET_DERIVED_CUSTOMIZATION_LIST_OPERATION);
    const workspaceId = workspace(req);
    if (!workspaceId) return fail(res, API_ASSET_DERIVED_CUSTOMIZATION_LIST_OPERATION, "validation", 400, "workspaceId is required.");
    try {
      const value = await service.list({ workspaceId, status: optionalText(req.query?.status) as never, text: optionalText(req.query?.text), limit: toLimit(req.query?.limit), cursor: optionalText(req.query?.cursor) });
      return res.status(200).json(createApiAssetAuthoringOperationSuccessResponse(API_ASSET_DERIVED_CUSTOMIZATION_LIST_OPERATION, { customizations: value.records, nextCursor: value.nextCursor }));
    } catch {
      return fail(res, API_ASSET_DERIVED_CUSTOMIZATION_LIST_OPERATION, "validation", 400, "Customization query is invalid.");
    }
  });

  dependencies.app.get("/api/asset-authoring/workspaces/:workspaceId/derived-customizations/:customizationId", async (req, res) => {
    const service = dependencies.derivedCustomizations;
    if (!service) return unavailable(res, API_ASSET_DERIVED_CUSTOMIZATION_READ_OPERATION);
    const workspaceId = workspace(req);
    const customizationId = required(req, "customizationId");
    if (!workspaceId || !customizationId.ok) return fail(res, API_ASSET_DERIVED_CUSTOMIZATION_READ_OPERATION, "validation", 400, "workspaceId and customizationId are required.");
    try {
      const value = await service.read(workspaceId, normalizeAssetCustomizationId(customizationId.value));
      if (!value) return fail(res, API_ASSET_DERIVED_CUSTOMIZATION_READ_OPERATION, "not-found", 404, "Derived customization was not found.");
      return res.status(200).json(createApiAssetAuthoringOperationSuccessResponse(API_ASSET_DERIVED_CUSTOMIZATION_READ_OPERATION, value));
    } catch {
      return fail(res, API_ASSET_DERIVED_CUSTOMIZATION_READ_OPERATION, "validation", 400, "Customization identity is invalid.");
    }
  });

  const mutation = (method: "post" | "patch", path: string, operation: string, execute: (service: AssetDerivedCustomizationApplicationPort, command: Record<string, unknown>) => Promise<unknown>) => dependencies.app[method](path, async (req, res) => {
    const service = dependencies.derivedCustomizations;
    if (!service) return unavailable(res, operation);
    const workspaceId = workspace(req);
    if (!workspaceId) return fail(res, operation, "validation", 400, "workspaceId is required.");
    const command = { ...(req.body ?? {}), workspaceId, ...(req.params?.customizationId ? { customizationId: text(req.params.customizationId) } : {}), actorId: actor(req) };
    try {
      const result = await execute(service, command) as { kind?: string; value?: unknown; failure?: { code: AssetAuthoringFailureCode; message: string } };
      if (result.kind === "failure" && result.failure) return fail(res, operation, result.failure.code, mapStatus(result.failure.code), result.failure.message);
      if (result.kind !== "success") return fail(res, operation, "internal", 500, "Operation failed.");
      return res.status(200).json(createApiAssetAuthoringOperationSuccessResponse(operation, result.value));
    } catch {
      return fail(res, operation, "validation", 400, "Derived customization request is invalid.");
    }
  });

  mutation("post", "/api/asset-authoring/workspaces/:workspaceId/derived-customizations", API_ASSET_DERIVED_CUSTOMIZATION_CREATE_OPERATION, (service, command) => service.create(command as never));
  mutation("patch", "/api/asset-authoring/workspaces/:workspaceId/derived-customizations/:customizationId", API_ASSET_DERIVED_CUSTOMIZATION_UPDATE_OPERATION, (service, command) => service.update(command as never));
  mutation("post", "/api/asset-authoring/workspaces/:workspaceId/derived-customizations/:customizationId/review", API_ASSET_DERIVED_CUSTOMIZATION_REVIEW_OPERATION, (service, command) => service.review(command as never));
  mutation("post", "/api/asset-authoring/workspaces/:workspaceId/derived-customizations/:customizationId/publish", API_ASSET_DERIVED_CUSTOMIZATION_PUBLISH_OPERATION, (service, command) => service.publish(command as never));
  mutation("post", "/api/asset-authoring/workspaces/:workspaceId/derived-customizations/:customizationId/abandon", API_ASSET_DERIVED_CUSTOMIZATION_ABANDON_OPERATION, (service, command) => service.abandon(command as never));
}

function commandBody(req: Req, workspaceField: "workspaceId" | "targetWorkspaceId", workspaceId: string): Record<string, unknown> {
  const body = { ...(req.body ?? {}) };
  body[workspaceField] = workspaceId;
  for (const key of ["draftId", "overrideId", "authoredAssetId", "revisionId"]) {
    if (!body[key] && req.params?.[key]) body[key] = text(req.params[key]);
  }
  if (!body.initialEditableValues && body.editableFields) body.initialEditableValues = body.editableFields;
  if (!body.draftEditableValues && body.editableFields) body.draftEditableValues = body.editableFields;
  if (!body.draftEditablePatch && body.editableFieldsPatch) body.draftEditablePatch = body.editableFieldsPatch;
  return body;
}

function optionalText(value: unknown): string | undefined {
  const normalized = text(value);
  return normalized || undefined;
}

function actor(request: Req): string {
  return request.securityContext?.principal?.id?.trim() || "authenticated-user";
}
