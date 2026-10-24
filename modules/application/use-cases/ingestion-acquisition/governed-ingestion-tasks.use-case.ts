import type {
  IngestionAcquisitionRepositoryPort,
  IngestionCheckpointStoragePort,
  IngestionFilePublicationPort,
} from "../../ports/ingestion";
import { assertPublicationTask, normalizeIngestionFilePublication } from "../../shared/ingestion-file-publication";
import type {
  ArtifactStoragePort,
  ArtifactStreamStoragePort,
} from "../../ports/storage";
import type { WorkspaceRepository } from "../../ports/workspace";
import type { WorkspaceOperationAuthorizationPort } from "../../ports/security";
import type { OrganizationRequestContextProviderPort } from "../../ports/organization";
import type { ApplicationRequestContext } from "../../ports";
import {
  INGESTION_TASK_MAXIMUM_CHUNK_BYTES,
  INGESTION_TASK_CHECKPOINT_RETENTION_MS,
  INGESTION_TASK_RECOMMENDED_CHUNK_BYTES,
  normalizeIngestionSha256Digest,
  normalizeIngestionTaskFileId,
  normalizeIngestionTaskId,
  normalizeIngestionTaskRecord,
  normalizeIngestionSourceSnapshot,
  type IngestionSourceSnapshot,
  type IngestionTaskFileRecord,
  type IngestionTaskKind,
  type IngestionTaskProviderSource,
  type IngestionTaskRecord,
  normalizeIngestionTaskTransportCommand,
  type IngestionTaskTransportCommand,
  type IngestionTaskTransportValue,
} from "../../../contracts/ingestion";
import {
  createContractError,
  createFailureResult,
  createSuccessResult,
  type ContractResult,
} from "../../../contracts/shared";
import { resolveArtifactWorkspaceContext } from "../artifact-workspace-context";
import type { RegisterArtifactFromRepoUseCase } from "../register-artifact-from-repo.use-case";
import type { GovernedWebsiteIngestionUseCases } from "./governed-website-ingestion.use-case";

export type IngestionTaskResult<T = IngestionTaskRecord> = ContractResult<T>;

export interface CreateIngestionTaskCommand {
  readonly kind?: IngestionTaskKind;
  readonly files: readonly {
    readonly fileName: string;
    readonly mediaType: string;
    readonly sizeBytes: number;
    readonly providerSource?: IngestionTaskProviderSource;
  }[];
}

export interface CreateHuggingFaceIngestionTaskCommand {
  readonly files: readonly {
    readonly repository: string;
    readonly path: string;
    readonly revision: string;
    readonly mediaType?: string;
  }[];
}

export interface AppendIngestionChunkCommand {
  readonly taskId: string;
  readonly fileId: string;
  readonly chunkIndex: number;
  readonly expectedOffset: number;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export interface GovernedIngestionTaskUseCasesDependencies {
  readonly repository: IngestionAcquisitionRepositoryPort;
  readonly checkpoints: IngestionCheckpointStoragePort;
  readonly streamStorage: ArtifactStreamStoragePort;
  readonly artifactCleanup: Pick<ArtifactStoragePort, "deleteArtifact">;
  readonly filePublication?: IngestionFilePublicationPort;
  readonly registerArtifactFromRepo?: Pick<
    RegisterArtifactFromRepoUseCase,
    "execute"
  >;
  readonly website?: Pick<
    GovernedWebsiteIngestionUseCases,
    "createTask" | "runTask" | "refreshSource"
  >;
  readonly workspaceRepository?: Pick<WorkspaceRepository, "readWorkspace">;
  readonly workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
  readonly organizationContextProvider?: OrganizationRequestContextProviderPort;
  readonly now?: () => string;
  readonly createId?: () => string;
}

export class GovernedIngestionTaskUseCases {
  private readonly now: () => string;
  private readonly createId: () => string;

  public constructor(
    private readonly dependencies: GovernedIngestionTaskUseCasesDependencies,
  ) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.createId =
      dependencies.createId ??
      (() => {
        if (!globalThis.crypto?.randomUUID)
          throw new Error("Secure ingestion id generation is unavailable.");
        return globalThis.crypto.randomUUID();
      });
  }

