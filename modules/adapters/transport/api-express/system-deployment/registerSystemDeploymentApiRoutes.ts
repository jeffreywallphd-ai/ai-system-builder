import type { Request } from "express";
import type {
  ActivateSystemDeploymentUseCase,
  CancelSystemDeploymentRunUseCase,
  InstallSystemDeploymentUseCase,
  ListSystemDeploymentAuditUseCase,
  ListSystemDeploymentRunsUseCase,
  ListSystemDeploymentsUseCase,
  ReadSystemDeploymentUseCase,
  ReconcileSystemDeploymentHealthUseCase,
  RevokeSystemDeploymentUseCase,
  RollbackSystemDeploymentUseCase,
  StartSystemDeploymentRunUseCase,
  InvokeSystemPublishedLifecycleUseCase,
  ReadSystemPublishedLifecycleUseCase,
} from "../../../../application/use-cases/system-deployment";
import {
  API_SYSTEM_DEPLOYMENT_OPERATIONS,
  createApiError,
  createApiFailureResponse,
  createApiSuccessResponse,
} from "../../../../contracts/api";
import {
  normalizeAssetImplementationDeploymentProfile,
  type AssetImplementationDeploymentProfile,
} from "../../../../contracts/asset-implementation";
import type { SystemDeploymentCapabilityPolicy } from "../../../../contracts/system-deployment";
import {
  normalizeSystemDeploymentId,
  normalizeSystemDeploymentRunId,
} from "../../../../contracts/system-deployment";
import { normalizeSystemReleaseId } from "../../../../contracts/system-build";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { getExpressAuthContext } from "../security/expressAuthContext";
import { getExpressOrganizationContext } from "../security/expressOrganizationContext";

interface RequestLike {
  body?: unknown;
  query?: Record<string, unknown>;
}
interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}
export interface SystemDeploymentExpressPort {
  get(
    path: string,
    handler: (request: RequestLike, response: ResponseLike) => Promise<void>,
  ): void;
  post(
    path: string,
    handler: (request: RequestLike, response: ResponseLike) => Promise<void>,
  ): void;
}

export interface SystemDeploymentHostContext {
  readonly deploymentProfiles: readonly AssetImplementationDeploymentProfile[];
  readonly hostApiVersion: string;
  readonly runtimeAbiVersion?: string;
  readonly capabilities: readonly string[];
  readonly sandboxQualified: boolean;
}

export interface RegisterSystemDeploymentApiRoutesDependencies {
  readonly app: SystemDeploymentExpressPort;
  readonly host: SystemDeploymentHostContext;
  readonly lifecycleRead?: Pick<ReadSystemPublishedLifecycleUseCase, "execute">;
  readonly lifecycleInvoke?: Pick<InvokeSystemPublishedLifecycleUseCase, "execute">;
  readonly install: Pick<InstallSystemDeploymentUseCase, "execute">;
  readonly activate: Pick<ActivateSystemDeploymentUseCase, "execute">;
  readonly health: Pick<ReconcileSystemDeploymentHealthUseCase, "execute">;
  readonly rollback: Pick<RollbackSystemDeploymentUseCase, "execute">;
  readonly revoke: Pick<RevokeSystemDeploymentUseCase, "execute">;
  readonly read: Pick<ReadSystemDeploymentUseCase, "execute">;
  readonly list: Pick<ListSystemDeploymentsUseCase, "execute">;
  readonly startRun: Pick<StartSystemDeploymentRunUseCase, "execute">;
  readonly cancelRun: Pick<CancelSystemDeploymentRunUseCase, "execute">;
  readonly listRuns: Pick<ListSystemDeploymentRunsUseCase, "execute">;
  readonly listAudit: Pick<ListSystemDeploymentAuditUseCase, "execute">;
}

