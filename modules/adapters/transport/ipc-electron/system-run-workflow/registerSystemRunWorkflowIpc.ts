import type {
  SystemRunWorkflowRequestContext,
} from "../../../../application/ports/system-run-workflow";
import type { SystemRunWorkflowUseCases } from "../../../../application/use-cases/system-run-workflow";
import {
  DESKTOP_SYSTEM_RUN_WORKFLOW_CHANNELS,
  createIpcError,
  createIpcFailureResponse,
  createIpcSuccessResponse,
} from "../../../../contracts/ipc";
import {
  normalizeSystemRunWorkflowSource,
  normalizeSystemRunWorkflowValues,
  type SystemRunWorkflowResult,
  type SystemRunWorkflowSource,
} from "../../../../contracts/system-run-workflow";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface RegisterSystemRunWorkflowIpcDependencies {
  readonly ipcMain: IpcMainHandlePort;
  readonly workflows: SystemRunWorkflowUseCases;
}

const LOCAL_CONTEXT: SystemRunWorkflowRequestContext = {
  actorId: "local-user",
  roles: ["owner", "editor", "viewer", "developer"],
  authenticated: true,
  organizationId: "local",
};

export function registerSystemRunWorkflowIpc(
  d: RegisterSystemRunWorkflowIpcDependencies,
): void {
  handle(d, "listProfiles", (payload) =>
    d.workflows.listProfiles.execute(
      {
        workspaceId: String(
          createWorkspaceId(required(payload.workspaceId)),
        ),
        ...(optional(payload.sourceKind)
          ? { sourceKind: sourceKind(payload.sourceKind) }
          : {}),
        ...(optional(payload.sourceId)
          ? { sourceId: optional(payload.sourceId)! }
          : {}),
      },
      LOCAL_CONTEXT,
    ),
  );
  handle(d, "prepare", (payload) =>
    d.workflows.prepare.execute(
      {
        workspaceId: String(
          createWorkspaceId(required(payload.workspaceId)),
        ),
        profileId: required(payload.profileId),
        source: normalizeSystemRunWorkflowSource(
          record(payload.source) as unknown as SystemRunWorkflowSource,
        ),
      },
      LOCAL_CONTEXT,
    ),
  );
  handle(d, "invoke", (payload) =>
    d.workflows.invoke.execute(
      {
        workspaceId: String(
          createWorkspaceId(required(payload.workspaceId)),
        ),
        profileId: required(payload.profileId),
        source: normalizeSystemRunWorkflowSource(
          record(payload.source) as unknown as SystemRunWorkflowSource,
        ),
        actionId: required(payload.actionId),
        operationId: required(payload.operationId),
        ...(optional(payload.expectedSnapshotRevision)
          ? {
              expectedSnapshotRevision: optional(
                payload.expectedSnapshotRevision,
              )!,
            }
          : {}),
        values: normalizeSystemRunWorkflowValues(record(payload.values)),
      },
      LOCAL_CONTEXT,
    ),
  );
}

function handle(
  d: RegisterSystemRunWorkflowIpcDependencies,
  operation: keyof typeof DESKTOP_SYSTEM_RUN_WORKFLOW_CHANNELS,
  run: (
    payload: Record<string, unknown>,
  ) => Promise<SystemRunWorkflowResult<unknown>>,
): void {
  const channels = DESKTOP_SYSTEM_RUN_WORKFLOW_CHANNELS[operation];
  d.ipcMain.handle(channels.request.value, async (_event, request: unknown) => {
    const envelope = request as {
      requestId?: string;
      correlationId?: string;
      payload?: unknown;
    };
    const responseContext = {
      requestId: envelope?.requestId,
      correlationId: envelope?.correlationId,
    };
    try {
      const result = await run(record(envelope?.payload));
      if (result.ok)
        return createIpcSuccessResponse(
          channels.response as never,
          result.value,
          responseContext,
        );
      const kind = result.error.code.includes("unauthorized")
        ? "forbidden"
        : result.error.code.includes("not-found")
          ? "not-found"
          : result.error.code.includes("conflict") ||
              result.error.code.includes("stale")
            ? "conflict"
            : "validation";
      return createIpcFailureResponse(
        createIpcError(
          channels.response as never,
          kind,
          result.error.message,
          {
            ...responseContext,
            ...(result.error.field
              ? { details: { field: result.error.field } }
              : {}),
          },
        ) as never,
        responseContext,
      );
    } catch {
      return createIpcFailureResponse(
        createIpcError(
          channels.response as never,
          "validation",
          "The system run workflow request is invalid.",
          responseContext,
        ) as never,
        responseContext,
      );
    }
  });
}

const sourceKind = (
  value: unknown,
): "approved-release" | "reviewed-execution-plan" => {
  const parsed = required(value);
  if (
    parsed !== "approved-release" &&
    parsed !== "reviewed-execution-plan"
  )
    throw new Error("Source kind is invalid.");
  return parsed;
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object.");
  return value as Record<string, unknown>;
};
const required = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim())
    throw new Error("A required value is missing.");
  return value.trim();
};
const optional = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