  public async executeCommand(
    commandValue: IngestionTaskTransportCommand,
    context: ApplicationRequestContext = {},
  ): Promise<IngestionTaskResult<IngestionTaskTransportValue>> {
    let effectiveContext = context;
    if (this.dependencies.organizationContextProvider) {
      let activeOrganizationContext;
      try {
        activeOrganizationContext =
          this.dependencies.organizationContextProvider.getCurrentOrganizationContext();
      } catch {
        return failure(
          "unavailable",
          "The active organization context is unavailable.",
          context,
        );
      }
      if (!activeOrganizationContext) {
        return failure(
          "forbidden",
          "An active organization context is required for ingestion.",
          context,
        );
      }
      if (
        (context.organizationId &&
          context.organizationId !==
            activeOrganizationContext.organizationId) ||
        (context.principalId &&
          context.principalId !== activeOrganizationContext.principalId)
      ) {
        return failure(
          "forbidden",
          "The ingestion request does not match the active organization context.",
          context,
        );
      }
      effectiveContext = {
        ...context,
        organizationId: activeOrganizationContext.organizationId,
        principalId: activeOrganizationContext.principalId,
      };
    }
    try {
      const command = normalizeIngestionTaskTransportCommand(commandValue);
      switch (command.action) {
        case "create-files":
          return taskExecution(
            await this.createTask(
              { kind: "file-batch", files: command.files },
              effectiveContext,
            ),
          );
        case "create-hugging-face":
          return taskExecution(
            await this.createHuggingFaceTask(
              { files: command.files },
              effectiveContext,
            ),
          );
        case "create-website":
          return this.dependencies.website
            ? taskExecution(
                await this.dependencies.website.createTask(
                  command.scope,
                  effectiveContext,
                ),
              )
            : failure(
                "unavailable",
                "Website capture is not available in this environment.",
                effectiveContext,
              );
        case "append-chunk":
          return taskExecution(
            await this.appendChunk(command, effectiveContext),
          );
        case "finalize-file":
          return taskExecution(
            await this.finalizeFile(command, effectiveContext),
          );
        case "read":
          return taskExecution(
            await this.readTask(command.taskId, effectiveContext),
          );
        case "cancel":
          return taskExecution(
            await this.cancelTask(command.taskId, effectiveContext),
          );
        case "resume":
          return taskExecution(
            await this.resumeTask(command.taskId, effectiveContext),
          );
        case "run-hugging-face":
          return taskExecution(
            await this.runHuggingFaceTask(command.taskId, effectiveContext),
          );
        case "run-website":
          return this.dependencies.website
            ? taskExecution(
                await this.dependencies.website.runTask(
                  command.taskId,
                  effectiveContext,
                ),
              )
            : failure(
                "unavailable",
                "Website capture is not available in this environment.",
                effectiveContext,
              );
        case "refresh-website": {
          if (!this.dependencies.website)
            return failure(
              "unavailable",
              "Website refresh is not available in this environment.",
              effectiveContext,
            );
          const result = await this.dependencies.website.refreshSource(
            command.sourceId,
            effectiveContext,
          );
          return result.ok
            ? createSuccessResult(
                { kind: "refresh", refresh: result.value },
                result,
              )
            : result;
        }
        case "list": {
          const result = await this.listTasks(effectiveContext);
          return result.ok
            ? createSuccessResult(
                { kind: "tasks", tasks: result.value },
                result,
              )
            : result;
        }
        case "cleanup-expired": {
          const result = await this.cleanupExpiredTasks(effectiveContext);
          return result.ok
            ? createSuccessResult(
                {
                  kind: "cleanup",
                  cleanedTaskIds: result.value.cleanedTaskIds,
                },
                result,
              )
            : result;
        }
      }
    } catch (error) {
      return failure(
        "validation",
        safeMessage(error, "The ingestion task request is invalid."),
        effectiveContext,
      );
    }
  }

  public async createTask(
    command: CreateIngestionTaskCommand,
    context: ApplicationRequestContext = {},
  ): Promise<IngestionTaskResult> {
    const scope = await this.authorize(
      context,
      "ingestion.task.create",
      "artifact:write",
    );
    if (!scope.ok) return scope;
    try {
      const createdAt = this.now();
      const taskId = normalizeIngestionTaskId(`ingestion.${this.createId()}`);
      const files: IngestionTaskFileRecord[] = command.files.map((file) => ({
        fileId: normalizeIngestionTaskFileId(`file.${this.createId()}`),
        checkpointId: `checkpoint.${this.createId()}`,
        fileName: file.fileName,
        mediaType: file.mediaType,
        totalBytes: file.sizeBytes,
        status: "pending",
        acceptedBytes: 0,
        nextChunkIndex: 0,
        ...(file.providerSource ? { providerSource: file.providerSource } : {}),
      }));
      const kind = command.kind ?? "file-batch";
      const task = normalizeIngestionTaskRecord({
        schemaVersion: "1.0",
        taskId,
        ...(context.organizationId
          ? { organizationId: context.organizationId }
          : {}),
        workspaceId: scope.value.workspaceId,
        kind,
        status: "queued",
        files,
        progress: {
          acceptedBytes: 0,
          totalBytes: 0,
          completedItems: 0,
          totalItems: files.length,
          percent: 0,
          message: "Ready to transfer.",
        },
        revision: 1,
        cleanupPending: kind === "file-batch",
        ...(kind === "file-batch"
          ? {
              checkpointExpiresAt: new Date(
                Date.parse(createdAt) + INGESTION_TASK_CHECKPOINT_RETENTION_MS,
              ).toISOString(),
            }
          : {}),
        createdAt,
        updatedAt: createdAt,
      });
      return createSuccessResult(
        await this.dependencies.repository.createTask(task),
        context,
      );
    } catch (error) {
      return failure(
        "validation",
        safeMessage(error, "The ingestion task could not be created."),
        context,
      );
    }
  }

