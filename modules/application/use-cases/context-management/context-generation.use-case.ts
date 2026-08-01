import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import {
  CONTEXT_GENERATION_LIMITS,
  CONTEXT_MARKDOWN_PACK_MEDIA_TYPE,
  CONTEXT_RAG_DATABASE_MEDIA_TYPE,
  evaluateContextSourceCapability,
  normalizeContextSaveName,
  validateStartContextGenerationCommand,
  type ContextArtifactManifest,
  type ContextGenerationPreview,
  type ContextGenerationStatus,
  type ContextSavedArtifactReference,
  type StartContextGenerationCommand,
} from "../../../contracts/context-management";
import {
  createContractError,
  createFailureResult,
  createSuccessResult,
  type ContractErrorCode,
  type ContractResult,
} from "../../../contracts/shared";
import {
  createDeleteArtifactRequest,
  createRetrieveArtifactRequest,
  createStoreArtifactRequest,
  type ArtifactStorageBinding,
} from "../../../contracts/storage";
import {
  TaskType,
  type ContextGenerationTaskRequest,
  type ContextGenerationTaskResult,
  type ContextRuntimeSourceInput,
  type RuntimeTaskStatusRecord,
} from "../../../contracts/runtime";
import type { WorkspaceId } from "../../../contracts/workspace";
import type {
  ArtifactCatalogAppendPort,
  ArtifactCatalogDeletePort,
  ArtifactCatalogReadPort,
} from "../../ports/artifact-catalog";
import type { RuntimeTaskRegistryPort } from "../../ports/runtime";
import type { WorkspaceOperationAuthorizationPort } from "../../ports/security";
import type {
  ArtifactObjectStoragePort,
  ArtifactStorageBindingPort,
} from "../../ports/storage";
import type { WorkspaceRepository } from "../../ports/workspace";
import type { ApplicationRequestContext } from "../../ports";
import type { TaskPowerLifecyclePort } from "../../services/runtime";
import { resolveArtifactWorkspaceContext } from "../artifact-workspace-context";
import { projectContextSourceInformation } from "./context-source-information";

type ContextArtifactCatalogPort = ArtifactCatalogReadPort &
  ArtifactCatalogAppendPort &
  ArtifactCatalogDeletePort;

interface ContextTaskScope {
  readonly workspaceId: WorkspaceId;
  readonly organizationId?: string;
  readonly principalId?: string;
}

interface PendingContextGeneration {
  readonly command: StartContextGenerationCommand;
  readonly runtimeDirectory: string;
  readonly runtimeResult: ContextGenerationTaskResult;
  readonly outputPath: string;
  readonly scope: ContextTaskScope;
}

export interface ContextGenerationUseCaseDependencies {
  readonly runtimeTaskRegistry: RuntimeTaskRegistryPort;
  readonly storageBindings: ArtifactStorageBindingPort;
  readonly storage: ArtifactObjectStoragePort;
  readonly artifactCatalog: ContextArtifactCatalogPort;
  readonly taskPowerLifecycle: TaskPowerLifecyclePort;
  readonly workspaceRepository?: Pick<WorkspaceRepository, "readWorkspace">;
  readonly workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
  readonly now?: () => string;
  readonly createId?: () => string;
}

export interface StartContextGenerationValue {
  readonly requestId: string;
  readonly taskType: "generate-context-artifact";
  readonly accepted: true;
  readonly status: "queued" | "running";
}

const OUTPUT_HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

