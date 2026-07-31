import type { WorkspaceRepository, WorkspaceSelectionRepository } from "../../../../application/ports/workspace";
import type { CreateWorkspaceUseCase } from "../../../../application/use-cases/workspace";
import { createWorkspaceId, type ActiveWorkspaceSelection } from "../../../../contracts/workspace";
import {
  DESKTOP_WORKSPACE_CREATE_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_CREATE_RESPONSE_CHANNEL,
  DESKTOP_WORKSPACE_LIST_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_LIST_RESPONSE_CHANNEL,
  DESKTOP_WORKSPACE_SELECTION_CLEAR_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_SELECTION_CLEAR_RESPONSE_CHANNEL,
  DESKTOP_WORKSPACE_SELECTION_READ_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_SELECTION_READ_RESPONSE_CHANNEL,
  DESKTOP_WORKSPACE_SELECTION_SAVE_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_SELECTION_SAVE_RESPONSE_CHANNEL,
  createDesktopWorkspaceCreateSuccessResponse,
  createDesktopWorkspaceFailureResponse,
  createDesktopWorkspaceListSuccessResponse,
  createDesktopWorkspaceSelectionClearSuccessResponse,
  createDesktopWorkspaceSelectionReadSuccessResponse,
  createDesktopWorkspaceSelectionSaveSuccessResponse,
  type DesktopWorkspaceCreateRequest,
  type DesktopWorkspaceListRequest,
  type DesktopWorkspaceSelectionClearRequest,
  type DesktopWorkspaceSelectionReadRequest,
  type DesktopWorkspaceSelectionSaveRequest,
} from "../../../../contracts/ipc";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface RegisterWorkspaceIpcDependencies {
  readonly ipcMain: IpcMainHandlePort;
  readonly workspaceRepository: WorkspaceRepository;
  readonly workspaceSelectionRepository: WorkspaceSelectionRepository;
  readonly createWorkspaceUseCase: CreateWorkspaceUseCase;
}

export function registerWorkspaceIpc(dependencies: RegisterWorkspaceIpcDependencies): void {
  dependencies.ipcMain.handle(
    DESKTOP_WORKSPACE_LIST_REQUEST_CHANNEL.value,
    async (_event, request: DesktopWorkspaceListRequest) => {
      const context = contextFrom(request);
      try {
        const workspaces = await dependencies.workspaceRepository.listWorkspaces();
        return createDesktopWorkspaceListSuccessResponse({
          workspaces: workspaces.filter((workspace) => request.payload.includeArchived || workspace.status !== "archived"),
        }, context);
      } catch {
        return createDesktopWorkspaceFailureResponse(
          DESKTOP_WORKSPACE_LIST_RESPONSE_CHANNEL,
          "internal",
          "Unable to list workspaces.",
          context,
        );
      }
    },
  );

  dependencies.ipcMain.handle(
    DESKTOP_WORKSPACE_CREATE_REQUEST_CHANNEL.value,
    async (_event, request: DesktopWorkspaceCreateRequest) => {
      const context = contextFrom(request);
      try {
        const result = await dependencies.createWorkspaceUseCase.execute({
          command: request.payload.command,
          selectAfterCreate: request.payload.selectAfterCreate === true,
        });

        if (result.status !== "created" || !result.workspace) {
          return createDesktopWorkspaceFailureResponse(
            DESKTOP_WORKSPACE_CREATE_RESPONSE_CHANNEL,
            "validation",
            result.issues[0]?.message ?? "Workspace could not be created.",
            context,
          );
        }

        return createDesktopWorkspaceCreateSuccessResponse({
          workspace: result.workspace,
          activeSelection: result.activeSelection,
          systemPackActivations: result.systemPackActivations,
        }, context);
      } catch {
        return createDesktopWorkspaceFailureResponse(
          DESKTOP_WORKSPACE_CREATE_RESPONSE_CHANNEL,
          "internal",
          "Workspace could not be created.",
          context,
        );
      }
    },
  );

  dependencies.ipcMain.handle(
    DESKTOP_WORKSPACE_SELECTION_READ_REQUEST_CHANNEL.value,
    async (_event, request: DesktopWorkspaceSelectionReadRequest) => {
      const context = contextFrom(request);
      try {
        return createDesktopWorkspaceSelectionReadSuccessResponse(
          await dependencies.workspaceSelectionRepository.readActiveWorkspaceSelection(),
          context,
        );
      } catch {
        return createDesktopWorkspaceFailureResponse(
          DESKTOP_WORKSPACE_SELECTION_READ_RESPONSE_CHANNEL,
          "internal",
          "Unable to read active workspace selection.",
          context,
        );
      }
    },
  );

  dependencies.ipcMain.handle(
    DESKTOP_WORKSPACE_SELECTION_SAVE_REQUEST_CHANNEL.value,
    async (_event, request: DesktopWorkspaceSelectionSaveRequest) => {
      const context = contextFrom(request);
      try {
        const selection = sanitizeSelection(request.payload.selection);
        if (selection.workspaceId) {
          const workspace = await dependencies.workspaceRepository.readWorkspace(selection.workspaceId);
          if (!workspace || workspace.status !== "active") {
            return createDesktopWorkspaceFailureResponse(
              DESKTOP_WORKSPACE_SELECTION_SAVE_RESPONSE_CHANNEL,
              "not-found",
              "Workspace is not available for selection.",
              context,
            );
          }
        }

        await dependencies.workspaceSelectionRepository.saveActiveWorkspaceSelection(selection);
        return createDesktopWorkspaceSelectionSaveSuccessResponse(selection, context);
      } catch {
        return createDesktopWorkspaceFailureResponse(
          DESKTOP_WORKSPACE_SELECTION_SAVE_RESPONSE_CHANNEL,
          "validation",
          "Unable to save active workspace selection.",
          context,
        );
      }
    },
  );

  dependencies.ipcMain.handle(
    DESKTOP_WORKSPACE_SELECTION_CLEAR_REQUEST_CHANNEL.value,
    async (_event, request: DesktopWorkspaceSelectionClearRequest) => {
      const context = contextFrom(request);
      try {
        await dependencies.workspaceSelectionRepository.clearActiveWorkspaceSelection();
        return createDesktopWorkspaceSelectionClearSuccessResponse({}, context);
      } catch {
        return createDesktopWorkspaceFailureResponse(
          DESKTOP_WORKSPACE_SELECTION_CLEAR_RESPONSE_CHANNEL,
          "internal",
          "Unable to clear active workspace selection.",
          context,
        );
      }
    },
  );
}

function sanitizeSelection(selection: ActiveWorkspaceSelection): ActiveWorkspaceSelection {
  return selection.workspaceId
    ? { workspaceId: createWorkspaceId(selection.workspaceId), selectedAt: selection.selectedAt ?? new Date().toISOString() }
    : {};
}

function contextFrom(request: { readonly requestId?: string; readonly correlationId?: string } | undefined) {
  return {
    requestId: request?.requestId,
    correlationId: request?.correlationId,
  };
}