  public async createHuggingFaceTask(
    command: CreateHuggingFaceIngestionTaskCommand,
    context: ApplicationRequestContext = {},
  ): Promise<IngestionTaskResult> {
    if (!this.dependencies.registerArtifactFromRepo)
      return failure(
        "unavailable",
        "Hugging Face ingestion is not available in this environment.",
        context,
      );
    return this.createTask(
      {
        kind: "hugging-face",
        files: command.files.map((file) => ({
          fileName: providerBaseName(file.path),
          mediaType: providerMediaType(file.path, file.mediaType),
          sizeBytes: 0,
          providerSource: {
            provider: "huggingface",
            repository: file.repository,
            path: file.path,
            revision: file.revision,
          },
        })),
      },
      context,
    );
  }

  public async runHuggingFaceTask(
    taskIdValue: string,
    context: ApplicationRequestContext = {},
  ): Promise<IngestionTaskResult> {
    const scope = await this.authorize(
      context,
      "ingestion.hugging-face.run",
      "artifact:write",
    );
    if (!scope.ok) return scope;
    const registerArtifact = this.dependencies.registerArtifactFromRepo;
    if (!registerArtifact)
      return failure(
        "unavailable",
        "Hugging Face ingestion is not available in this environment.",
        context,
      );
    try {
      let task = await this.requireTask(
        scope.value.workspaceId,
        normalizeIngestionTaskId(taskIdValue),
      );
      if (task.kind !== "hugging-face")
        throw new Error("This is not a Hugging Face ingestion task.");
      if (task.status === "succeeded" || task.status === "cancelled")
        return createSuccessResult(task, context);
      if (task.status === "failed") {
        if (
          task.files.some(
            (file) => file.status === "failed" && !file.error?.retryable,
          )
        )
          throw new Error("This provider task cannot be resumed safely.");
        task = await this.dependencies.repository.saveTask(
          updateTask(task, {
            status: "transferring",
            files: task.files.map((file) =>
              file.status === "failed"
                ? { ...file, status: "pending", error: undefined }
                : file,
            ),
            updatedAt: this.now(),
            completedAt: undefined,
            cleanupPending: false,
            progressMessage: "Resuming provider import.",
          }),
          task.revision,
        );
      }

      for (const candidate of task.files) {
        task = await this.requireTask(scope.value.workspaceId, task.taskId);
        if (task.status === "cancelled")
          return createSuccessResult(task, context);
        const file = requireFile(task, candidate.fileId);
        if (file.status === "finalized") continue;
        const source = file.providerSource;
        if (!source)
          throw new Error("Provider task coordinates are unavailable.");
        if (task.status === "queued") {
          task = await this.dependencies.repository.saveTask(
            updateTask(task, {
              status: "transferring",
              files: task.files,
              updatedAt: this.now(),
              cleanupPending: false,
              progressMessage: "Importing selected provider files.",
            }),
            task.revision,
          );
        }
        const result = await registerArtifact.execute(
          {
            target: source,
            mediaType: file.mediaType,
          },
          context,
        );
        if (!result.ok) {
          const completedAt = this.now();
          const retryable =
            result.error.code === "unavailable" ||
            result.error.code === "internal";
          const failed = updateTask(task, {
            status: "failed",
            files: replaceFile(task, file.fileId, {
              ...file,
              status: "failed",
              error: {
                code: `provider-${result.error.code}`,
                message: safeMessage(
                  result.error.message,
                  "The provider file could not be imported.",
                ),
                retryable,
              },
            }),
            updatedAt: completedAt,
            completedAt,
            cleanupPending: false,
            progressMessage: retryable
              ? "Provider import paused. Retry when the provider is available."
              : "A selected provider file could not be imported.",
          });
          return createSuccessResult(
            await this.dependencies.repository.saveTask(failed, task.revision),
            context,
          );
        }
        const capturedAt = this.now();
        const sourceId = `source.${task.taskId}.${file.fileId}`;
        const snapshotId = `snapshot.${task.taskId}.${file.fileId}`;
        const snapshot = {
          schemaVersion: "1.0",
          snapshotId: snapshotId as never,
          sourceId: sourceId as never,
          ...(task.organizationId
            ? { organizationId: task.organizationId }
            : {}),
          workspaceId: task.workspaceId,
          locator: {
            kind: "hugging-face",
            displayName: file.fileName,
            repository: source.repository,
            path: source.path,
            revision: source.revision,
          },
          sizeBytes: 0,
          mediaType: file.mediaType,
          rawArtifactKey: result.value.artifactId,
          capturedAt,
          providerRevision: source.revision,
        } as const;
        const finalizedFiles = replaceFile(task, file.fileId, {
          ...file,
          status: "finalized",
          output: {
            key: result.value.artifactId,
            mediaType: file.mediaType,
            sizeBytes: 0,
            providerRevision: source.revision,
            sourceId,
            sourceSnapshotId: snapshotId,
          },
        });
        const allFinalized = finalizedFiles.every(
          (entry) => entry.status === "finalized",
        );
        const nextTask = updateTask(task, {
          status: allFinalized ? "succeeded" : "transferring",
          files: finalizedFiles,
          updatedAt: capturedAt,
          ...(allFinalized ? { completedAt: capturedAt } : {}),
          cleanupPending: false,
          progressMessage: allFinalized
            ? "All provider files are ready."
            : "Provider file imported. Continuing with the remaining files.",
        });
        try {
          task = (
            await this.dependencies.repository.saveTaskWithSourceSnapshot(
              nextTask,
              task.revision,
              snapshot,
            )
          ).task;
        } catch {
          const current = await this.readFinalizationState(nextTask, requireFile(nextTask, file.fileId), snapshot);
          if (current.task.status === "cancelled") return createSuccessResult(current.task, context);
          if (!current.committed) throw new Error("The imported source has an uncertain commit. Its data was retained for recovery.");
          task = current.task;
        }
      }
      return createSuccessResult(task, context);
    } catch (error) {
      return failure(
        error instanceof MissingTaskError ? "not-found" : "validation",
        safeMessage(error, "The provider ingestion task could not be run."),
        context,
      );
    }
  }

