import type { RegisterSystemDeploymentApiRoutesDependencies } from "../../api-express/system-deployment";
import {
  DESKTOP_SYSTEM_DEPLOYMENT_CHANNELS,
  createIpcError,
  createIpcFailureResponse,
  createIpcSuccessResponse,
} from "../../../../contracts/ipc";
import { normalizeAssetImplementationDeploymentProfile } from "../../../../contracts/asset-implementation";
import type { OrganizationId } from "../../../../contracts/organization";
import type { SystemDeploymentCapabilityPolicy } from "../../../../contracts/system-deployment";
import {
  normalizeSystemDeploymentId,
  normalizeSystemDeploymentRunId,
} from "../../../../contracts/system-deployment";
import { normalizeSystemReleaseId } from "../../../../contracts/system-build";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface RegisterSystemDeploymentIpcDependencies extends Omit<
  RegisterSystemDeploymentApiRoutesDependencies,
  "app"
> {
  readonly ipcMain: IpcMainHandlePort;
  readonly authority: {
    readonly organizationId: OrganizationId;
    readonly actorId: string;
  };
}

export function registerSystemDeploymentIpc(
  d: RegisterSystemDeploymentIpcDependencies,
): void {
  if (d.lifecycleRead && d.lifecycleInvoke) {
    handle(d, "lifecycleRead", (payload) =>
      d.lifecycleRead!.execute({
        ...context(d, payload),
        releaseId: normalizeSystemReleaseId(required(payload.releaseId)),
      }),
    );
    handle(d, "lifecycleInvoke", (payload) =>
      d.lifecycleInvoke!.execute({
        ...context(d, payload),
        releaseId: normalizeSystemReleaseId(required(payload.releaseId)),
        action: lifecycleAction(payload.action),
        expectedRevision: required(payload.expectedRevision),
      }),
    );
  }
  handle(d, "install", async (payload) => {
    const profile = normalizeAssetImplementationDeploymentProfile(
      required(payload.deploymentProfile),
    );
    if (!d.host.deploymentProfiles.includes(profile)) throw new Error();
    return d.install.execute({
      ...context(d, payload),
      deploymentId: normalizeSystemDeploymentId(required(payload.deploymentId)),
      releaseId: normalizeSystemReleaseId(required(payload.releaseId)),
      deploymentProfile: profile,
      hostApiVersion: d.host.hostApiVersion,
      ...(d.host.runtimeAbiVersion
        ? { runtimeAbiVersion: d.host.runtimeAbiVersion }
        : {}),
      hostCapabilities: d.host.capabilities,
      sandboxQualified: d.host.sandboxQualified,
      policy: parsePolicy(payload.policy),
    });
  });
  for (const operation of ["activate", "health", "rollback", "revoke"] as const)
    handle(d, operation, (payload) =>
      d[operation].execute({
        ...context(d, payload),
        deploymentId: normalizeSystemDeploymentId(
          required(payload.deploymentId),
        ),
      }),
    );
  handle(d, "read", (payload) =>
    d.read.execute({
      ...context(d, payload),
      deploymentId: normalizeSystemDeploymentId(required(payload.deploymentId)),
    }),
  );
  handle(d, "list", (payload) =>
    d.list.execute({
      ...context(d, payload),
      ...(optional(payload.releaseId)
        ? { releaseId: normalizeSystemReleaseId(optional(payload.releaseId)!) }
        : {}),
    }),
  );
  handle(d, "startRun", (payload) =>
    d.startRun.execute({
      ...context(d, payload),
      deploymentId: normalizeSystemDeploymentId(required(payload.deploymentId)),
      runId: normalizeSystemDeploymentRunId(required(payload.runId)),
      requestedCapabilities: strings(payload.requestedCapabilities, 64),
      requestedSecretReferences: strings(payload.requestedSecretReferences, 32),
      requestedEgressOrigins: strings(payload.requestedEgressOrigins, 32),
    }),
  );
  handle(d, "cancelRun", (payload) =>
    d.cancelRun.execute({
      ...context(d, payload),
      runId: normalizeSystemDeploymentRunId(required(payload.runId)),
    }),
  );
  handle(d, "listRuns", (payload) =>
    d.listRuns.execute({
      ...context(d, payload),
      ...(optional(payload.deploymentId)
        ? {
            deploymentId: normalizeSystemDeploymentId(
              optional(payload.deploymentId)!,
            ),
          }
        : {}),
      ...(integer(payload.limit) !== undefined
        ? { limit: integer(payload.limit) }
        : {}),
    }),
  );
  handle(d, "listAudit", (payload) =>
    d.listAudit.execute({
      ...context(d, payload),
      deploymentId: normalizeSystemDeploymentId(required(payload.deploymentId)),
      ...(integer(payload.limit) !== undefined
        ? { limit: integer(payload.limit) }
        : {}),
    }),
  );
}

function handle(
  d: RegisterSystemDeploymentIpcDependencies,
  operation: keyof typeof DESKTOP_SYSTEM_DEPLOYMENT_CHANNELS,
  run: (payload: Record<string, unknown>) => Promise<unknown>,
): void {
  const channels = DESKTOP_SYSTEM_DEPLOYMENT_CHANNELS[operation];
  d.ipcMain.handle(channels.request.value, async (_event, request: unknown) => {
    const envelope = request as {
      requestId?: string;
      correlationId?: string;
      payload?: unknown;
    };
    const requestContext = {
      requestId: envelope?.requestId,
      correlationId: envelope?.correlationId,
    };
    try {
      const result = (await run(record(envelope?.payload))) as {
        ok?: boolean;
        value?: unknown;
        error?: { code?: string; message?: string };
      };
      if (result && typeof result === "object" && "ok" in result)
        return result.ok
          ? createIpcSuccessResponse(
              channels.response as never,
              result.value,
              requestContext,
            )
          : createIpcFailureResponse(
              createIpcError(
                channels.response as never,
                result.error?.code?.includes("not-found")
                  ? "not-found"
                  : result.error?.code?.includes("conflict")
                    ? "conflict"
                    : result.error?.code?.includes("denied") ||
                        result.error?.code?.includes("widening")
                      ? "forbidden"
                      : "validation",
                result.error?.message ?? "The deployment request failed.",
                requestContext,
              ) as never,
              requestContext,
            );
      return createIpcSuccessResponse(
        channels.response as never,
        result,
        requestContext,
      );
    } catch {
      return createIpcFailureResponse(
        createIpcError(
          channels.response as never,
          "validation",
          "System deployment request is invalid.",
          requestContext,
        ) as never,
        requestContext,
      );
    }
  });
}

function context(
  d: RegisterSystemDeploymentIpcDependencies,
  payload: Record<string, unknown>,
) {
  return {
    organizationId: d.authority.organizationId,
    workspaceId: createWorkspaceId(required(payload.workspaceId)),
    actorId: required(d.authority.actorId),
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
    egress: { mode, allowedOrigins: strings(egress.allowedOrigins, 32) },
    quotas: {
      maximumRunSeconds: requiredInteger(quotas.maximumRunSeconds),
      maximumMemoryMiB: requiredInteger(quotas.maximumMemoryMiB),
      maximumOutputBytes: requiredInteger(quotas.maximumOutputBytes),
      maximumConcurrentRuns: requiredInteger(quotas.maximumConcurrentRuns),
    },
  };
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
