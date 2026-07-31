import type { WorkspaceSystemPackActivationRepository } from "../../../application/ports/workspace";
import {
  type WorkspaceId,
  type WorkspaceSystemPackActivation,
  isWorkspaceId,
  isWorkspaceSystemPackActivationStatus,
} from "../../../contracts/workspace";
import { LocalWorkspacePersistenceError } from "./localWorkspacePersistenceErrors";
import { cloneJson, mutateJsonDocument, readJsonDocument } from "./localWorkspacePersistenceJson";
import { resolveWorkspaceSystemPackActivationsFile } from "./localWorkspacePersistencePaths";
import type { StructuredDocumentStore } from "../shared";

export interface LocalWorkspaceSystemPackActivationRepositoryOptions {
  readonly rootDirectory: string;
  readonly documents?: StructuredDocumentStore;
}

export function createLocalWorkspaceSystemPackActivationRepository(
  options: LocalWorkspaceSystemPackActivationRepositoryOptions,
): WorkspaceSystemPackActivationRepository {
  const rootDirectory = options.rootDirectory;
  const persistence = { rootDirectory, documents: options.documents };

  async function readWorkspaceActivations(workspaceId: WorkspaceId): Promise<WorkspaceSystemPackActivation[]> {
    const safeWorkspaceId = assertWorkspaceId(workspaceId);
    const value = await readJsonDocument<unknown>(
      resolveWorkspaceSystemPackActivationsFile(rootDirectory, safeWorkspaceId),
      [],
      "workspace-activation-persistence-read-failed",
      persistence,
    );
    if (!Array.isArray(value)) {
      throw new LocalWorkspacePersistenceError("workspace-activation-persistence-read-failed");
    }

    return sortActivations(value.map((activation) => assertActivation(activation, safeWorkspaceId)));
  }

  async function mutateWorkspaceActivations(
    workspaceId: WorkspaceId,
    mutation: (activations: readonly WorkspaceSystemPackActivation[]) => WorkspaceSystemPackActivation[],
  ): Promise<void> {
    const safeWorkspaceId = assertWorkspaceId(workspaceId);
    await mutateJsonDocument(
      resolveWorkspaceSystemPackActivationsFile(rootDirectory, safeWorkspaceId),
      [] as WorkspaceSystemPackActivation[],
      "workspace-activation-persistence-write-failed",
      (current) => ({
        value: mutation(current.map((activation) => assertActivation(activation, safeWorkspaceId))),
        result: undefined,
      }),
      persistence,
    );
  }

  return {
    async listWorkspaceSystemPackActivations(workspaceId: WorkspaceId): Promise<readonly WorkspaceSystemPackActivation[]> {
      return cloneJson(await readWorkspaceActivations(workspaceId));
    },

    async readWorkspaceSystemPackActivation(
      workspaceId: WorkspaceId,
      activationId: string,
    ): Promise<WorkspaceSystemPackActivation | undefined> {
      const activation = (await readWorkspaceActivations(workspaceId)).find((candidate) => candidate.activationId === activationId);
      return activation ? cloneJson(activation) : undefined;
    },

    async saveWorkspaceSystemPackActivation(activation: WorkspaceSystemPackActivation): Promise<void> {
      const validActivation = assertActivation(activation, activation.workspaceId);
      await mutateWorkspaceActivations(validActivation.workspaceId, (activations) => upsertActivation(activations, validActivation));
    },

    async updateWorkspaceSystemPackActivation(activation: WorkspaceSystemPackActivation): Promise<void> {
      const validActivation = assertActivation(activation, activation.workspaceId);
      await mutateWorkspaceActivations(validActivation.workspaceId, (activations) => replaceActivation(activations, validActivation));
    },
  };
}

function upsertActivation(
  activations: readonly WorkspaceSystemPackActivation[],
  activation: WorkspaceSystemPackActivation,
): WorkspaceSystemPackActivation[] {
  return sortActivations([
    ...activations.filter((candidate) => candidate.activationId !== activation.activationId),
    cloneJson(activation),
  ]);
}

function replaceActivation(
  activations: readonly WorkspaceSystemPackActivation[],
  activation: WorkspaceSystemPackActivation,
): WorkspaceSystemPackActivation[] {
  if (!activations.some((candidate) => candidate.activationId === activation.activationId)) {
    throw new LocalWorkspacePersistenceError("workspace-activation-persistence-missing-record");
  }

  return sortActivations(activations.map((candidate) => (
    candidate.activationId === activation.activationId ? cloneJson(activation) : candidate
  )));
}

function sortActivations(activations: readonly WorkspaceSystemPackActivation[]): WorkspaceSystemPackActivation[] {
  return [...activations].sort((left, right) => {
    const activated = left.activatedAt.localeCompare(right.activatedAt);
    if (activated !== 0) return activated;
    return left.activationId.localeCompare(right.activationId);
  });
}

function assertActivation(value: unknown, workspaceId: WorkspaceId): WorkspaceSystemPackActivation {
  if (!value || typeof value !== "object") {
    throw new LocalWorkspacePersistenceError("workspace-activation-persistence-read-failed");
  }
  const activation = value as Partial<WorkspaceSystemPackActivation>;
  const safeWorkspaceId = assertWorkspaceId(workspaceId);
  if (
    activation.workspaceId !== safeWorkspaceId ||
    typeof activation.activationId !== "string" ||
    activation.activationId.trim().length === 0 ||
    typeof activation.packId !== "string" ||
    activation.packId.trim().length === 0 ||
    typeof activation.packVersion !== "string" ||
    activation.packVersion.trim().length === 0 ||
    activation.sourceKind !== "system" ||
    activation.sourceLayer !== "system-default" ||
    activation.trustStatus !== "system-trusted" ||
    !isWorkspaceSystemPackActivationStatus(activation.status) ||
    typeof activation.activatedAt !== "string"
  ) {
    throw new LocalWorkspacePersistenceError("workspace-activation-persistence-read-failed");
  }

  return cloneJson(activation as WorkspaceSystemPackActivation);
}

function assertWorkspaceId(workspaceId: WorkspaceId): WorkspaceId {
  if (!isWorkspaceId(workspaceId)) {
    throw new LocalWorkspacePersistenceError("workspace-persistence-invalid-record");
  }
  return workspaceId;
}