  public async appendChunk(
    command: AppendIngestionChunkCommand,
    context: ApplicationRequestContext = {},
  ): Promise<IngestionTaskResult> {
    const scope = await this.authorize(
      context,
      "ingestion.task.append",
      "artifact:write",
    );
    if (!scope.ok) return scope;
    try {
      const taskId = normalizeIngestionTaskId(command.taskId);
      const fileId = normalizeIngestionTaskFileId(command.fileId);
      const digest = normalizeIngestionSha256Digest(command.sha256);
      if (
        !(command.bytes instanceof Uint8Array) ||
        command.bytes.byteLength < 1 ||
        command.bytes.byteLength > INGESTION_TASK_MAXIMUM_CHUNK_BYTES
      )
        throw new Error(
          `Each ingestion chunk must contain 1 through ${INGESTION_TASK_MAXIMUM_CHUNK_BYTES} bytes.`,
        );
      const task = await this.requireTask(scope.value.workspaceId, taskId);
      if (task.status !== "queued" && task.status !== "transferring")
        throw new Error("This ingestion task is not accepting chunks.");
      const file = requireFile(task, fileId);
      if (file.status === "finalized")
        return createSuccessResult(task, context);
      if (
        command.chunkIndex < file.nextChunkIndex &&
        file.lastChunk?.index === command.chunkIndex &&
        file.lastChunk.digest === digest
      )
        return createSuccessResult(task, context);
      if (
        command.chunkIndex !== file.nextChunkIndex ||
        command.expectedOffset !== file.acceptedBytes
      )
        throw new Error(
          "The ingestion chunk is out of order. Resume from the accepted progress shown.",
        );
      const checkpoint = await this.dependencies.checkpoints.appendChunk(
        {
          workspaceId: scope.value.workspaceId,
          checkpointId: file.checkpointId,
          chunkIndex: command.chunkIndex,
          expectedOffset: command.expectedOffset,
          bytes: command.bytes,
          sha256: digest,
        },
        context,
      );
      if (
        checkpoint.chunkCount !== command.chunkIndex + 1 ||
        checkpoint.sizeBytes > file.totalBytes
      )
        throw new Error(
          "Checkpoint progress does not match the ingestion task.",
        );
      const updated = updateTask(task, {
        status: "transferring",
        files: replaceFile(task, fileId, {
          ...file,
          status: "transferring",
          acceptedBytes: checkpoint.sizeBytes,
          nextChunkIndex: checkpoint.chunkCount,
          lastChunk: {
            index: command.chunkIndex,
            sizeBytes: command.bytes.byteLength,
            digest,
          },
        }),
        updatedAt: this.now(),
        progressMessage: `Transferred ${checkpoint.sizeBytes} of ${file.totalBytes} bytes.`,
      });
      return createSuccessResult(
        await this.saveIdempotently(
          updated,
          task.revision,
          fileId,
          checkpoint.chunkCount,
          digest,
        ),
        context,
      );
    } catch (error) {
      return failure(
        error instanceof MissingTaskError ? "not-found" : "validation",
        safeMessage(error, "The ingestion chunk could not be accepted."),
        context,
      );
    }
  }

