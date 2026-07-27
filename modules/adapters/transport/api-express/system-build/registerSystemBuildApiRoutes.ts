import type { Request } from "express";
import type { ApproveSystemReleaseUseCase, CancelSystemBuildUseCase, CompareSystemReleasesUseCase, ListSystemBuildsUseCase, ListSystemReleasesUseCase, ReadSystemBuildUseCase, ReadSystemReleaseUseCase, RequestSystemBuildUseCase } from "../../../../application/use-cases/system-build";
import { API_SYSTEM_BUILD_OPERATIONS, createApiError, createApiFailureResponse, createApiSuccessResponse } from "../../../../contracts/api";
import { normalizeAssetImplementationDeploymentProfile, normalizeAssetImplementationTrustLevel } from "../../../../contracts/asset-implementation";
import { normalizeSystemBuildId, normalizeSystemReleaseId } from "../../../../contracts/system-build";
import { normalizeSystemBuilderRevisionId, normalizeSystemBuilderSystemId } from "../../../../contracts/system-builder";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { requireExpressAuthenticatedPrincipalId } from "../security/expressAuthContext";

interface RequestLike { body?: unknown; query?: Record<string, unknown> }
interface ResponseLike { status(code: number): ResponseLike; json(body: unknown): void }
export interface SystemBuildExpressPort { get(path: string, handler: (request: RequestLike, response: ResponseLike) => Promise<void>): void; post(path: string, handler: (request: RequestLike, response: ResponseLike) => Promise<void>): void; }
export interface RegisterSystemBuildApiRoutesDependencies {
  app: SystemBuildExpressPort;
  request: Pick<RequestSystemBuildUseCase, "execute">; cancel: Pick<CancelSystemBuildUseCase, "execute">;
  read: Pick<ReadSystemBuildUseCase, "execute">; list: Pick<ListSystemBuildsUseCase, "execute">;
  approve: Pick<ApproveSystemReleaseUseCase, "execute">; readRelease: Pick<ReadSystemReleaseUseCase, "execute">;
  listReleases: Pick<ListSystemReleasesUseCase, "execute">; compareReleases: Pick<CompareSystemReleasesUseCase, "execute">;
}

export function registerSystemBuildApiRoutes(d: RegisterSystemBuildApiRoutesDependencies): void {
  d.app.post("/api/systems/builds/request", async (req, res) => runResult(req, res, "request", d.request, parseRequest));
  d.app.post("/api/systems/builds/cancel", async (req, res) => runResult(req, res, "cancel", d.cancel, (body, actorId) => ({ workspaceId: createWorkspaceId(required(body.workspaceId)), buildId: normalizeSystemBuildId(required(body.buildId)), actorId })));
  d.app.get("/api/systems/build", async (req, res) => runResult(req, res, "read", d.read, () => ({ workspaceId: createWorkspaceId(required(req.query?.workspaceId)), buildId: normalizeSystemBuildId(required(req.query?.buildId)) })));
  d.app.get("/api/systems/builds", async (req, res) => runList(req, res, "list", () => d.list.execute({ workspaceId: createWorkspaceId(required(req.query?.workspaceId)), ...(req.query?.systemId ? { systemId: normalizeSystemBuilderSystemId(required(req.query.systemId)) } : {}) })));
  d.app.post("/api/systems/releases/approve", async (req, res) => runResult(req, res, "approve", d.approve, (body, actorId) => ({ workspaceId: createWorkspaceId(required(body.workspaceId)), buildId: normalizeSystemBuildId(required(body.buildId)), expectedLockDigest: required(body.expectedLockDigest), ...(body.releaseId ? { releaseId: normalizeSystemReleaseId(required(body.releaseId)) } : {}), actorId })));
  d.app.get("/api/systems/release", async (req, res) => runResult(req, res, "readRelease", d.readRelease, () => ({ workspaceId: createWorkspaceId(required(req.query?.workspaceId)), releaseId: normalizeSystemReleaseId(required(req.query?.releaseId)) })));
  d.app.get("/api/systems/releases", async (req, res) => runList(req, res, "listReleases", () => d.listReleases.execute({ workspaceId: createWorkspaceId(required(req.query?.workspaceId)), ...(req.query?.systemId ? { systemId: normalizeSystemBuilderSystemId(required(req.query.systemId)) } : {}) })));
  d.app.get("/api/systems/releases/compare", async (req, res) => runResult(req, res, "compareReleases", d.compareReleases, () => ({ workspaceId: createWorkspaceId(required(req.query?.workspaceId)), leftReleaseId: normalizeSystemReleaseId(required(req.query?.leftReleaseId)), rightReleaseId: normalizeSystemReleaseId(required(req.query?.rightReleaseId)) })));
}

