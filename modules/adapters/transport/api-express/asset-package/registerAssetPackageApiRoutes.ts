import type { Request } from "express";
import type {
  ActivateAssetPackageUseCase,
  AdmitAssetPackageUseCase,
  DisableAssetPackageUseCase,
  InspectAssetPackageUseCase,
  ListAssetPackagesUseCase,
  RollbackAssetPackageUseCase,
} from "../../../../application/use-cases/asset-package";
import { API_ASSET_PACKAGE_OPERATIONS, createApiError, createApiFailureResponse, createApiSuccessResponse } from "../../../../contracts/api";
import { normalizeSha256Digest } from "../../../../contracts/asset-implementation";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { requireExpressAuthenticatedPrincipalId } from "../security/expressAuthContext";

interface RequestLike {
  body?: unknown;
  query?: Record<string, unknown>;
}
interface ResponseLike { status(code: number): ResponseLike; json(body: unknown): void }
export interface AssetPackageExpressPort {
  get(path: string, handler: (request: RequestLike, response: ResponseLike) => Promise<void>): void;
  post(path: string, handler: (request: RequestLike, response: ResponseLike) => Promise<void>): void;
}
export interface RegisterAssetPackageApiRoutesDependencies {
  app: AssetPackageExpressPort;
  inspect: Pick<InspectAssetPackageUseCase, "execute">;
  admit: Pick<AdmitAssetPackageUseCase, "execute">;
  list: Pick<ListAssetPackagesUseCase, "execute">;
  activate: Pick<ActivateAssetPackageUseCase, "execute">;
  disable: Pick<DisableAssetPackageUseCase, "execute">;
  rollback: Pick<RollbackAssetPackageUseCase, "execute">;
}

export function registerAssetPackageApiRoutes(d: RegisterAssetPackageApiRoutesDependencies): void {
  d.app.get("/api/asset-packages", async (req, res) => {
    try {
      const workspaceId = requiredWorkspace(req.query?.workspaceId);
      res.status(200).json(createApiSuccessResponse(API_ASSET_PACKAGE_OPERATIONS.list, await d.list.execute(workspaceId)));
    } catch { failure(res, "list", "validation", "workspaceId is required."); }
  });
  d.app.post("/api/asset-packages/inspect", async (req, res) => {
    try {
      const body = record(req.body);
      const workspaceId = requiredWorkspace(body.workspaceId);
      if (typeof body.contentBase64 !== "string" || body.contentBase64.length > 45_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.contentBase64)) throw new Error();
      result(res, "inspect", await d.inspect.execute({ workspaceId, bytes: Buffer.from(body.contentBase64, "base64"), actorId: actor(req) }));
    } catch { failure(res, "inspect", "validation", "Package inspection request is invalid."); }
  });
  d.app.post("/api/asset-packages/admit", async (req, res) => {
    try {
      const body = record(req.body);
      result(res, "admit", await d.admit.execute({
        workspaceId: requiredWorkspace(body.workspaceId),
        inspectionId: required(body.inspectionId),
        packageDigest: normalizeSha256Digest(required(body.packageDigest)),
        approvalScope: body.approvalScope === "organization" ? "organization" : "workspace",
        approvedCapabilities: strings(body.approvedCapabilities),
        actorId: actor(req),
      }));
    } catch { failure(res, "admit", "validation", "Package admission request is invalid."); }
  });
  for (const operation of ["activate", "disable", "rollback"] as const) {
    d.app.post(`/api/asset-packages/${operation}`, async (req, res) => {
      try {
        const body = record(req.body);
        result(res, operation, await d[operation].execute({ workspaceId: requiredWorkspace(body.workspaceId), recordId: required(body.recordId), actorId: actor(req) }));
      } catch { failure(res, operation, "validation", `Package ${operation} request is invalid.`); }
    });
  }
}

function result(res: ResponseLike, operation: keyof typeof API_ASSET_PACKAGE_OPERATIONS, value: any): void {
  if (value.ok) res.status(200).json(createApiSuccessResponse(API_ASSET_PACKAGE_OPERATIONS[operation], value.value));
  else failure(res, operation, value.error.code === "package-not-found" ? "not-found" : "conflict", value.error.message);
}
function failure(res: ResponseLike, operation: keyof typeof API_ASSET_PACKAGE_OPERATIONS, code: "validation" | "conflict" | "not-found", message: string): void {
  res.status(code === "validation" ? 400 : code === "not-found" ? 404 : 409).json(createApiFailureResponse(createApiError(API_ASSET_PACKAGE_OPERATIONS[operation], code, message)));
}
const record = (value: unknown): Record<string, unknown> => { if (typeof value !== "object" || !value || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; };
const required = (value: unknown): string => { if (typeof value !== "string" || !value.trim()) throw new Error(); return value.trim(); };
const requiredWorkspace = (value: unknown) => createWorkspaceId(required(value));
const strings = (value: unknown): readonly string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean) : [];
const actor = (request: RequestLike) => requireExpressAuthenticatedPrincipalId(request as Request);