  public async finalizeFile(
    command: { taskId: string; fileId: string; sha256?: string },
    context: ApplicationRequestContext = {},
  ): Promise<IngestionTaskResult> {
    const scope = await this.authorize(
      context,
      "ingestion.task.finalize",
      "artifact:write",
    );
    if (!scope.ok) return scope;
    const taskId = normalizeIngestionTaskId(command.taskId);
    const fileId = normalizeIngestionTaskFileId(command.fileId);
    const expectedDigest = command.sha256
      ? normalizeIngestionSha256Digest(command.sha256)
      : undefined;
    try {
      let task = await this.requireTask(scope.value.workspaceId, taskId);
      let file = requireFile(task, fileId);
      if (task.kind !== "file-batch") throw new Error("Only uploaded files use file finalization.");
      if (!this.dependencies.filePublication) throw new Error("Verified file publication is unavailable.");
      if (file.status === "finalized") {
        if (expectedDigest && file.output?.digest !== expectedDigest) throw new Error("The finalized file digest does not match this request.");
        await this.dependencies.filePublication.verifyFilePublication({ taskId, fileId, expectedSha256: expectedDigest }, context);
        const current = await this.readFinalizationState(task, file);
        if (!current.committed) throw new Error("The finalized source could not be verified. Its data was retained for recovery.");
        return await this.finishCheckpointCleanup(current.task, requireFile(current.task, fileId), context);
      }
      if (
        task.status !== "queued" &&
        task.status !== "transferring" &&
        task.status !== "finalizing"
      )
        throw new Error("Resume this ingestion task before finalizing it.");
      if (file.acceptedBytes !== file.totalBytes)
        throw new Error("Transfer all file bytes before finalizing.");
      if (task.status !== "finalizing") {
        task = await this.dependencies.repository.saveTask(
          updateTask(task, {
            status: "finalizing",
            files: task.files,
            updatedAt: this.now(),
            progressMessage: "Checking and saving the transferred file.",
          }),
          task.revision,
        );
        file = requireFile(task, fileId);
      }
      const published = await this.dependencies.filePublication.publishFile({ taskId, fileId, expectedSha256: expectedDigest }, context);
      if (published.kind === "content-rejected")
        return await this.markFailed(
          task,
          file,
          "content-verification-failed",
          "The transferred file could not be verified. Check its checksum, then resume and retry.",
          context,
        );
      const publication = normalizeIngestionFilePublication(published.publication);
      assertPublicationTask(publication, task);
      if (!["origin-complete", "committed"].includes(publication.state) || !publication.digest
        || (expectedDigest && publication.digest !== expectedDigest)) throw new Error("The saved source could not be verified. Its data was retained for recovery.");
      const outputDigest = publication.digest;
      const sourceId = `source.${task.taskId}.${file.fileId}`;
      const snapshotId = `snapshot.${task.taskId}.${file.fileId}`;
      const snapshot = {
        schemaVersion: "1.0",
        snapshotId: snapshotId as never,
        sourceId: sourceId as never,
        ...(task.organizationId ? { organizationId: task.organizationId } : {}),
        workspaceId: task.workspaceId,
        locator: {
          kind: "file",
          displayName: file.fileName,
          originalName: file.fileName,
        },
        contentDigest: outputDigest,
        sizeBytes: publication.totalBytes,
        mediaType: file.mediaType,
        rawArtifactKey: publication.key,
        capturedAt: publication.capturedAt,
      } as const;
      const nextTask = updateTask(task, {
        status: "finalizing",
        files: replaceFile(task, fileId, {
          ...file,
          status: "finalized",
          output: {
            key: publication.key,
            mediaType: file.mediaType,
            sizeBytes: publication.totalBytes,
            digest: outputDigest,
            sourceId,
            sourceSnapshotId: snapshotId,
          },
        }),
        updatedAt: this.now(),
        progressMessage: "File saved. Cleaning transfer checkpoints.",
      });
      try {
        task = (
          await this.dependencies.repository.saveTaskWithSourceSnapshot(
            nextTask,
            task.revision,
            snapshot,
          )
        ).task;
      } catch {
        const current = await this.readFinalizationState(nextTask, requireFile(nextTask, fileId), snapshot);
        if (current.task.status === "cancelled") return createSuccessResult(current.task, context);
        if (!current.committed) throw new Error("The saved source has an uncertain commit. Its data was retained for recovery.");
        task = current.task;
      }
      await this.dependencies.filePublication.verifyFilePublication({ taskId, fileId, expectedSha256: expectedDigest }, context);
      return await this.finishCheckpointCleanup(
        task,
        requireFile(task, fileId),
        context,
      );
    } catch (error) {
      return failure(
        error instanceof MissingTaskError ? "not-found" : "validation",
        safeMessage(error, "The ingestion file could not be finalized."),
        context,
      );
    }
  }

  public async readTask(
    taskId: string,
    context: ApplicationRequestContext = {},
  ): Promise<IngestionTaskResult> {
    const scope = await this.authorize(
      context,
      "ingestion.task.read",
      "artifact:read",
    );
    if (!scope.ok) return scope;
    const task = await this.dependencies.repository.readTask(
      scope.value.workspaceId,
      normalizeIngestionTaskId(taskId),
    );
    return task
      ? createSuccessResult(task, context)
      : failure("not-found", "The ingestion task was not found.", context);
  }

