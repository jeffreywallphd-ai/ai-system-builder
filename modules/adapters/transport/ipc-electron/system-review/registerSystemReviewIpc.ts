import type { ReleaseBoundSystemReviewUseCases } from "../../../../application/use-cases/system-review";
import {
  DESKTOP_SYSTEM_REVIEW_CHANNELS,
  createIpcError,
  createIpcFailureResponse,
  createIpcSuccessResponse,
} from "../../../../contracts/ipc";
import type {
  SystemReviewPrincipal,
  SystemReviewResult,
} from "../../../../contracts/system-review";
import { normalizeSystemReleaseId } from "../../../../contracts/system-build";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface RegisterSystemReviewIpcDependencies {
  readonly ipcMain: IpcMainHandlePort;
  readonly runtime: Pick<
    ReleaseBoundSystemReviewUseCases,
    "describe" | "browse" | "detail" | "preview" | "listAudit"
  >;
}

const LOCAL_PRINCIPAL: SystemReviewPrincipal = {
  actorId: "local-user",
  roles: ["owner", "editor", "viewer", "developer"],
  authenticated: true,
};

export function registerSystemReviewIpc(
  dependencies: RegisterSystemReviewIpcDependencies,
): void {
  handle(dependencies, "describe", (payload) =>
    dependencies.runtime.describe(context(payload)),
  );
  handle(dependencies, "browse", (payload) =>
    dependencies.runtime.browse({
      ...context(payload),
      ...(optional(payload.nameQuery)
        ? { nameQuery: optional(payload.nameQuery) }
        : {}),
      ...(payload.limit !== undefined
        ? { limit: positiveInteger(payload.limit) }
        : {}),
    }),
  );
  handle(dependencies, "detail", (payload) =>
    dependencies.runtime.detail({
      ...context(payload),
      artifactRef: required(payload.artifactRef),
    }),
  );
  handle(dependencies, "preview", (payload) =>
    dependencies.runtime.preview({
      ...context(payload),
      artifactRef: required(payload.artifactRef),
    }),
  );
  handle(dependencies, "listAudit", (payload) =>
    dependencies.runtime.listAudit({
      ...context(payload),
      ...(payload.limit !== undefined
        ? { limit: positiveInteger(payload.limit) }
        : {}),
    }),
  );
}

function handle(
  dependencies: RegisterSystemReviewIpcDependencies,
  operation: keyof typeof DESKTOP_SYSTEM_REVIEW_CHANNELS,
  run: (
    payload: Record<string, unknown>,
  ) => Promise<SystemReviewResult<unknown>>,
): void {
  const channels = DESKTOP_SYSTEM_REVIEW_CHANNELS[operation];
  dependencies.ipcMain.handle(
    channels.request.value,
    async (_event, request: unknown) => {
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
        const kind = result.error.code.includes("forbidden")
          ? "forbidden"
          : result.error.code.includes("not-found")
            ? "not-found"
            : result.error.code.includes("unavailable") ||
                result.error.code.includes("audit")
              ? "unavailable"
              : "validation";
        return createIpcFailureResponse(
          createIpcError(
            channels.response as never,
            kind,
            result.error.message,
            responseContext,
          ) as never,
          responseContext,
        );
      } catch {
        return createIpcFailureResponse(
          createIpcError(
            channels.response as never,
            "validation",
            "The system review request is invalid.",
            responseContext,
          ) as never,
          responseContext,
        );
      }
    },
  );
}

function context(payload: Record<string, unknown>) {
  return {
    workspaceId: createWorkspaceId(required(payload.workspaceId)),
    releaseId: normalizeSystemReleaseId(required(payload.releaseId)),
    principal: LOCAL_PRINCIPAL,
  };
}

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
const positiveInteger = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new Error("Expected a positive integer.");
  return Number(value);
};
