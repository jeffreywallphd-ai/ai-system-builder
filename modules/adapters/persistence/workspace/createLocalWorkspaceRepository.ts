import type { WorkspaceRepository } from "../../../application/ports/workspace";
import {
  type WorkspaceId,
  type WorkspaceRecord,
  isWorkspaceId,
  isWorkspaceStatus,
} from "../../../contracts/workspace";
import { LocalWorkspacePersistenceError } from "./localWorkspacePersistenceErrors";
import { cloneJson, mutateJsonDocument, readJsonDocument, writeJsonDocument } from "./localWorkspacePersistenceJson";
import {
  resolveWorkspaceIndexFile,
  resolveWorkspaceRecordFile,
} from "./localWorkspacePersistencePaths";
import type { StructuredDocumentStore } from "../shared";

export interface LocalWorkspaceRepositoryOptions {
  readonly rootDirectory: string;
  readonly documents?: StructuredDocumentStore;
}

export function createLocalWorkspaceRepository(options: LocalWorkspaceRepositoryOptions): WorkspaceRepository {
  const rootDirectory = options.rootDirectory;
  const persistence = { rootDirectory, documents: options.documents };

  async function readIndex(): Promise<WorkspaceRecord[]> {
    const value = await readJsonDocument<unknown>(resolveWorkspaceIndexFile(rootDirectory), [], "workspace-persistence-read-failed", persistence);
    if (!Array.isArray(value)) {
      throw new LocalWorkspacePersistenceError("workspace-persistence-invalid-record");
    }

    return sortWorkspaces(value.map((record) => assertWorkspaceRecord(record, options.documents?.organizationId)));
  }

  async function writeWorkspaceRecord(workspace: WorkspaceRecord, target = persistence): Promise<void> {
    await writeJsonDocument(resolveWorkspaceRecordFile(rootDirectory, workspace.workspaceId), workspace, "workspace-persistence-write-failed", target);
  }

  async function writeWorkspaceAndIndex(
    workspace: WorkspaceRecord,
    updateIndex: (index: readonly WorkspaceRecord[]) => WorkspaceRecord[],
  ): Promise<void> {
    if (options.documents) {
      await options.documents.runInTransaction(async (transaction) => {
        const target = { rootDirectory, documents: transaction };
        await writeWorkspaceRecord(workspace, target);
        await mutateJsonDocument(
          resolveWorkspaceIndexFile(rootDirectory),
          [] as WorkspaceRecord[],
          "workspace-persistence-write-failed",
          (current) => ({
            value: updateIndex(current.map((record) => assertWorkspaceRecord(record, transaction.organizationId))),
            result: undefined,
          }),
          target,
        );
      });
      return;
    }
    await writeWorkspaceRecord(workspace);
    const current = await readIndex();
    await writeJsonDocument(
      resolveWorkspaceIndexFile(rootDirectory),
      updateIndex(current),
      "workspace-persistence-write-failed",
      persistence,
    );
  }

  return {
    async listWorkspaces(): Promise<readonly WorkspaceRecord[]> {
      return cloneJson(await readIndex());
    },

    async readWorkspace(workspaceId: WorkspaceId): Promise<WorkspaceRecord | undefined> {
      const safeWorkspaceId = assertWorkspaceId(workspaceId);
      const value = await readJsonDocument<unknown | undefined>(
        resolveWorkspaceRecordFile(rootDirectory, safeWorkspaceId),
        undefined,
        "workspace-persistence-read-failed",
        persistence,
      );
      if (value === undefined) return undefined;
      return cloneJson(assertWorkspaceRecord(value, options.documents?.organizationId));
    },

    async saveWorkspace(workspace: WorkspaceRecord): Promise<void> {
      const validWorkspace = assertWorkspaceRecord(workspace, options.documents?.organizationId);
      await writeWorkspaceAndIndex(validWorkspace, (index) => upsertWorkspace(index, validWorkspace));
    },

    async updateWorkspace(workspace: WorkspaceRecord): Promise<void> {
      const validWorkspace = assertWorkspaceRecord(workspace, options.documents?.organizationId);
      const existing = await this.readWorkspace(validWorkspace.workspaceId);
      if (!existing) {
        throw new LocalWorkspacePersistenceError("workspace-persistence-missing-record");
      }
      await writeWorkspaceAndIndex(validWorkspace, (index) => replaceWorkspace(index, validWorkspace));
    },

    async archiveWorkspace(workspaceId: WorkspaceId, archivedAt: string): Promise<WorkspaceRecord | undefined> {
      const existing = await this.readWorkspace(workspaceId);
      if (!existing) return undefined;
      const archived: WorkspaceRecord = {
        ...existing,
        status: "archived",
        updatedAt: archivedAt,
      };
      await this.updateWorkspace(archived);
      return cloneJson(archived);
    },
  };
}

function upsertWorkspace(records: readonly WorkspaceRecord[], workspace: WorkspaceRecord): WorkspaceRecord[] {
  return sortWorkspaces([
    ...records.filter((record) => record.workspaceId !== workspace.workspaceId),
    cloneJson(workspace),
  ]);
}

function replaceWorkspace(records: readonly WorkspaceRecord[], workspace: WorkspaceRecord): WorkspaceRecord[] {
  if (!records.some((record) => record.workspaceId === workspace.workspaceId)) {
    throw new LocalWorkspacePersistenceError("workspace-persistence-missing-record");
  }

  return sortWorkspaces(records.map((record) => (
    record.workspaceId === workspace.workspaceId ? cloneJson(workspace) : record
  )));
}

function sortWorkspaces(records: readonly WorkspaceRecord[]): WorkspaceRecord[] {
  return [...records].sort((left, right) => {
    const created = left.createdAt.localeCompare(right.createdAt);
    if (created !== 0) return created;
    return String(left.workspaceId).localeCompare(String(right.workspaceId));
  });
}

function assertWorkspaceRecord(
  value: unknown,
  expectedOrganizationId?: WorkspaceRecord["organizationId"],
): WorkspaceRecord {
  if (!value || typeof value !== "object") {
    throw new LocalWorkspacePersistenceError("workspace-persistence-invalid-record");
  }
  const record = value as Partial<WorkspaceRecord>;
  if (
    !isWorkspaceId(record.workspaceId) ||
    typeof record.displayName !== "string" ||
    record.displayName.trim().length === 0 ||
    !isWorkspaceStatus(record.status) ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string"
  ) {
    throw new LocalWorkspacePersistenceError("workspace-persistence-invalid-record");
  }
  if (expectedOrganizationId !== undefined && record.organizationId !== expectedOrganizationId) {
    throw new LocalWorkspacePersistenceError("workspace-persistence-invalid-record");
  }

  return cloneJson(record as WorkspaceRecord);
}

function assertWorkspaceId(workspaceId: WorkspaceId): WorkspaceId {
  if (!isWorkspaceId(workspaceId)) {
    throw new LocalWorkspacePersistenceError("workspace-persistence-invalid-record");
  }
  return workspaceId;
}