  public async listTasks(
    context: ApplicationRequestContext = {},
  ): Promise<IngestionTaskResult<readonly IngestionTaskRecord[]>> {
    const scope = await this.authorize(
      context,
      "ingestion.task.list",
      "artifact:read",
    );
    if (!scope.ok) return scope;
    return createSuccessResult(
      await this.dependencies.repository.listTasks(scope.value.workspaceId),
      context,
    );
  }

  public async cleanupExpiredTasks(
    context: ApplicationRequestContext = {},
  ): Promise<
    IngestionTaskResult<{ readonly cleanedTaskIds: readonly string[] }>
  > {
    const scope = await this.authorize(
      context,
      "ingestion.task.cleanup-expired",
      "artifact:write",
    );
    if (!scope.ok) return scope;
    const cleanedTaskIds: string[] = [];
    try {
      const tasks =
        await this.dependencies.repository.listExpiredCheckpointTasks(
          scope.value.workspaceId,
          this.now(),
        );
      for (const task of tasks) {
        const result = await this.cancelTask(task.taskId, context);
        if (!result.ok) return result;
        if (!result.value.cleanupPending) cleanedTaskIds.push(task.taskId);
      }
      return createSuccessResult({ cleanedTaskIds }, context);
    } catch (error) {
      return failure(
        "internal",
        safeMessage(
          error,
          "Expired ingestion checkpoints could not be cleaned.",
        ),
        context,
      );
    }
  }

  public async cancelTask(
    taskIdValue: string,
    context: ApplicationRequestContext = {},
  ): Promise<IngestionTaskResult> {
    const scope = await this.authorize(
      context,
      "ingestion.task.cancel",
      "artifact:write",
    );
    if (!scope.ok) return scope;
    try {
      let task = await this.requireTask(
        scope.value.workspaceId,
        normalizeIngestionTaskId(taskIdValue),
      );
      if (task.status === "succeeded")
        throw new Error("Completed ingestion tasks cannot be cancelled.");
      if (task.status !== "cancelled") {
        const completedAt = this.now();
        task = await this.dependencies.repository.saveTask(
          updateTask(task, {
            status: "cancelled",
            files: task.files.map((file) =>
              file.status === "finalized"
                ? file
                : { ...file, status: "cancelled", error: undefined },
            ),
            updatedAt: completedAt,
            completedAt,
            cleanupPending: task.kind === "file-batch",
            progressMessage:
              task.kind === "file-batch"
                ? "Cancelled. Cleaning transfer checkpoints."
                : "Cancelled.",
          }),
          task.revision,
        );
      }
      let cleanupFailed = false;
      for (const file of task.kind === "file-batch"
        ? task.files.filter((candidate) => candidate.status !== "finalized")
        : []) {
        await this.dependencies.checkpoints
          .deleteCheckpoint(
            { workspaceId: task.workspaceId, checkpointId: file.checkpointId },
            context,
          )
          .catch(() => {
            cleanupFailed = true;
          });
      }
      if (!cleanupFailed && task.cleanupPending)
        task = await this.dependencies.repository.saveTask(
          updateTask(task, {
            status: "cancelled",
            files: task.files,
            updatedAt: this.now(),
            completedAt: task.completedAt,
            cleanupPending: false,
            progressMessage: "Cancelled.",
          }),
          task.revision,
        );
      return createSuccessResult(task, context);
    } catch (error) {
      return failure(
        error instanceof MissingTaskError ? "not-found" : "validation",
        safeMessage(error, "The ingestion task could not be cancelled."),
        context,
      );
    }
  }

  public async resumeTask(
    taskIdValue: string,
    context: ApplicationRequestContext = {},
  ): Promise<IngestionTaskResult> {
    const scope = await this.authorize(
      context,
      "ingestion.task.resume",
      "artifact:write",
    );
    if (!scope.ok) return scope;
    try {
      const task = await this.requireTask(
        scope.value.workspaceId,
        normalizeIngestionTaskId(taskIdValue),
      );
      if (task.status !== "failed")
        throw new Error(
          "Only a failed retryable ingestion task can be resumed.",
        );
      if (
        task.files.some(
          (file) => file.status === "failed" && !file.error?.retryable,
        )
      )
        throw new Error("This ingestion task cannot be resumed safely.");
      const resumed = updateTask(task, {
        status: "transferring",
        files: task.files.map((file) =>
          file.status === "failed"
            ? { ...file, status: "transferring", error: undefined }
            : file,
        ),
        updatedAt: this.now(),
        completedAt: undefined,
        cleanupPending: task.kind === "file-batch",
        progressMessage: "Ready to resume from accepted progress.",
      });
      return createSuccessResult(
        await this.dependencies.repository.saveTask(resumed, task.revision),
        context,
      );
    } catch (error) {
      return failure(
        error instanceof MissingTaskError ? "not-found" : "validation",
        safeMessage(error, "The ingestion task could not be resumed."),
        context,
      );
    }
  }

