import { rm } from "node:fs/promises";

import type { WorkspaceSelectionRepository } from "../../../application/ports/workspace";
import {
  type ActiveWorkspaceSelection,
  isWorkspaceId,
} from "../../../contracts/workspace";
import { LocalWorkspacePersistenceError } from "./localWorkspacePersistenceErrors";
import { cloneJson, readJsonDocument, writeJsonDocument } from "./localWorkspacePersistenceJson";
import { resolveActiveWorkspaceSelectionFile } from "./localWorkspacePersistencePaths";
import { resolveDocumentIdentity, type StructuredDocumentStore } from "../shared";
import { relative } from "node:path";

export interface LocalWorkspaceSelectionRepositoryOptions {
  readonly rootDirectory: string;
  readonly documents?: StructuredDocumentStore;
}

const EMPTY_SELECTION: ActiveWorkspaceSelection = {};

export function createLocalWorkspaceSelectionRepository(options: LocalWorkspaceSelectionRepositoryOptions): WorkspaceSelectionRepository {
  const selectionFile = resolveActiveWorkspaceSelectionFile(options.rootDirectory);
  const persistence = { rootDirectory: options.rootDirectory, documents: options.documents };

  return {
    async readActiveWorkspaceSelection(): Promise<ActiveWorkspaceSelection> {
      const value = await readJsonDocument<unknown>(selectionFile, EMPTY_SELECTION, "workspace-selection-persistence-read-failed", persistence);
      return normalizeSelection(value);
    },

    async saveActiveWorkspaceSelection(selection: ActiveWorkspaceSelection): Promise<void> {
      await writeJsonDocument(selectionFile, normalizeSelection(selection), "workspace-selection-persistence-write-failed", persistence);
    },

    async clearActiveWorkspaceSelection(): Promise<void> {
      if (options.documents) {
        const identity = resolveDocumentIdentity(relative(options.rootDirectory, selectionFile));
        await options.documents.deleteDocument(identity.namespace, identity.key);
        return;
      }
      try {
        await rm(selectionFile, { force: true });
      } catch (error) {
        throw new LocalWorkspacePersistenceError("workspace-selection-persistence-write-failed", { cause: error });
      }
    },
  };
}

function normalizeSelection(value: unknown): ActiveWorkspaceSelection {
  if (!value || typeof value !== "object") return EMPTY_SELECTION;
  const selection = value as Partial<ActiveWorkspaceSelection>;
  if (selection.workspaceId === undefined && selection.selectedAt === undefined) {
    return EMPTY_SELECTION;
  }
  if (!isWorkspaceId(selection.workspaceId) || typeof selection.selectedAt !== "string") {
    return EMPTY_SELECTION;
  }

  return cloneJson({
    workspaceId: selection.workspaceId,
    selectedAt: selection.selectedAt,
  });
}
