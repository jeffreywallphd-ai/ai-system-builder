import { join, resolve } from "node:path";

import { type WorkspaceId, isWorkspaceId } from "../../../contracts/workspace";
import { LocalWorkspacePersistenceError } from "./localWorkspacePersistenceErrors";

const WORKSPACES_DIRECTORY = "workspaces";

export function resolveWorkspaceIndexFile(rootDirectory: string): string {
  return join(resolve(rootDirectory), WORKSPACES_DIRECTORY, "index.json");
}

export function resolveActiveWorkspaceSelectionFile(rootDirectory: string): string {
  return join(resolve(rootDirectory), WORKSPACES_DIRECTORY, "active-workspace.json");
}

export function resolveWorkspaceRecordFile(rootDirectory: string, workspaceId: WorkspaceId): string {
  return join(resolveWorkspaceDirectory(rootDirectory, workspaceId), "workspace.json");
}

export function resolveWorkspaceSystemPackActivationsFile(rootDirectory: string, workspaceId: WorkspaceId): string {
  return join(resolveWorkspaceDirectory(rootDirectory, workspaceId), "activations", "system-packs.json");
}

export function resolveWorkspaceDirectory(rootDirectory: string, workspaceId: WorkspaceId): string {
  const safeWorkspaceId = assertSafeWorkspaceId(workspaceId);
  return join(resolve(rootDirectory), WORKSPACES_DIRECTORY, safeWorkspaceId);
}

function assertSafeWorkspaceId(workspaceId: WorkspaceId): WorkspaceId {
  if (!isWorkspaceId(workspaceId)) {
    throw new LocalWorkspacePersistenceError("workspace-persistence-invalid-record");
  }

  return workspaceId;
}