function sha256(bytes: Uint8Array): string {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function preferredLocalStorageKey(
  artifactId: string,
  bindings: readonly ArtifactStorageBinding[],
): string {
  return (
    bindings.find(
      (binding) =>
        binding.backing.kind === "artifact-object" &&
        (binding.backing.provider === "local" ||
          binding.backing.provider === "local-filesystem") &&
        binding.role === "primary",
    )?.backing.locator ??
    bindings.find(
      (binding) =>
        binding.backing.kind === "artifact-object" &&
        (binding.backing.provider === "local" ||
          binding.backing.provider === "local-filesystem"),
    )?.backing.locator ??
    artifactId
  );
}

function metadataText(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeSourceExtension(originalName: string | undefined): string {
  const extension = extname(originalName ?? "").toLowerCase();
  return /^\.[a-z0-9]{1,12}$/.test(extension) ? extension : ".bin";
}

function isContextGenerationTaskResult(
  value: unknown,
): value is ContextGenerationTaskResult {
  if (
    !isRecord(value) ||
    !isRecord(value.output) ||
    !isRecord(value.manifest)
  ) {
    return false;
  }
  return (
    typeof value.output.name === "string" &&
    typeof value.output.outputHandle === "string" &&
    typeof value.output.mediaType === "string" &&
    typeof value.output.sizeBytes === "number" &&
    Number.isSafeInteger(value.output.sizeBytes) &&
    value.output.sizeBytes > 0 &&
    value.output.sizeBytes <= CONTEXT_GENERATION_LIMITS.maximumArtifactBytes &&
    typeof value.output.digest === "string" &&
    DIGEST_PATTERN.test(value.output.digest) &&
    Array.isArray(value.sourceInspections) &&
    isRecord(value.preview) &&
    Array.isArray(value.preview.items) &&
    typeof value.manifest.schemaVersion === "string" &&
    Array.isArray(value.manifest.sources) &&
    Array.isArray(value.manifest.manualEntries)
  );
}

function validateRuntimeResult(
  result: ContextGenerationTaskResult,
  command: StartContextGenerationCommand,
  expectedSources: readonly ContextRuntimeSourceInput[],
): void {
  const expectedMediaType =
    command.kind === "rag-database"
      ? CONTEXT_RAG_DATABASE_MEDIA_TYPE
      : CONTEXT_MARKDOWN_PACK_MEDIA_TYPE;
  if (
    result.output.mediaType !== expectedMediaType ||
    result.manifest.schemaVersion !== "1" ||
    result.manifest.kind !== command.kind ||
    result.manifest.name !== command.name ||
    result.manifest.mediaType !== expectedMediaType ||
    result.preview.kind !== command.kind ||
    result.preview.name !== command.name ||
    result.preview.sourceCount !== command.sources.length ||
    result.preview.manualEntryCount !== (command.manualEntries?.length ?? 0) ||
    result.preview.items.length >
      CONTEXT_GENERATION_LIMITS.maximumPreviewItems ||
    result.sourceInspections.length !== command.sources.length ||
    result.manifest.sources.length !== command.sources.length
  ) {
    throw new Error("Context generation returned mismatched review evidence.");
  }
  const previewCharacters = result.preview.items.reduce(
    (total, item) => total + item.text.length,
    0,
  );
  if (
    previewCharacters > CONTEXT_GENERATION_LIMITS.maximumPreviewCharacters ||
    result.preview.chunkCount < 1 ||
    result.preview.chunkCount > CONTEXT_GENERATION_LIMITS.maximumChunkCount
  ) {
    throw new Error("Context generation preview exceeds safe bounds.");
  }
  for (const [index, source] of command.sources.entries()) {
    const expected = expectedSources[index];
    if (
      !expected ||
      result.sourceInspections[index]?.artifactId !== source.artifactId ||
      result.manifest.sources[index]?.artifactId !== source.artifactId ||
      result.sourceInspections[index]?.digest !== expected.sourceDigest ||
      result.manifest.sources[index]?.digest !== expected.sourceDigest ||
      result.sourceInspections[index]?.sizeBytes !== expected.sizeBytes ||
      result.manifest.sources[index]?.sizeBytes !== expected.sizeBytes ||
      result.sourceInspections[index]?.mediaType !== expected.mediaType ||
      result.manifest.sources[index]?.mediaType !== expected.mediaType ||
      result.sourceInspections[index]?.ready !== true
    ) {
      throw new Error("Context generation source evidence is incomplete.");
    }
  }
  if (command.contextPack) {
    const actual = result.manifest.contextPack;
    if (
      !actual ||
      actual.inputMode !== command.contextPack.inputMode ||
      actual.method !== command.contextPack.method ||
      actual.cleaningPreset !== command.contextPack.cleaningPreset ||
      actual.maximumSummaryLines !== command.contextPack.maximumSummaryLines ||
      result.manifest.manualEntries.length !==
        (command.manualEntries?.length ?? 0)
    ) {
      throw new Error("Context pack generation evidence is incomplete.");
    }
    for (const [index, entry] of (command.manualEntries ?? []).entries()) {
      const manifestEntry = result.manifest.manualEntries[index];
      if (
        !manifestEntry ||
        manifestEntry.id !== entry.id ||
        manifestEntry.title !== entry.title ||
        manifestEntry.digest !== sha256(Buffer.from(entry.content, "utf8"))
      ) {
        throw new Error("Manual context pack evidence is incomplete.");
      }
    }
  }
}

async function resolveOutputPath(
  runtimeDirectory: string,
  outputHandle: string,
): Promise<string> {
  if (
    !OUTPUT_HANDLE_PATTERN.test(outputHandle) ||
    basename(outputHandle) !== outputHandle ||
    isAbsolute(outputHandle)
  ) {
    throw new Error("Context runtime returned an invalid output handle.");
  }
  const rootStats = await lstat(runtimeDirectory);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error("Context runtime directory is invalid.");
  }
  const canonicalRoot = await realpath(runtimeDirectory);
  const candidate = resolve(canonicalRoot, outputHandle);
  const relativeCandidate = relative(canonicalRoot, candidate);
  if (relativeCandidate.startsWith("..") || isAbsolute(relativeCandidate)) {
    throw new Error("Context runtime output escaped its working directory.");
  }
  const candidateStats = await lstat(candidate);
  if (
    candidateStats.isSymbolicLink() ||
    !candidateStats.isFile() ||
    candidateStats.nlink !== 1
  ) {
    throw new Error("Context runtime output must be a private regular file.");
  }
  const canonicalCandidate = await realpath(candidate);
  const canonicalRelative = relative(canonicalRoot, canonicalCandidate);
  if (canonicalRelative.startsWith("..") || isAbsolute(canonicalRelative)) {
    throw new Error("Context runtime output escaped its working directory.");
  }
  return canonicalCandidate;
}

function scopeFromContext(
  workspaceId: WorkspaceId,
  context?: ApplicationRequestContext,
): ContextTaskScope {
  return {
    workspaceId,
    ...(context?.organizationId
      ? { organizationId: String(context.organizationId) }
      : {}),
    ...(context?.principalId
      ? { principalId: String(context.principalId) }
      : {}),
  };
}

function ownsScope(
  scope: ContextTaskScope,
  context?: ApplicationRequestContext,
): boolean {
  return (
    context?.workspaceId === scope.workspaceId &&
    (scope.organizationId === undefined ||
      scope.organizationId === String(context.organizationId ?? "")) &&
    (scope.principalId === undefined ||
      scope.principalId === String(context.principalId ?? ""))
  );
}

export class ContextGenerationUseCase {
  private readonly runtime: RuntimeTaskRegistryPort;
  private readonly bindings: ArtifactStorageBindingPort;
  private readonly storage: ArtifactObjectStoragePort;
  private readonly catalog: ContextArtifactCatalogPort;
  private readonly taskPower: TaskPowerLifecyclePort;
  private readonly workspaceRepository?: Pick<
    WorkspaceRepository,
    "readWorkspace"
  >;
  private readonly workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly runtimeDirectories = new Map<string, string>();
  private readonly commands = new Map<string, StartContextGenerationCommand>();
  private readonly sourceInputs = new Map<
    string,
    readonly ContextRuntimeSourceInput[]
  >();
  private readonly scopes = new Map<string, ContextTaskScope>();
  private readonly pending = new Map<string, PendingContextGeneration>();
  private readonly completed = new Map<string, ContextGenerationStatus>();

  public constructor(dependencies: ContextGenerationUseCaseDependencies) {
    this.runtime = dependencies.runtimeTaskRegistry;
    this.bindings = dependencies.storageBindings;
    this.storage = dependencies.storage;
    this.catalog = dependencies.artifactCatalog;
    this.taskPower = dependencies.taskPowerLifecycle;
    this.workspaceRepository = dependencies.workspaceRepository;
    this.workspaceAuthorization = dependencies.workspaceAuthorization;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.createId = dependencies.createId ?? randomUUID;
  }

  private resolveWorkspace(
    context: ApplicationRequestContext | undefined,
    operation: string,
    scope: "artifact:read" | "artifact:write",
  ) {
    return resolveArtifactWorkspaceContext(
      context,
      this.workspaceRepository,
      this.workspaceAuthorization
        ? {
            port: this.workspaceAuthorization,
            operation,
            requiredScopes: [scope],
          }
        : undefined,
    );
  }

  public async start(
    command: StartContextGenerationCommand,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<StartContextGenerationValue>> {
    const workspace = await this.resolveWorkspace(
      context,
      "context.generate",
      "artifact:read",
    );
    if (!workspace.ok) {
      return workspace;
    }
    let normalized: StartContextGenerationCommand;
    try {
      normalized = validateStartContextGenerationCommand(command);
    } catch (error) {
      return createFailureResult(
        createContractError(
          "validation",
          error instanceof Error
            ? error.message
            : "Context generation settings are invalid.",
        ),
        context,
      );
    }
    const staged = await this.stageSources(normalized, context);
    if (!staged.ok) {
      return staged;
    }
    const runtimeRequest: ContextGenerationTaskRequest = {
      workspaceId: workspace.value.workspaceId,
      kind: normalized.kind,
      name: normalized.name,
      sources: staged.value.sources,
      manualEntries: (normalized.manualEntries ?? []).map((entry) => ({
        ...entry,
        digest: sha256(Buffer.from(entry.content, "utf8")),
      })),
      chunking: normalized.chunking,
      ...(normalized.sourceChecks
        ? { sourceChecks: normalized.sourceChecks }
        : {}),
      ...(normalized.embedding ? { embedding: normalized.embedding } : {}),
      ...(normalized.contextPack
        ? { contextPack: normalized.contextPack }
        : {}),
      runtime: {
        runtimeWorkingDirectory: staged.value.runtimeDirectory,
      },
    };
    try {
      const started = await this.runtime.startTask({
        requestId: context?.requestId,
        taskType: TaskType.CONTEXT_GENERATION,
        payload: runtimeRequest,
        workspaceId: workspace.value.workspaceId,
        metadata: {
          workspaceId: workspace.value.workspaceId,
          ...(context?.organizationId
            ? { organizationId: String(context.organizationId) }
            : {}),
        },
      });
      if (!started.requestId?.trim()) {
        throw new Error("Context generation start response is incomplete.");
      }
      this.runtimeDirectories.set(
        started.requestId,
        staged.value.runtimeDirectory,
      );
      this.commands.set(started.requestId, normalized);
      this.sourceInputs.set(started.requestId, staged.value.sources);
      this.scopes.set(
        started.requestId,
        scopeFromContext(workspace.value.workspaceId, context),
      );
      await this.taskPower.startTask(
        started.requestId,
        TaskType.CONTEXT_GENERATION,
        "Generating context artifact",
      );
      return createSuccessResult(
        {
          requestId: started.requestId,
          taskType: "generate-context-artifact",
          accepted: true,
          status: started.status ?? "queued",
        },
        context,
      );
    } catch (error) {
      await rm(staged.value.runtimeDirectory, {
        recursive: true,
        force: true,
      });
      return createFailureResult(
        createContractError(
          "internal",
          error instanceof Error
            ? error.message
            : "Context generation could not be started.",
        ),
        context,
      );
    }
  }

  public async read(
    requestId: string,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<ContextGenerationStatus>> {
    const workspace = await this.resolveWorkspace(
      context,
      "context.read",
      "artifact:read",
    );
    if (!workspace.ok) {
      return workspace;
    }
    const scope = this.scopes.get(requestId);
    if (!scope || !ownsScope(scope, context)) {
      return createFailureResult(
        createContractError(
          "not-found",
          "Context generation task was not found.",
        ),
        context,
      );
    }
    const cached = this.completed.get(requestId);
    if (cached) {
      return createSuccessResult(cached, context);
    }
    const pending = this.pending.get(requestId);
    if (pending) {
      return createSuccessResult(
        {
          requestId,
          state: "review-required",
          sourceInspections: pending.runtimeResult.sourceInspections,
          preview: pending.runtimeResult.preview,
          manifest: pending.runtimeResult.manifest,
        },
        context,
      );
    }
    try {
      const status = await this.runtime.getTaskStatus(requestId);
      if ("recordType" in status) {
        return createFailureResult(
          createContractError(
            "not-found",
            "Context generation task was not found.",
          ),
          context,
        );
      }
      if (
        status.workspaceId !== undefined &&
        status.workspaceId !== workspace.value.workspaceId
      ) {
        return createFailureResult(
          createContractError(
            "not-found",
            "Context generation task was not found.",
          ),
          context,
        );
      }
      if (status.status === "succeeded") {
        const command = this.commands.get(requestId);
        const directory = this.runtimeDirectories.get(requestId);
        const expectedSources = this.sourceInputs.get(requestId);
        if (
          !command ||
          !directory ||
          !expectedSources ||
          !isContextGenerationTaskResult(status.data)
        ) {
          throw new Error(
            "Context generation completion evidence is unavailable.",
          );
        }
        validateRuntimeResult(status.data, command, expectedSources);
        const outputPath = await resolveOutputPath(
          directory,
          status.data.output.outputHandle,
        );
        const outputStats = await stat(outputPath);
        if (
          outputStats.size !== status.data.output.sizeBytes ||
          outputStats.size > CONTEXT_GENERATION_LIMITS.maximumArtifactBytes
        ) {
          throw new Error("Context runtime output size does not match.");
        }
        const outputBytes = new Uint8Array(await readFile(outputPath));
        if (sha256(outputBytes) !== status.data.output.digest) {
          throw new Error("Context runtime output digest does not match.");
        }
        this.pending.set(requestId, {
          command,
          runtimeDirectory: directory,
          runtimeResult: status.data,
          outputPath,
          scope,
        });
        await this.taskPower.completeTask(requestId, "succeeded");
        return createSuccessResult(
          {
            requestId,
            state: "review-required",
            sourceInspections: status.data.sourceInspections,
            preview: status.data.preview,
            manifest: status.data.manifest,
          },
          context,
        );
      }
      if (status.status === "failed" || status.status === "cancelled") {
        await this.taskPower.completeTask(requestId, status.status);
        await this.cleanup(requestId);
        const terminal: ContextGenerationStatus = {
          requestId,
          state: status.status,
          ...(status.status === "failed"
            ? {
                error: {
                  code: status.error?.code ?? "context_generation_failed",
                  message:
                    status.error?.message ??
                    "Context generation failed. Review diagnostics and retry.",
                  retryable: status.error?.retryable === true,
                },
              }
            : {}),
        };
        this.completed.set(requestId, terminal);
        return createSuccessResult(terminal, context);
      }
      return createSuccessResult(
        {
          requestId,
          state: status.status === "running" ? "running" : "queued",
          ...(status.progress
            ? {
                progress: {
                  message: status.progress.message,
                  current: status.progress.current,
                  total: status.progress.total,
                  unit: status.progress.unit === "chunk" ? "chunk" : undefined,
                  percent: status.progress.percent,
                },
              }
            : {}),
        },
        context,
      );
    } catch (error) {
      await this.taskPower.completeTask(requestId, "failed");
      await this.cleanup(requestId);
      return createFailureResult(
        createContractError(
          "internal",
          error instanceof Error
            ? error.message
            : "Context generation status could not be read.",
        ),
        context,
      );
    }
  }

  public async save(
    requestId: string,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<ContextGenerationStatus>> {
    const workspace = await this.resolveWorkspace(
      context,
      "context.save",
      "artifact:write",
    );
    if (!workspace.ok) {
      return workspace;
    }
    const pending = this.pending.get(requestId);
    if (!pending || !ownsScope(pending.scope, context)) {
      return createFailureResult(
        createContractError(
          "not-found",
          "Context generation review was not found.",
        ),
        context,
      );
    }
    let storageKey: string | undefined;
    let catalogAppended = false;
    try {
      const outputBytes = new Uint8Array(await readFile(pending.outputPath));
      const output = pending.runtimeResult.output;
      if (
        outputBytes.byteLength !== output.sizeBytes ||
        sha256(outputBytes) !== output.digest
      ) {
        throw new Error("Context artifact changed after review.");
      }
      const generatedId = this.createId().replace(/[^A-Za-z0-9._-]+/g, "-");
      if (!generatedId) {
        throw new Error("Context artifact identifier could not be created.");
      }
      storageKey = join(
        "generated",
        "context",
        generatedId,
        output.name,
      ).replace(/\\/g, "/");
      const stored = await this.storage.storeArtifact(
        createStoreArtifactRequest(outputBytes, {
          descriptor: {
            key: storageKey,
            mediaType: output.mediaType,
            checksum: {
              algorithm: "sha256",
              value: output.digest.slice("sha256:".length),
            },
            metadata: {
              workspaceId: workspace.value.workspaceId,
              originalFileName: output.name,
              artifactFamily: "binary",
              sourceKind: "generated",
              contextKind: pending.command.kind,
              contextName: pending.command.name,
              sourceArtifactIds: pending.command.sources.map(
                (source) => source.artifactId,
              ),
            },
          },
        }),
        context,
      );
      if (!stored.ok) {
        throw new Error(stored.error.message);
      }
      storageKey = String(stored.value.key);
      const catalogResult = await this.catalog.appendArtifactCatalogRecord(
        {
          record: {
            workspaceId: workspace.value.workspaceId,
            storageKey,
            artifactFamily: "binary",
            mediaType: output.mediaType,
            sizeBytes: output.sizeBytes,
            sourceKind: "generated",
            originalName: output.name,
            createdAt: this.now(),
            checksum: {
              algorithm: "sha256",
              value: output.digest.slice("sha256:".length),
            },
          },
        },
        context,
      );
      if (!catalogResult.ok) {
        throw new Error(catalogResult.error.message);
      }
      catalogAppended = true;
      const binding = await this.bindings.upsertArtifactStorageBinding(
        {
          binding: {
            workspaceId: workspace.value.workspaceId,
            artifactId: storageKey,
            backing: {
              kind: "artifact-object",
              provider: "local-filesystem",
              locator: storageKey,
            },
            role: "primary",
            createdAt: this.now(),
          },
        },
        context,
      );
      if (!binding.ok) {
        throw new Error(binding.error.message);
      }
      const savedArtifact: ContextSavedArtifactReference = {
        artifactId: storageKey,
        storageKey,
        kind: pending.command.kind,
        name: pending.command.name,
        mediaType:
          pending.command.kind === "rag-database"
            ? CONTEXT_RAG_DATABASE_MEDIA_TYPE
            : CONTEXT_MARKDOWN_PACK_MEDIA_TYPE,
        sizeBytes: output.sizeBytes,
        digest: output.digest,
      };
      const completed: ContextGenerationStatus = {
        requestId,
        state: "saved",
        sourceInspections: pending.runtimeResult.sourceInspections,
        preview: pending.runtimeResult.preview,
        manifest: pending.runtimeResult.manifest,
        savedArtifact,
      };
      await this.cleanup(requestId);
      this.completed.set(requestId, completed);
      return createSuccessResult(completed, context);
    } catch (error) {
      if (storageKey) {
        if (catalogAppended) {
          await this.catalog.deleteArtifactCatalogRecord(
            { workspaceId: workspace.value.workspaceId, storageKey },
            context,
          );
        }
        await this.storage.deleteArtifact(
          createDeleteArtifactRequest(storageKey),
          context,
        );
      }
      return createFailureResult(
        createContractError(
          "internal",
          error instanceof Error
            ? error.message
            : "Context artifact could not be saved.",
        ),
        context,
      );
    }
  }

  public async discard(
    requestId: string,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<ContextGenerationStatus>> {
    const workspace = await this.resolveWorkspace(
      context,
      "context.discard",
      "artifact:write",
    );
    if (!workspace.ok) {
      return workspace;
    }
    const pending = this.pending.get(requestId);
    if (!pending || !ownsScope(pending.scope, context)) {
      return createFailureResult(
        createContractError(
          "not-found",
          "Context generation review was not found.",
        ),
        context,
      );
    }
    await this.cleanup(requestId);
    const discarded: ContextGenerationStatus = {
      requestId,
      state: "discarded",
    };
    this.completed.set(requestId, discarded);
    return createSuccessResult(discarded, context);
  }

  public async cancel(
    requestId: string,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<ContextGenerationStatus>> {
    const workspace = await this.resolveWorkspace(
      context,
      "context.cancel",
      "artifact:write",
    );
    if (!workspace.ok) {
      return workspace;
    }
    const scope = this.scopes.get(requestId);
    if (!scope || !ownsScope(scope, context)) {
      return createFailureResult(
        createContractError(
          "not-found",
          "Context generation task was not found.",
        ),
        context,
      );
    }
    const result = await this.runtime.cancelTask(requestId);
    if (result.status === "cancelled") {
      await this.taskPower.completeTask(requestId, "cancelled");
      await this.cleanup(requestId);
      const cancelled: ContextGenerationStatus = {
        requestId,
        state: "cancelled",
      };
      this.completed.set(requestId, cancelled);
      return createSuccessResult(cancelled, context);
    }
    return createSuccessResult(
      {
        requestId,
        state: "running",
        progress: { message: result.message },
      },
      context,
    );
  }

  private async cleanup(requestId: string): Promise<void> {
    const directory = this.runtimeDirectories.get(requestId);
    this.runtimeDirectories.delete(requestId);
    this.commands.delete(requestId);
    this.sourceInputs.delete(requestId);
    this.pending.delete(requestId);
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async stageSources(
    command: StartContextGenerationCommand,
    context?: ApplicationRequestContext,
  ): Promise<
    ContractResult<{
      runtimeDirectory: string;
      sources: readonly ContextRuntimeSourceInput[];
    }>
  > {
    const runtimeDirectory = await mkdtemp(
      join(tmpdir(), "ai-system-builder-context-"),
    );
    const sources: ContextRuntimeSourceInput[] = [];
    let aggregateBytes = 0;
    const fail = async (code: ContractErrorCode, message: string) => {
      await rm(runtimeDirectory, { recursive: true, force: true });
      return createFailureResult(createContractError(code, message), context);
    };
    try {
      for (const [index, source] of command.sources.entries()) {
        const bindingResult = await this.bindings.readArtifactStorageBindings(
          {
            workspaceId: context?.workspaceId as WorkspaceId,
            artifactId: source.artifactId,
          },
          context,
        );
        if (!bindingResult.ok && bindingResult.error.code !== "not-found") {
          return fail(bindingResult.error.code, bindingResult.error.message);
        }
        const storageKey = preferredLocalStorageKey(
          source.artifactId,
          bindingResult.ok ? bindingResult.value.bindings : [],
        );
        const retrieved = await this.storage.retrieveArtifact<Uint8Array>(
          createRetrieveArtifactRequest(storageKey, {
            maximumBytes: CONTEXT_GENERATION_LIMITS.maximumSourceBytes,
          }),
          context,
        );
        if (!retrieved.ok) {
          return fail(retrieved.error.code, retrieved.error.message);
        }
        if (!(retrieved.value.content instanceof Uint8Array)) {
          return fail("internal", "Context source bytes are unavailable.");
        }
        const bytes = retrieved.value.content;
        aggregateBytes += bytes.byteLength;
        if (
          bytes.byteLength < 1 ||
          bytes.byteLength > CONTEXT_GENERATION_LIMITS.maximumSourceBytes ||
          aggregateBytes > CONTEXT_GENERATION_LIMITS.maximumAggregateSourceBytes
        ) {
          return fail(
            "validation",
            "Selected context sources exceed the safe size limit.",
          );
        }
        const descriptor = retrieved.value.descriptor;
        const sourceInformation = projectContextSourceInformation(
          descriptor.metadata,
        );
        const descriptorOriginalName =
          metadataText(descriptor.metadata, "originalFileName") ??
          metadataText(descriptor.metadata, "originalName");
        const catalog = await this.catalog.readArtifactCatalogRecord(
          {
            workspaceId: context?.workspaceId as WorkspaceId,
            storageKey,
          },
          context,
        );
        const originalName =
          descriptorOriginalName ??
          (catalog.ok ? catalog.value.record.originalName : undefined);
        const mediaType =
          descriptor.mediaType ??
          (catalog.ok ? catalog.value.record.mediaType : undefined);
        const capability = evaluateContextSourceCapability({
          fileName: originalName ?? storageKey,
          mediaType,
        });
        if (!capability.ready || !capability.capability) {
          return fail(
            "validation",
            [capability.message, capability.action].filter(Boolean).join(" "),
          );
        }
        const effectiveMediaType =
          mediaType ?? capability.capability.mediaTypes[0];
        const localPath = join(
          runtimeDirectory,
          "source-" +
            String(index).padStart(4, "0") +
            safeSourceExtension(originalName ?? storageKey),
        );
        await writeFile(localPath, Buffer.from(bytes));
        sources.push({
          artifactId: source.artifactId,
          localPath,
          mediaType: effectiveMediaType,
          ...(originalName ? { originalName } : {}),
          sourceDigest: sha256(bytes),
          sizeBytes: bytes.byteLength,
          ...(sourceInformation ? { sourceInformation } : {}),
        });
      }
      return createSuccessResult({ runtimeDirectory, sources }, context);
    } catch (error) {
      return fail(
        "internal",
        error instanceof Error
          ? error.message
          : "Context sources could not be staged.",
      );
    }
  }
}