  public get recommendedChunkBytes(): number {
    return INGESTION_TASK_RECOMMENDED_CHUNK_BYTES;
  }

  private async finishCheckpointCleanup(
    task: IngestionTaskRecord,
    file: IngestionTaskFileRecord,
    context: ApplicationRequestContext,
  ): Promise<IngestionTaskResult> {
    // A persisted terminal result is never rewritten by a cleanup retry.
    if (task.status === "succeeded" || task.status === "cancelled" || task.status === "failed") return createSuccessResult(task, context);
    try {
      await this.dependencies.checkpoints.deleteCheckpoint(
        { workspaceId: task.workspaceId, checkpointId: file.checkpointId },
        context,
      );
    } catch {
      return createSuccessResult(task, context);
    }
    const allFinalized = task.files.every(
      (candidate) => candidate.status === "finalized",
    );
    const updatedAt = this.now();
    const cleaned = updateTask(task, {
      status: allFinalized ? "succeeded" : "transferring",
      files: task.files,
      updatedAt,
      ...(allFinalized ? { completedAt: updatedAt } : {}),
      cleanupPending: task.files.some(
        (candidate) => candidate.status !== "finalized",
      ),
      progressMessage: allFinalized
        ? "All files are ready."
        : "File saved. Continue with the remaining files.",
    });
    try {
      return createSuccessResult(await this.dependencies.repository.saveTask(cleaned, task.revision), context);
    } catch {
      const current = await this.readFinalizationState(cleaned, requireFile(cleaned, file.fileId));
      if (current.committed && JSON.stringify(current.task) === JSON.stringify(cleaned)) return createSuccessResult(current.task, context);
      if (current.task.status === "cancelled" || current.task.status === "failed") return createSuccessResult(current.task, context);
      throw new Error("Source cleanup has an uncertain commit. Its data was retained for recovery.");
    }
  }

  private async readFinalizationState(
    expectedTask: IngestionTaskRecord,
    expectedFile: IngestionTaskFileRecord,
    expectedSnapshot?: IngestionSourceSnapshot,
  ): Promise<{ readonly task: IngestionTaskRecord; readonly committed: boolean }> {
    try {
      const stored = await this.dependencies.repository.readTask(expectedTask.workspaceId, expectedTask.taskId);
      if (!stored) throw new Error();
      const task = normalizeIngestionTaskRecord(stored);
      if (task.workspaceId !== expectedTask.workspaceId || task.organizationId !== expectedTask.organizationId || task.taskId !== expectedTask.taskId
        || task.kind !== expectedTask.kind || task.createdAt !== expectedTask.createdAt || task.checkpointExpiresAt !== expectedTask.checkpointExpiresAt
        || task.revision < expectedTask.revision || task.files.length !== expectedTask.files.length
        || !expectedTask.files.every(before => task.files.some(after => immutableIngestionFile(after) === immutableIngestionFile(before)))) throw new Error();
      const file = requireFile(task, expectedFile.fileId);
      if (JSON.stringify(file) !== JSON.stringify(expectedFile) || file.status !== "finalized" || !file.output) return { task, committed: false };
      const output = file.output;
      if (output.sourceId !== `source.${task.taskId}.${file.fileId}` || output.sourceSnapshotId !== `snapshot.${task.taskId}.${file.fileId}`) return { task, committed: false };
      const value = await this.dependencies.repository.readSourceSnapshot(task.workspaceId, output.sourceSnapshotId as never);
      if (!value) return { task, committed: false };
      const snapshot = normalizeIngestionSourceSnapshot(value);
      const expectedLocator = task.kind === "file-batch"
        ? { kind: "file", displayName: file.fileName, originalName: file.fileName }
        : task.kind === "hugging-face" && file.providerSource
          ? { kind: "hugging-face", displayName: file.fileName, repository: file.providerSource.repository, path: file.providerSource.path, revision: file.providerSource.revision }
          : undefined;
      const committed = snapshot.workspaceId === task.workspaceId && snapshot.organizationId === task.organizationId
        && snapshot.sourceId === output.sourceId && snapshot.snapshotId === output.sourceSnapshotId
        && snapshot.rawArtifactKey === output.key && snapshot.sizeBytes === output.sizeBytes && snapshot.mediaType === output.mediaType
        && snapshot.contentDigest === output.digest && snapshot.providerRevision === output.providerRevision
        && !snapshot.derivedArtifactKeys?.length && !output.derivedArtifactKeys?.length
        && expectedLocator !== undefined && JSON.stringify(snapshot.locator) === JSON.stringify(expectedLocator)
        && (!expectedSnapshot || JSON.stringify(snapshot) === JSON.stringify(normalizeIngestionSourceSnapshot(expectedSnapshot)));
      return { task, committed };
    } catch {
      // Uncertain readback never authorizes compensating deletion or adoption.
      throw new Error("The source commit could not be verified. Its data was retained for recovery.");
    }
  }