function parseRequest(body: Record<string, unknown>, actorId: string) {
  return {
    buildId: normalizeSystemBuildId(required(body.buildId)),
    workspaceId: createWorkspaceId(required(body.workspaceId)),
    systemId: normalizeSystemBuilderSystemId(required(body.systemId)),
    systemRevisionId: normalizeSystemBuilderRevisionId(required(body.systemRevisionId)),
    deploymentProfile: normalizeAssetImplementationDeploymentProfile(required(body.deploymentProfile)),
    permittedTrustLevels: array(body.permittedTrustLevels).map((item) => normalizeAssetImplementationTrustLevel(required(item))),
    availableCapabilities: array(body.availableCapabilities).map(required),
    hostApiVersion: required(body.hostApiVersion),
    ...(optional(body.runtimeAbiVersion) ? { runtimeAbiVersion: optional(body.runtimeAbiVersion) } : {}),
    toolchainProfile: required(body.toolchainProfile),
    actorId,
  };
}
async function runResult(req: RequestLike, res: ResponseLike, operation: keyof typeof API_SYSTEM_BUILD_OPERATIONS, useCase: { execute(value: never): Promise<unknown> }, parse: (body: Record<string, unknown>, actorId: string) => unknown): Promise<void> {
  try { const value = await useCase.execute(parse(record(req.body ?? {}), actor(req)) as never) as { ok: boolean; value?: unknown; error?: { code: string; message: string } }; value.ok ? success(res, operation, value.value) : failure(res, operation, value.error?.code ?? "validation", value.error?.message ?? "The request failed."); }
  catch { invalid(res, operation); }
}
async function runList(_req: RequestLike, res: ResponseLike, operation: keyof typeof API_SYSTEM_BUILD_OPERATIONS, execute: () => Promise<unknown>): Promise<void> { try { success(res, operation, await execute()); } catch { invalid(res, operation); } }
function success(res: ResponseLike, operation: keyof typeof API_SYSTEM_BUILD_OPERATIONS, value: unknown): void { res.status(200).json(createApiSuccessResponse(API_SYSTEM_BUILD_OPERATIONS[operation], value)); }
function invalid(res: ResponseLike, operation: keyof typeof API_SYSTEM_BUILD_OPERATIONS): void { failure(res, operation, "validation", "The system build request is invalid."); }
function failure(res: ResponseLike, operation: keyof typeof API_SYSTEM_BUILD_OPERATIONS, code: string, message: string): void { const kind = code.includes("not-found") ? "not-found" : code.includes("conflict") ? "conflict" : "validation"; res.status(kind === "not-found" ? 404 : kind === "conflict" ? 409 : 400).json(createApiFailureResponse(createApiError(API_SYSTEM_BUILD_OPERATIONS[operation], kind, message))); }
const actor = (request: RequestLike) => requireExpressAuthenticatedPrincipalId(request as Request);
const record = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; };
const required = (value: unknown): string => { if (typeof value !== "string" || !value.trim()) throw new Error(); return value.trim(); };
const optional = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const array = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];
