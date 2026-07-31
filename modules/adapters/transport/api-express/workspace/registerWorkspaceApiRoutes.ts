import type { WorkspaceRepository, WorkspaceSelectionRepository } from "../../../../application/ports/workspace";
import type { CreateWorkspaceUseCase } from "../../../../application/use-cases/workspace";
import type { Request } from "express";
import { getExpressOrganizationContext } from "../security";
import { createWorkspaceId, type ActiveWorkspaceSelection } from "../../../../contracts/workspace";
import {
  API_WORKSPACE_CREATE_OPERATION,
  API_WORKSPACE_LIST_OPERATION,
  API_WORKSPACE_SELECTION_CLEAR_OPERATION,
  API_WORKSPACE_SELECTION_READ_OPERATION,
  API_WORKSPACE_SELECTION_SAVE_OPERATION,
  createApiWorkspaceCreateSuccessResponse,
  createApiWorkspaceFailureResponse,
  createApiWorkspaceListSuccessResponse,
  createApiWorkspaceSelectionClearSuccessResponse,
  createApiWorkspaceSelectionReadSuccessResponse,
  createApiWorkspaceSelectionSaveSuccessResponse,
  type ApiWorkspaceCreatePayload,
  type ApiWorkspaceSelectionSavePayload,
} from "../../../../contracts/api";

interface ExpressRequestLike {
  readonly headers?: Record<string, string | string[] | undefined>;
  readonly body?: unknown;
  readonly query?: Record<string, unknown>;
}

interface ExpressResponseLike {
  readonly status: (code: number) => ExpressResponseLike;
  readonly json: (body: unknown) => void;
}

export interface ExpressWorkspaceRoutePort {
  readonly get: (path: string, handler: (request: ExpressRequestLike, response: ExpressResponseLike) => Promise<void>) => void;
  readonly post: (path: string, handler: (request: ExpressRequestLike, response: ExpressResponseLike) => Promise<void>) => void;
}

export interface RegisterWorkspaceApiRoutesDependencies {
  readonly app: ExpressWorkspaceRoutePort;
  readonly workspaceRepository: WorkspaceRepository;
  readonly workspaceSelectionRepository: WorkspaceSelectionRepository;
  readonly createWorkspaceUseCase: CreateWorkspaceUseCase;
}

export function registerWorkspaceApiRoutes(dependencies: RegisterWorkspaceApiRoutesDependencies): void {
  dependencies.app.get("/api/workspaces", async (request, response) => {
    const context = contextFrom(request);
    try {
      const includeArchived = request.query?.includeArchived === "true" || request.query?.includeArchived === true;
      const workspaces = await dependencies.workspaceRepository.listWorkspaces();
      response.status(200).json(createApiWorkspaceListSuccessResponse({
        workspaces: workspaces.filter((workspace) => includeArchived || workspace.status !== "archived"),
      }, context));
    } catch {
      response.status(500).json(createApiWorkspaceFailureResponse(
        API_WORKSPACE_LIST_OPERATION,
        "internal",
        "Unable to list workspaces.",
        context,
      ));
    }
  });

  dependencies.app.post("/api/workspaces", async (request, response) => {
    const context = contextFrom(request);
    try {
      const payload = requireCreatePayload(request.body);
      const result = await dependencies.createWorkspaceUseCase.execute({
        command: payload.command,
        ...(getExpressOrganizationContext(request as Request)?.organizationId
          ? { organizationId: getExpressOrganizationContext(request as Request)!.organizationId }
          : {}),
        selectAfterCreate: payload.selectAfterCreate === true,
      });

      if (result.status !== "created" || !result.workspace) {
        response.status(400).json(createApiWorkspaceFailureResponse(
          API_WORKSPACE_CREATE_OPERATION,
          "validation",
          result.issues[0]?.message ?? "Workspace could not be created.",
          context,
        ));
        return;
      }

      response.status(201).json(createApiWorkspaceCreateSuccessResponse({
        workspace: result.workspace,
        activeSelection: result.activeSelection,
        systemPackActivations: result.systemPackActivations,
      }, context));
    } catch {
      response.status(400).json(createApiWorkspaceFailureResponse(
        API_WORKSPACE_CREATE_OPERATION,
        "validation",
        "Workspace could not be created.",
        context,
      ));
    }
  });

  dependencies.app.get("/api/workspaces/active-selection", async (request, response) => {
    const context = contextFrom(request);
    try {
      response.status(200).json(createApiWorkspaceSelectionReadSuccessResponse(
        await dependencies.workspaceSelectionRepository.readActiveWorkspaceSelection(),
        context,
      ));
    } catch {
      response.status(500).json(createApiWorkspaceFailureResponse(
        API_WORKSPACE_SELECTION_READ_OPERATION,
        "internal",
        "Unable to read active workspace selection.",
        context,
      ));
    }
  });

  dependencies.app.post("/api/workspaces/active-selection", async (request, response) => {
    const context = contextFrom(request);
    try {
      const payload = request.body as ApiWorkspaceSelectionSavePayload;
      const selection = sanitizeSelection(payload.selection);
      if (selection.workspaceId) {
        const workspace = await dependencies.workspaceRepository.readWorkspace(selection.workspaceId);
        if (!workspace || workspace.status !== "active") {
          response.status(404).json(createApiWorkspaceFailureResponse(
            API_WORKSPACE_SELECTION_SAVE_OPERATION,
            "not-found",
            "Workspace is not available for selection.",
            context,
          ));
          return;
        }
      }

      await dependencies.workspaceSelectionRepository.saveActiveWorkspaceSelection(selection);
      response.status(200).json(createApiWorkspaceSelectionSaveSuccessResponse(selection, context));
    } catch {
      response.status(400).json(createApiWorkspaceFailureResponse(
        API_WORKSPACE_SELECTION_SAVE_OPERATION,
        "validation",
        "Unable to save active workspace selection.",
        context,
      ));
    }
  });

  dependencies.app.post("/api/workspaces/active-selection/clear", async (request, response) => {
    const context = contextFrom(request);
    try {
      await dependencies.workspaceSelectionRepository.clearActiveWorkspaceSelection();
      response.status(200).json(createApiWorkspaceSelectionClearSuccessResponse({}, context));
    } catch {
      response.status(500).json(createApiWorkspaceFailureResponse(
        API_WORKSPACE_SELECTION_CLEAR_OPERATION,
        "internal",
        "Unable to clear active workspace selection.",
        context,
      ));
    }
  });
}

function requireCreatePayload(value: unknown): ApiWorkspaceCreatePayload {
  const payload = value as ApiWorkspaceCreatePayload;
  if (!payload?.command || typeof payload.command.displayName !== "string") {
    throw new Error("Invalid workspace create payload.");
  }
  return payload;
}

function sanitizeSelection(selection: ActiveWorkspaceSelection): ActiveWorkspaceSelection {
  return selection?.workspaceId
    ? { workspaceId: createWorkspaceId(selection.workspaceId), selectedAt: selection.selectedAt ?? new Date().toISOString() }
    : {};
}

const getHeader = (headers: ExpressRequestLike["headers"], key: string) => {
  const value = headers?.[key] ?? headers?.[key.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

function contextFrom(request: ExpressRequestLike) {
  return {
    requestId: getHeader(request.headers, "x-request-id"),
    correlationId: getHeader(request.headers, "x-correlation-id"),
  };
}