export function registerSystemDeploymentApiRoutes(
  d: RegisterSystemDeploymentApiRoutesDependencies,
): void {
  if (d.lifecycleRead && d.lifecycleInvoke) {
    d.app.get("/api/systems/published-lifecycle", (req, res) =>
      runResult(req, res, "lifecycleRead", d.lifecycleRead!, (_body, context) => ({
        ...context,
        releaseId: normalizeSystemReleaseId(required(req.query?.releaseId)),
      })),
    );
    d.app.post("/api/systems/published-lifecycle/invoke", (req, res) =>
      runResult(req, res, "lifecycleInvoke", d.lifecycleInvoke!, (body, context) => ({
        ...context,
        releaseId: normalizeSystemReleaseId(required(body.releaseId)),
        action: lifecycleAction(body.action),
        expectedRevision: required(body.expectedRevision),
      })),
    );
  }
  d.app.post("/api/systems/deployments/install", (req, res) =>
    runResult(req, res, "install", d.install, (body, context) => {
      const deploymentProfile = normalizeAssetImplementationDeploymentProfile(
        required(body.deploymentProfile),
      );
      if (!d.host.deploymentProfiles.includes(deploymentProfile))
        throw new Error("Profile unavailable.");
      return {
        ...context,
        deploymentId: normalizeSystemDeploymentId(required(body.deploymentId)),
        releaseId: normalizeSystemReleaseId(required(body.releaseId)),
        deploymentProfile,
        hostApiVersion: d.host.hostApiVersion,
        ...(d.host.runtimeAbiVersion
          ? { runtimeAbiVersion: d.host.runtimeAbiVersion }
          : {}),
        hostCapabilities: d.host.capabilities,
        sandboxQualified: d.host.sandboxQualified,
        policy: parsePolicy(body.policy),
      };
    }),
  );
  for (const operation of [
    "activate",
    "health",
    "rollback",
    "revoke",
  ] as const) {
    d.app.post(`/api/systems/deployments/${operation}`, (req, res) =>
      runResult(req, res, operation, d[operation], (body, context) => ({
        ...context,
        deploymentId: normalizeSystemDeploymentId(required(body.deploymentId)),
      })),
    );
  }
  d.app.get("/api/systems/deployment", (req, res) =>
    runResult(req, res, "read", d.read, (_body, context) => ({
      ...context,
      deploymentId: normalizeSystemDeploymentId(
        required(req.query?.deploymentId),
      ),
    })),
  );
  d.app.get("/api/systems/deployments", (req, res) =>
    runResult(req, res, "list", d.list, (_body, context) => ({
      ...context,
      ...(optional(req.query?.releaseId)
        ? {
            releaseId: normalizeSystemReleaseId(
              optional(req.query?.releaseId)!,
            ),
          }
        : {}),
    })),
  );
  d.app.post("/api/systems/deployments/runs/start", (req, res) =>
    runResult(req, res, "startRun", d.startRun, (body, context) => ({
      ...context,
      deploymentId: normalizeSystemDeploymentId(required(body.deploymentId)),
      runId: normalizeSystemDeploymentRunId(required(body.runId)),
      requestedCapabilities: strings(body.requestedCapabilities, 64),
      requestedSecretReferences: strings(body.requestedSecretReferences, 32),
      requestedEgressOrigins: strings(body.requestedEgressOrigins, 32),
    })),
  );
  d.app.post("/api/systems/deployments/runs/cancel", (req, res) =>
    runResult(req, res, "cancelRun", d.cancelRun, (body, context) => ({
      ...context,
      runId: normalizeSystemDeploymentRunId(required(body.runId)),
    })),
  );
  d.app.get("/api/systems/deployments/runs", (req, res) =>
    runResult(req, res, "listRuns", d.listRuns, (_body, context) => ({
      ...context,
      ...(optional(req.query?.deploymentId)
        ? {
            deploymentId: normalizeSystemDeploymentId(
              optional(req.query?.deploymentId)!,
            ),
          }
        : {}),
      ...(integer(req.query?.limit) !== undefined
        ? { limit: integer(req.query?.limit) }
        : {}),
    })),
  );
  d.app.get("/api/systems/deployments/audit", (req, res) =>
    runResult(req, res, "listAudit", d.listAudit, (_body, context) => ({
      ...context,
      deploymentId: normalizeSystemDeploymentId(
        required(req.query?.deploymentId),
      ),
      ...(integer(req.query?.limit) !== undefined
        ? { limit: integer(req.query?.limit) }
        : {}),
    })),
  );
}