  private async markFailed(
    task: IngestionTaskRecord,
    file: IngestionTaskFileRecord,
    code: string,
    message: string,
    context: ApplicationRequestContext,
  ): Promise<IngestionTaskResult> {
    const completedAt = this.now();
    const failed = updateTask(task, {
      status: "failed",
      files: replaceFile(task, file.fileId, {
        ...file,
        status: "failed",
        error: { code, message, retryable: true },
      }),
      updatedAt: completedAt,
      completedAt,
      cleanupPending: true,
      progressMessage: message,
    });
    return createSuccessResult(
      await this.dependencies.repository.saveTask(failed, task.revision),
      context,
    );
  }

  private async requireTask(
    workspaceId: string,
    taskId: ReturnType<typeof normalizeIngestionTaskId>,
  ): Promise<IngestionTaskRecord> {
    const task = await this.dependencies.repository.readTask(
      workspaceId as never,
      taskId,
    );
    if (!task) throw new MissingTaskError();
    return task;
  }

  private async saveIdempotently(
    task: IngestionTaskRecord,
    expectedRevision: number,
    fileId: ReturnType<typeof normalizeIngestionTaskFileId>,
    nextChunkIndex: number,
    digest: string,
  ): Promise<IngestionTaskRecord> {
    try {
      return await this.dependencies.repository.saveTask(
        task,
        expectedRevision,
      );
    } catch (error) {
      const current = await this.dependencies.repository.readTask(
        task.workspaceId,
        task.taskId,
      );
      const file = current?.files.find(
        (candidate) => candidate.fileId === fileId,
      );
      if (
        current &&
        file?.nextChunkIndex === nextChunkIndex &&
        file.lastChunk?.digest === digest
      )
        return current;
      throw error;
    }
  }

  private authorize(
    context: ApplicationRequestContext,
    operation: string,
    scope: "artifact:read" | "artifact:write",
  ) {
    return resolveArtifactWorkspaceContext(
      context,
      this.dependencies.workspaceRepository,
      this.dependencies.workspaceAuthorization
        ? {
            port: this.dependencies.workspaceAuthorization,
            operation,
            requiredScopes: [scope],
          }
        : undefined,
    );
  }
}

class MissingTaskError extends Error {}

function updateTask(
  task: IngestionTaskRecord,
  input: {
    status: IngestionTaskRecord["status"];
    files: readonly IngestionTaskFileRecord[];
    updatedAt: string;
    completedAt?: string;
    cleanupPending?: boolean;
    progressMessage: string;
  },
): IngestionTaskRecord {
  return normalizeIngestionTaskRecord({
    ...task,
    status: input.status,
    files: input.files,
    revision: task.revision + 1,
    updatedAt: input.updatedAt,
    cleanupPending: input.cleanupPending ?? task.cleanupPending,
    progress: { ...task.progress, message: input.progressMessage },
    ...(input.completedAt
      ? { completedAt: input.completedAt }
      : { completedAt: undefined }),
  });
}
function replaceFile(
  task: IngestionTaskRecord,
  fileId: string,
  replacement: IngestionTaskFileRecord,
): readonly IngestionTaskFileRecord[] {
  return task.files.map((file) =>
    file.fileId === fileId ? replacement : file,
  );
}
function requireFile(
  task: IngestionTaskRecord,
  fileId: string,
): IngestionTaskFileRecord {
  const file = task.files.find((candidate) => candidate.fileId === fileId);
  if (!file) throw new Error("The ingestion file was not found in this task.");
  return file;
}
function safeMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message &&
    message.length <= 512 &&
    !/[A-Za-z]:\\|\/Users\/|authorization|cookie|token=/i.test(message)
    ? message
    : fallback;
}
function immutableIngestionFile(file: IngestionTaskFileRecord): string {
  return JSON.stringify({ fileId: file.fileId, checkpointId: file.checkpointId, fileName: file.fileName, mediaType: file.mediaType, totalBytes: file.totalBytes, providerSource: file.providerSource, websiteSource: file.websiteSource });
}
function providerBaseName(value: string): string {
  const parts = String(value).trim().replaceAll("\\", "/").split("/");
  return parts[parts.length - 1] ?? "";
}
function providerMediaType(path: string, mediaType?: string): string {
  const explicit = mediaType?.trim();
  if (explicit) return explicit;
  return path.trim().toLowerCase().endsWith(".parquet")
    ? "application/vnd.apache.parquet"
    : "application/octet-stream";
}
function taskExecution(
  result: IngestionTaskResult,
): IngestionTaskResult<IngestionTaskTransportValue> {
  return result.ok
    ? createSuccessResult({ kind: "task", task: result.value }, result)
    : result;
}
function failure(
  code: "validation" | "not-found" | "unavailable" | "internal" | "forbidden",
  message: string,
  context: ApplicationRequestContext,
): IngestionTaskResult<any> {
  return createFailureResult(
    createContractError(code, message, {
      requestId: context.requestId,
      correlationId: context.correlationId,
    }),
    context,
  );
}