async function runResult(
  req: RequestLike,
  res: ResponseLike,
  operation: keyof typeof API_SYSTEM_DEPLOYMENT_OPERATIONS,
  useCase: { execute(value: never): Promise<unknown> },
  parse: (
    body: Record<string, unknown>,
    context: ReturnType<typeof trustedContext>,
  ) => unknown,
): Promise<void> {
  try {
    const result = (await useCase.execute(
      parse(record(req.body ?? {}), trustedContext(req)) as never,
    )) as
      | {
          ok?: boolean;
          value?: unknown;
          error?: { code?: string; message?: string };
        }
      | readonly unknown[];
    if (
      !Array.isArray(result) &&
      result &&
      typeof result === "object" &&
      "ok" in result
    ) {
      result.ok
        ? success(res, operation, result.value)
        : failure(
            res,
            operation,
            result.error?.code ?? "validation",
            result.error?.message ?? "The deployment request failed.",
          );
    } else success(res, operation, result);
  } catch {
    failure(
      res,
      operation,
      "validation",
      "The system deployment request is invalid.",
    );
  }
}

function trustedContext(request: RequestLike) {
  const auth = getExpressAuthContext(request as Request);
  const organization = getExpressOrganizationContext(request as Request);
  if (!auth?.authenticated || !organization?.organizationId) throw new Error();
  return {
    organizationId: organization.organizationId,
    workspaceId: createWorkspaceId(
      required(
        record(request.body ?? {}).workspaceId ?? request.query?.workspaceId,
      ),
    ),
    actorId: auth.principal.principalId,
  };
}

function parsePolicy(value: unknown): SystemDeploymentCapabilityPolicy {
  const input = record(value);
  const egress = record(input.egress);
  const quotas = record(input.quotas);
  const mode = required(egress.mode);
  if (mode !== "deny-all" && mode !== "allowlist") throw new Error();
  return {
    allowedCapabilities: strings(input.allowedCapabilities, 64),
    allowedSecretReferences: strings(input.allowedSecretReferences, 32),
    egress: {
      mode,
      allowedOrigins: strings(egress.allowedOrigins, 32),
    },
    quotas: {
      maximumRunSeconds: requiredInteger(quotas.maximumRunSeconds),
      maximumMemoryMiB: requiredInteger(quotas.maximumMemoryMiB),
      maximumOutputBytes: requiredInteger(quotas.maximumOutputBytes),
      maximumConcurrentRuns: requiredInteger(quotas.maximumConcurrentRuns),
    },
  };
}

function success(
  res: ResponseLike,
  operation: keyof typeof API_SYSTEM_DEPLOYMENT_OPERATIONS,
  value: unknown,
) {
  res
    .status(200)
    .json(
      createApiSuccessResponse(
        API_SYSTEM_DEPLOYMENT_OPERATIONS[operation],
        value,
      ),
    );
}
function failure(
  res: ResponseLike,
  operation: keyof typeof API_SYSTEM_DEPLOYMENT_OPERATIONS,
  code: string,
  message: string,
) {
  const kind = code.includes("not-found")
    ? "not-found"
    : code.includes("conflict")
      ? "conflict"
      : code.includes("denied") || code.includes("widening")
        ? "forbidden"
        : "validation";
  res
    .status(
      kind === "not-found"
        ? 404
        : kind === "conflict"
          ? 409
          : kind === "forbidden"
            ? 403
            : 400,
    )
    .json(
      createApiFailureResponse(
        createApiError(
          API_SYSTEM_DEPLOYMENT_OPERATIONS[operation],
          kind,
          message,
        ),
      ),
    );
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error();
  return value as Record<string, unknown>;
};
const required = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) throw new Error();
  return value.trim();
};
const optional = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const strings = (value: unknown, maximum: number) => {
  if (!Array.isArray(value) || value.length > maximum) throw new Error();
  return value.map(required);
};
const requiredInteger = (value: unknown) => {
  if (!Number.isInteger(value)) throw new Error();
  return Number(value);
};
const integer = (value: unknown) =>
  value === undefined ? undefined : requiredInteger(Number(value));
const lifecycleAction = (value: unknown) => {
  const action = required(value);
  if (!["install", "activate", "deactivate", "start", "stop", "uninstall"].includes(action))
    throw new Error();
  return action as "install" | "activate" | "deactivate" | "start" | "stop" | "uninstall";
};
