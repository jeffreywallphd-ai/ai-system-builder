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
  normalizeContextSourceChecks,
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
import type { OwnedTaskLease, OwnedTaskReconcilerService } from "../../services/runtime/owned-task-reconciler.service";
import type { TaskPowerLifecyclePort } from "../../services/runtime";
import { resolveArtifactWorkspaceContext } from "../artifact-workspace-context";
import { projectContextSourceInformation } from "./context-source-information";
import {APPROVED_CONTEXT_MAX_PENDING, APPROVED_CONTEXT_MAX_SOURCE_BYTES, APPROVED_CONTEXT_MAX_TASK_HISTORY,
  type ApprovedContextGenerationAdmission, type ApprovedContextEmbeddingModelResolverPort,
  type ApprovedContextResultSaveAdmission, type ContextResultByteStoragePort,
  type ContextResultOutputSourcePort, type PreparedContextResultReview} from "../../ports/context-management";
import {approvedContextAdmissionCurrent, contextCommandDigest, readApprovedContextAdmission} from "./approved-context-generation-admission";
import {readHeadlessContextTaskValue, type HeadlessContextTaskReview, type HeadlessContextTaskValue} from "../../../contracts/headless/headless-context-task";

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

interface ContextStartAttempt {
  readonly admission?: ApprovedContextGenerationAdmission;
  lease?: OwnedTaskLease;
  leaseStarted: boolean;
  retained: boolean;
  issued: boolean;
  dispatchAttempted: boolean;
  runtimeDirectory?: string;
  requestedId?: string;
  confirmedRequestId?: string;
}

export interface ContextGenerationUseCaseDependencies {
  readonly resultBytes?: ContextResultByteStoragePort;
  readonly resultSource?: ContextResultOutputSourcePort;
  readonly embeddingModels?: ApprovedContextEmbeddingModelResolverPort;
  readonly runtimeTaskRegistry: RuntimeTaskRegistryPort;
  readonly taskReconciler?: OwnedTaskReconcilerService;
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

/** Internal owning-call evidence only; never parsed from a runtime/client reply. */
export type AdmittedContextStartResult = ContractResult<StartContextGenerationValue> & {
  readonly admittedStartOutcome?: "not-started";
};

const OUTPUT_HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

// Only code-owned Save messages may cross the transport boundary. Port and
// filesystem exceptions can contain private staged content or local paths.
class ContextSaveFailure extends Error {}

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
  boundSourceLicenses = false,
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
    if (boundSourceLicenses) {
      const includeAttribution = command.kind !== "rag-database" || command.sourceChecks?.includeSourceAttribution === true;
      if (result.sourceInspections[index]?.sourceInformation?.license !== expected.sourceInformation?.license ||
          (includeAttribution ? result.manifest.sources[index]?.sourceInformation?.license !== expected.sourceInformation?.license
            : result.manifest.sources[index]?.sourceInformation !== undefined))
        throw new Error("Context generation declared source license changed.");
    }
  }
  if (boundSourceLicenses && command.embedding) {
    const embedding = result.manifest.embedding;
    if (!embedding || embedding.provider !== command.embedding.provider || embedding.modelId !== command.embedding.modelId ||
        Object.keys(embedding).some(key => !["provider", "modelId", "dimensions"].includes(key)) ||
        (embedding.dimensions !== undefined && (!Number.isSafeInteger(embedding.dimensions) || embedding.dimensions < 1 || embedding.dimensions > 8192)) ||
        (command.embedding.dimensions !== undefined && embedding.dimensions !== command.embedding.dimensions) ||
        !result.manifest.sourceChecks || Object.keys(result.manifest.sourceChecks).some(key =>
          !["preset", "allowedLanguages", "requireLicenseMetadata", "requireConsentMetadata", "includeSourceAttribution"].includes(key)) ||
        JSON.stringify(normalizeContextSourceChecks(result.manifest.sourceChecks)) !== JSON.stringify(normalizeContextSourceChecks(command.sourceChecks!)))
      throw new Error("Context generation returned mismatched embedding evidence.");
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
  private readonly actions = new Map<string, Promise<unknown>>();
  private async serialize<T>(requestId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.actions.get(requestId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.actions.set(requestId, current);
    try { return await current; } finally { if (this.actions.get(requestId) === current) this.actions.delete(requestId); }
  }
  private async reviewAction(requestId: string, context: ApplicationRequestContext | undefined, action: "save" | "discard" | "cancel"): Promise<ContractResult<ContextGenerationStatus>> {
    const workspace = await this.resolveWorkspace(context, `context.${action}`, "artifact:write");
    if (!workspace.ok) return workspace;
    const scope = this.scopes.get(requestId);
    if (!scope || !ownsScope(scope, context)) return createFailureResult(createContractError("not-found", "Context generation task was not found."), context);
    return this.serialize(requestId, async () => {
      if (this.admittedSaves.has(requestId) && this.admittedSaves.get(requestId)!.phase !== "complete")
        return createFailureResult(createContractError("unavailable", "The approved Context save is unconfirmed. Its output is retained."), context);
      const cached = this.completed.get(requestId);
      if (cached) {
        if (action === "cancel" || cached.state === (action === "save" ? "saved" : "discarded")) return createSuccessResult(cached, context);
        return createFailureResult(createContractError("conflict", "Context generation review has already been resolved."), context);
      }
      return action === "save" ? this.performSave(requestId, context) : action === "discard" ? this.performDiscard(requestId, context) : this.performCancel(requestId, context);
    });
  }
  private readonly reads = new Map<string, Promise<ContractResult<ContextGenerationStatus>>>();
  private readonly taskReconciler?: OwnedTaskReconcilerService;
  private readonly runtime: RuntimeTaskRegistryPort;
  private readonly embeddingModels?: ApprovedContextEmbeddingModelResolverPort;
  private readonly resultBytes?: ContextResultByteStoragePort;
  private readonly resultSource?: ContextResultOutputSourcePort;
  private readonly admittedSaves = new Map<string, {effectId: string; reportFingerprint: string;
    phase: "reserving" | "issued" | "unconfirmed" | "complete"}>();
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
  private readonly saveCleanup = new Map<string, { storageKey: string; workspaceId: WorkspaceId }>();
  private readonly commands = new Map<string, StartContextGenerationCommand>();
  private readonly sourceInputs = new Map<
    string,
    readonly ContextRuntimeSourceInput[]
  >();
  private readonly scopes = new Map<string, ContextTaskScope>();
  private readonly pending = new Map<string, PendingContextGeneration>();
  private readonly completed = new Map<string, ContextGenerationStatus>();
  private readonly uncertainStarts = new Set<ContextStartAttempt>();
  private readonly admittedStarts = new Map<string, ContextStartAttempt>();
  private readonly issuedTaskIds = new Set<string>();
  private readonly confirmedAdmittedTaskIds = new Set<string>();
  private readonly pendingPowerStarts = new Map<string, Promise<void>>();

  public constructor(dependencies: ContextGenerationUseCaseDependencies) {
    this.resultBytes = dependencies.resultBytes;
    this.resultSource = dependencies.resultSource;
    this.runtime = dependencies.runtimeTaskRegistry;
    this.embeddingModels = dependencies.embeddingModels;
    this.taskReconciler = dependencies.taskReconciler;
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

  public async start(command: StartContextGenerationCommand, context?: ApplicationRequestContext): Promise<ContractResult<StartContextGenerationValue>> {
    return this.runStartAttempt(command, context, {leaseStarted: false, retained: false, issued: false, dispatchAttempted: false});
  }

  /** Internal capability only. The host must supply exact current one-use plan admission. */
  public async startAdmittedContext(rawCommand: StartContextGenerationCommand, rawContext: ApplicationRequestContext,
    rawAdmission: ApprovedContextGenerationAdmission): Promise<AdmittedContextStartResult> {
    const context = {...rawContext};
    const parsed = readApprovedContextAdmission(rawCommand, context, rawAdmission);
    // A duplicate/invalid admission may refer to an existing or uncertain task.
    // It must never manufacture evidence that that task did not start.
    if (!parsed || this.admittedStarts.has(parsed.admission.taskId) || this.issuedTaskIds.has(parsed.admission.taskId) ||
        this.scopes.has(parsed.admission.taskId) || [...this.uncertainStarts].some(attempt => attempt.requestedId === parsed.admission.taskId))
      return this.startUnavailable(context);
    if (!this.taskReconciler || !this.runtime.startTaskWithoutInstalling ||
        (parsed.command.kind === "rag-database" && !this.embeddingModels) || this.admittedStarts.size >= APPROVED_CONTEXT_MAX_PENDING ||
        this.issuedTaskIds.size >= APPROVED_CONTEXT_MAX_TASK_HISTORY)
      return {...this.startUnavailable(context), admittedStartOutcome: "not-started"};
    const attempt: ContextStartAttempt = {admission: parsed.admission, leaseStarted: false, retained: false, issued: false, dispatchAttempted: false};
    this.admittedStarts.set(parsed.admission.taskId, attempt);
    const result = await this.runStartAttempt(parsed.command, context, attempt);
    return !result.ok && !attempt.dispatchAttempted && !attempt.retained
      ? {...result, admittedStartOutcome: "not-started"} : result;
  }

  private startUnavailable(context?: ApplicationRequestContext): ContractResult<StartContextGenerationValue> {
    return createFailureResult(createContractError("unavailable", "Context generation could not be admitted safely."), context);
  }

  private async runStartAttempt(command: StartContextGenerationCommand, context: ApplicationRequestContext | undefined,
    attempt: ContextStartAttempt): Promise<ContractResult<StartContextGenerationValue>> {
    const run = async (lease?: OwnedTaskLease) => {
      attempt.lease = lease;
      try {
        if (attempt.admission && !await approvedContextAdmissionCurrent(attempt.admission))
          return createFailureResult(createContractError("forbidden", "Context generation permission changed."), context);
        return await this.startOwned(command, context, attempt);
      } catch {
        if (attempt.dispatchAttempted || attempt.issued) this.retainUnconfirmedStart(attempt);
        return this.startUnavailable(context);
      } finally {
        if (!attempt.retained && attempt.runtimeDirectory) {
          try {await rm(attempt.runtimeDirectory, {recursive: true, force: true}); attempt.runtimeDirectory = undefined;}
          catch {this.retainUnconfirmedStart(attempt);}
        }
        if (!attempt.retained && attempt.admission) this.admittedStarts.delete(attempt.admission.taskId);
      }
    };
    try {
      if (this.uncertainStarts.size >= APPROVED_CONTEXT_MAX_PENDING) return this.startUnavailable(context);
      return this.taskReconciler ? await this.taskReconciler.withLease("python", run) : await run();
    } catch {return this.startUnavailable(context);}
    finally {
      if (!attempt.retained && attempt.admission) this.admittedStarts.delete(attempt.admission.taskId);
    }
  }

  private retainUnconfirmedStart(attempt: ContextStartAttempt): void {
    attempt.retained = true;
    // A known accepted task already has its normal scoped reconciliation. Do not
    // replace it with a discovery/status lookup for a guessed or changed ID.
    if (attempt.confirmedRequestId && attempt.leaseStarted) return;
    this.uncertainStarts.add(attempt);
    if (attempt.leaseStarted || !attempt.lease) return;
    attempt.lease.start(async () => false, async () => undefined, async () => {
      if (attempt.runtimeDirectory) await rm(attempt.runtimeDirectory, {recursive: true, force: true});
      attempt.runtimeDirectory = undefined;
      this.uncertainStarts.delete(attempt);
      if (attempt.admission) this.admittedStarts.delete(attempt.admission.taskId);
    });
    attempt.leaseStarted = true;
  }

  private async startOwned(
    command: StartContextGenerationCommand,
    context?: ApplicationRequestContext,
    attempt: ContextStartAttempt = {leaseStarted: false, retained: false, issued: false, dispatchAttempted: false},
  ): Promise<ContractResult<StartContextGenerationValue>> {
    const lease = attempt.lease;
    const workspace = await this.resolveWorkspace(
      context,
      "context.generate",
      "artifact:read",
    );
    if (!workspace.ok) {
      return workspace;
    }
    if (!attempt.admission && context?.requestId && this.issuedTaskIds.has(context.requestId)) return this.startUnavailable(context);
    let normalized: StartContextGenerationCommand;
    try {
      normalized = validateStartContextGenerationCommand(command);
      if (normalized.embedding && Object.prototype.hasOwnProperty.call(normalized.embedding, "localModelReference"))
        throw new Error("RAG embedding settings contain an internal-only model reference.");
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
    let localModelReference: string | undefined;
    if (attempt.admission?.embeddingModel) {
      if (!context || !this.embeddingModels || !await approvedContextAdmissionCurrent(attempt.admission)) return this.startUnavailable(context);
      const resolved = await this.embeddingModels.resolveExistingModel(attempt.admission.embeddingModel, context,
        () => approvedContextAdmissionCurrent(attempt.admission!));
      if (!await approvedContextAdmissionCurrent(attempt.admission) || !resolved || typeof resolved.localModelReference !== "string" ||
          !isAbsolute(resolved.localModelReference) || resolved.localModelReference.length > 4096 ||
          /^[\\/]{2}/u.test(resolved.localModelReference) || /[\u0000-\u001f\u007f]/u.test(resolved.localModelReference)) return this.startUnavailable(context);
      localModelReference = resolved.localModelReference;
    }
    const staged = await this.stageSources(normalized, context, attempt);
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
      ...(normalized.embedding ? { embedding: {provider: normalized.embedding.provider, modelId: normalized.embedding.modelId,
        ...(normalized.embedding.dimensions === undefined ? {} : {dimensions: normalized.embedding.dimensions}),
        ...(normalized.embedding.batchSize === undefined ? {} : {batchSize: normalized.embedding.batchSize}),
        ...(normalized.embedding.device === undefined ? {} : {device: normalized.embedding.device}),
        ...(localModelReference ? {localModelReference} : {})} } : {}),
      ...(normalized.contextPack
        ? { contextPack: normalized.contextPack }
        : {}),
      runtime: {
        runtimeWorkingDirectory: staged.value.runtimeDirectory,
      },
    };
    try {
      if (attempt.admission) {
        if (!await approvedContextAdmissionCurrent(attempt.admission))
          return createFailureResult(createContractError("forbidden", "Context generation permission changed."), context);
        this.taskReconciler!.assertAccepting();
        if (!attempt.admission.isCurrent())
          return createFailureResult(createContractError("forbidden", "Context generation permission changed."), context);
        let issued: "issued" | "denied" | "unconfirmed";
        try {issued = await attempt.admission.issue();} catch {issued = "unconfirmed";}
        if (issued !== "denied") {
          attempt.issued = true;
          this.issuedTaskIds.add(attempt.admission.taskId);
        }
        if (issued !== "issued") {
          if (issued !== "denied") this.retainUnconfirmedStart(attempt);
          return createFailureResult(createContractError(issued === "denied" ? "forbidden" : "unavailable",
            "Context generation admission was not confirmed."), context);
        }
      }
      // Acknowledged issuance is the admission point. Later withdrawal affects
      // replies/remaining steps, while this one owned effect retains its lease.
      this.taskReconciler?.assertAccepting();
      attempt.requestedId = attempt.admission?.taskId ?? context?.requestId;
      attempt.dispatchAttempted = true;
      const request = {
        requestId: attempt.requestedId,
        taskType: TaskType.CONTEXT_GENERATION,
        payload: runtimeRequest,
        workspaceId: workspace.value.workspaceId,
        metadata: {
          workspaceId: workspace.value.workspaceId,
          ...(context?.organizationId
            ? { organizationId: String(context.organizationId) }
            : {}),
        },
      };
      let started;
      if (attempt.admission) {
        const outcome = await this.runtime.startTaskWithoutInstalling!(request);
        if (outcome?.kind === "unavailable" && Object.keys(outcome).length === 1) {
          // The internal port proves no task POST. Issuance stays consumed, but
          // this fresh staging no longer has a possible business-task reader.
          attempt.dispatchAttempted = false;
          return this.startUnavailable(context);
        }
        if (outcome?.kind !== "accepted" || Object.keys(outcome).length !== 2 || !outcome.value)
          throw new Error("Context generation start was not confirmed.");
        started = outcome.value;
      } else started = await this.runtime.startTask(request);
      if (typeof started.requestId !== "string" || !started.requestId.trim() ||
          (attempt.admission && (started.requestId !== attempt.admission.taskId || (started.status !== "queued" && started.status !== "running")))) {
        throw new Error("Context generation start response is incomplete.");
      }
      attempt.confirmedRequestId = started.requestId;
      if (attempt.admission) this.confirmedAdmittedTaskIds.add(started.requestId);
      attempt.retained = true;
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
      const ownedContext = { ...context, workspaceId: workspace.value.workspaceId };
      let finishPowerStart!: () => void;
      const powerStarted = new Promise<void>(resolve => {finishPowerStart = resolve;});
      this.pendingPowerStarts.set(started.requestId, powerStarted);
      try {
        lease?.start(async () => {
          if (this.pendingPowerStarts.has(started.requestId)) return false;
          const result = await this.readOwned(started.requestId, workspace.value.workspaceId, ownedContext);
          return result.ok ? result.value.state !== "queued" && result.value.state !== "running" : !this.runtimeDirectories.has(started.requestId);
        }, () => this.runtime.cancelTask(started.requestId), async () => {
          await powerStarted;
          await this.taskPower.completeTask(started.requestId, "failed");
          if (!this.pending.has(started.requestId)) {
            await this.cleanup(started.requestId);
            this.completed.set(started.requestId, { requestId: started.requestId, state: "failed", error: { code: "host_stopped", message: "The host stopped before context work completed.", retryable: false } });
          }
        });
        attempt.leaseStarted = Boolean(lease);
        await this.taskPower.startTask(
          started.requestId,
          TaskType.CONTEXT_GENERATION,
          "Generating context artifact",
        );
      } finally {
        this.pendingPowerStarts.delete(started.requestId);
        finishPowerStart();
      }
      return createSuccessResult(
        {
          requestId: started.requestId,
          taskType: "generate-context-artifact",
          accepted: true,
          status: started.status ?? "queued",
        },
        context,
      );
    } catch {
      // A thrown/lost reply or later bookkeeping error does not prove that a
      // worker stopped. Only this attempt's owned lifecycle may retire staging.
      if (attempt.dispatchAttempted || attempt.issued) this.retainUnconfirmedStart(attempt);
      return createFailureResult(
        createContractError(
          "internal",
          "Context generation could not be started.",
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
    return this.readOwned(requestId, workspace.value.workspaceId, context);
  }

  /** Accepted-task metadata only. The host separately proves its durable client association. */
  public async readAdmittedContextTask(requestId: string, rawContext: ApplicationRequestContext): Promise<HeadlessContextTaskValue | undefined> {
    const context = {...rawContext}, scope = this.scopes.get(requestId);
    if (!this.confirmedAdmittedTaskIds.has(requestId) || !scope || !context.organizationId || !context.principalId || !ownsScope(scope, context)) return;
    const status = await this.read(requestId, context);
    if (!status.ok || this.scopes.get(requestId) !== scope || !ownsScope(scope, context)) return;
    const review = this.peekAdmittedContextReview(requestId, context);
    return readHeadlessContextTaskValue({taskId: requestId, state: status.value.state, review: review ?? null}, {kind: "task", taskId: requestId});
  }

  /** Pure metadata from already verified, review-required owned output. No materialization or save. */
  public peekAdmittedContextReview(requestId: string, context: ApplicationRequestContext): HeadlessContextTaskReview | undefined {
    const scope = this.scopes.get(requestId), pending = this.pending.get(requestId);
    if (!this.confirmedAdmittedTaskIds.has(requestId) || !scope || !context.organizationId || !context.principalId ||
        !ownsScope(scope, context) || !pending || !ownsScope(pending.scope, context) ||
        (pending.command.kind !== "rag-database" && (pending.command.kind !== "markdown-context-pack" || pending.command.contextPack?.method !== "none"))) return;
    const output = pending.runtimeResult.output, preview = pending.runtimeResult.preview;
    const reportFingerprint = createHash("sha256").update(JSON.stringify({requestId, outputDigest: output.digest, sizeBytes: output.sizeBytes,
      commandDigest: contextCommandDigest(pending.command), sourceCount: preview.sourceCount, chunkCount: preview.chunkCount})).digest("hex");
    return readHeadlessContextTaskValue({taskId: requestId, state: "review-required", review: {reportFingerprint,
      kind: pending.command.kind, sourceCount: preview.sourceCount, chunkCount: preview.chunkCount, sizeBytes: output.sizeBytes,
      requiresExplicitSave: true}}, {kind: "task", taskId: requestId})?.review ?? undefined;
  }

  /** Pure internal save compilation; the host must first prove durable client ownership. */
  public peekAdmittedContextSaveInputs(requestId: string, context: ApplicationRequestContext): PreparedContextResultReview | undefined {
    const review = this.peekAdmittedContextReview(requestId, context), pending = this.pending.get(requestId);
    if (!review || !pending || this.completed.has(requestId) || !this.resultBytes || !this.resultSource) return;
    const {name, outputHandle, mediaType, sizeBytes, digest} = pending.runtimeResult.output;
    if (mediaType !== CONTEXT_MARKDOWN_PACK_MEDIA_TYPE && mediaType !== CONTEXT_RAG_DATABASE_MEDIA_TYPE) return;
    if (typeof name !== "string" || !name || name.length > 201 || basename(name) !== name || /[\\/\x00-\x1f]/.test(name)) return;
    return {review: {...review}, name: pending.command.name, commandDigest: contextCommandDigest(pending.command),
      output: {name, outputHandle, mediaType, sizeBytes, digest}};
  }

  /** One finite admitted byte attempt. Unknown effects cannot be repeated via
   * ordinary save, discard or cancel. The atomic metadata port owns activation. */
  public async saveAdmittedContextResult(request: {readonly taskId: string; readonly reportFingerprint: string},
    supplied: ApplicationRequestContext, admission: ApprovedContextResultSaveAdmission): Promise<ContractResult<ContextGenerationStatus>> {
    const context = {...supplied};
    const denied = () => createFailureResult(createContractError("forbidden", "The reviewed Context save is unavailable."), context);
    const unknown = () => createFailureResult(createContractError("unavailable", "The approved Context save could not be confirmed. Its output is retained."), context);
    if (!request || !admission) return denied();
    const {taskId, reportFingerprint} = request;
    const a = {...admission};
    if (!context.organizationId || !context.principalId || !context.workspaceId || a.organizationId !== context.organizationId ||
        a.principalId !== context.principalId || a.workspaceId !== context.workspaceId || taskId !== a.taskId || reportFingerprint !== a.reportFingerprint ||
        typeof taskId !== "string" || typeof reportFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(reportFingerprint) ||
        typeof a.effectId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(a.effectId) ||
        typeof a.isCurrent !== "function" || typeof a.stillAllowed !== "function" || typeof a.issue !== "function" || typeof a.commit !== "function" ||
        !this.resultBytes || !this.resultSource) return denied();
    const current = async () => {try {return a.isCurrent() && await a.stillAllowed() && a.isCurrent();} catch {return false;}};
    if (!await current()) return denied();
    return this.serialize(taskId, async () => {
      const workspace = await this.resolveWorkspace(context, "context.save", "artifact:write");
      if (!workspace.ok || !await current()) return denied();
      const scope = this.scopes.get(taskId);
      if (!scope || !ownsScope(scope, context) || !this.confirmedAdmittedTaskIds.has(taskId)) return denied();
      const previous = this.admittedSaves.get(taskId);
      if (previous) {
        const completed = this.completed.get(taskId);
        return previous.effectId === a.effectId && previous.reportFingerprint === reportFingerprint && previous.phase === "complete" &&
          completed?.state === "saved" && await current() ? createSuccessResult(completed, context) : unknown();
      }
      const prepared = this.peekAdmittedContextSaveInputs(taskId, context), pending = this.pending.get(taskId);
      if (!prepared || !pending || prepared.review.reportFingerprint !== reportFingerprint || this.saveCleanup.has(taskId) || !await current()) return denied();
      const attempt = {effectId: a.effectId, reportFingerprint, phase: "reserving" as "reserving" | "issued" | "unconfirmed" | "complete"};
      this.admittedSaves.set(taskId, attempt);
      let issued: "issued" | "denied" | "unconfirmed";
      try {issued = await a.issue();} catch {issued = "unconfirmed";}
      if (issued !== "issued") {
        if (issued === "denied") this.admittedSaves.delete(taskId); else attempt.phase = "unconfirmed";
        return issued === "denied" ? denied() : unknown();
      }
      attempt.phase = "issued";
      try {
        if (!await current()) {attempt.phase = "unconfirmed"; return denied();}
        const publicationId = a.effectId.replace(/-/g, ""), output = prepared.output;
        const stored = await this.resultBytes!.publishResult({publicationId, mediaType: output.mediaType,
          expectedSizeBytes: output.sizeBytes, expectedSha256: output.digest,
          content: this.resultSource!.readOutput({runtimeDirectory: pending.runtimeDirectory,
            outputHandle: output.outputHandle, expectedSizeBytes: output.sizeBytes})}, context);
        const key = `workspaces/${context.workspaceId}/artifacts/context/${publicationId}`;
        if (!stored.ok || stored.value.key !== key || stored.value.mediaType !== output.mediaType || stored.value.sizeBytes !== output.sizeBytes ||
            stored.value.checksum?.algorithm !== "sha256" || stored.value.checksum.value !== output.digest.slice(7) || !await current()) {
          attempt.phase = "unconfirmed"; return unknown();
        }
        const savedArtifact: ContextSavedArtifactReference = {artifactId: key, storageKey: key, kind: prepared.review.kind,
          name: prepared.name, mediaType: output.mediaType, sizeBytes: output.sizeBytes, digest: output.digest};
        const committed = await a.commit({...savedArtifact});
        if (!committed || Object.keys(committed).length !== Object.keys(savedArtifact).length ||
            !Object.entries(savedArtifact).every(([key, value]) => committed[key as keyof typeof committed] === value)) {
          attempt.phase = "unconfirmed"; return unknown();
        }
        // Preserve a confirmed business outcome before cleanup or disclosure.
        const completed: ContextGenerationStatus = {requestId: taskId, state: "saved", savedArtifact,
          sourceInspections: pending.runtimeResult.sourceInspections, preview: pending.runtimeResult.preview, manifest: pending.runtimeResult.manifest};
        this.completed.set(taskId, completed);
        attempt.phase = "complete";
        try {await this.cleanup(taskId);} catch {/* Owned staging remains for existing cleanup; never compensate committed bytes. */}
        return await current() ? createSuccessResult(completed, context) : denied();
      } catch {attempt.phase = "unconfirmed"; return unknown();}
    });
  }

  private async readOwned(requestId: string, workspaceId: WorkspaceId, context?: ApplicationRequestContext): Promise<ContractResult<ContextGenerationStatus>> {
    const existing = this.reads.get(requestId);
    if (existing) return existing;
    const operation = this.serialize(requestId, () => this.performReadOwned(requestId, workspaceId, context));
    this.reads.set(requestId, operation);
    try { return await operation; } finally { this.reads.delete(requestId); }
  }

  private async performReadOwned(requestId: string, workspaceId: WorkspaceId, context?: ApplicationRequestContext): Promise<ContractResult<ContextGenerationStatus>> {
    if (this.pendingPowerStarts.has(requestId)) return createFailureResult(
      createContractError("unavailable", "Context generation startup is still being confirmed."), context);
    const scope = this.scopes.get(requestId)!;
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
    let status: RuntimeTaskStatusRecord;
    try {
      status = await this.runtime.getTaskStatus(requestId);
    } catch {
      // A transport failure is not terminal evidence. The worker may still own
      // the staged inputs, so retain its identity, directory and power lease.
      return createFailureResult(
        createContractError("unavailable", "Context generation status is temporarily unavailable."),
        context,
      );
    }
    // A mismatched reply is not terminal proof for this owned directory. Keep
    // this guard outside completion validation, whose catch retires bad output.
    try {
      if (!status || typeof status !== "object" || status.requestId !== requestId ||
          (!("recordType" in status) && (status.taskType !== TaskType.CONTEXT_GENERATION ||
            !["queued", "running", "succeeded", "failed", "cancelled"].includes(status.status) ||
            (status.workspaceId !== undefined && status.workspaceId !== workspaceId) ||
            (this.admittedStarts.has(requestId) && status.workspaceId !== workspaceId) ||
            (status.metadata?.organizationId !== undefined && status.metadata.organizationId !== scope.organizationId) ||
            (status.metadata?.principalId !== undefined && status.metadata.principalId !== scope.principalId)))) {
        return createFailureResult(createContractError("unavailable", "Context generation status could not be confirmed."), context);
      }
    } catch {
      return createFailureResult(createContractError("unavailable", "Context generation status could not be confirmed."), context);
    }
    try {
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
        status.workspaceId !== workspaceId
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
        validateRuntimeResult(status.data, command, expectedSources, this.confirmedAdmittedTaskIds.has(requestId));
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
    } catch {
      await this.taskPower.completeTask(requestId, "failed");
      await this.cleanup(requestId);
      this.completed.set(requestId, { requestId, state: "failed", error: { code: "invalid_runtime_result", message: "Context generation completion could not be verified.", retryable: false } });
      return createFailureResult(
        createContractError(
          "internal",
          "Context generation completion could not be verified.",
        ),
        context,
      );
    }
  }

  public async save(
    requestId: string, context?: ApplicationRequestContext,
  ): Promise<ContractResult<ContextGenerationStatus>> { return this.reviewAction(requestId, context, "save"); }

  private async finishSaveCleanup(requestId: string, context?: ApplicationRequestContext): Promise<boolean> {
    const owned = this.saveCleanup.get(requestId);
    if (!owned) return true;
    try {
      const removed = await this.catalog.deleteArtifactCatalogRecord(
        { workspaceId: owned.workspaceId, storageKey: owned.storageKey }, context,
      );
      if (!removed.ok && removed.error.code !== "not-found") return false;
      const deleted = await this.storage.deleteArtifact(createDeleteArtifactRequest(owned.storageKey), context);
      if (!deleted.ok && deleted.error.code !== "not-found") return false;
      this.saveCleanup.delete(requestId);
      return true;
    } catch { return false; }
  }

  private saveCleanupUnavailable(context?: ApplicationRequestContext): ContractResult<ContextGenerationStatus> {
    return createFailureResult(
      createContractError("unavailable", "Context could not be saved and cleanup is incomplete. The reviewed output is retained; retry after storage is available."),
      context,
    );
  }

  private async performSave(
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
    if (!await this.finishSaveCleanup(requestId, context)) return this.saveCleanupUnavailable(context);
    let storageKey: string | undefined;
    try {
      const outputBytes = new Uint8Array(await readFile(pending.outputPath));
      const output = pending.runtimeResult.output;
      if (
        outputBytes.byteLength !== output.sizeBytes ||
        sha256(outputBytes) !== output.digest
      ) {
        throw new ContextSaveFailure("Context artifact changed after review.");
      }
      const generatedId = this.createId().replace(/[^A-Za-z0-9._-]+/g, "-");
      if (!generatedId) {
        throw new ContextSaveFailure("Context artifact identifier could not be created.");
      }
      const candidateKey = join(
        "generated",
        "context",
        generatedId,
        output.name,
      ).replace(/\\/g, "/");
      const existing = await this.catalog.readArtifactCatalogRecord(
        { workspaceId: workspace.value.workspaceId, storageKey: candidateKey },
        context,
      );
      if (existing.ok || existing.error.code !== "not-found") {
        throw new ContextSaveFailure("Context artifact identity is unavailable. Retry saving with a new identity.");
      }
      const stored = await this.storage.storeArtifact(
        createStoreArtifactRequest(outputBytes, {
          descriptor: {
            key: candidateKey,
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
        throw new ContextSaveFailure("Context artifact could not be stored.");
      }
      if (stored.value.key !== candidateKey) {
        throw new ContextSaveFailure("Context artifact storage did not confirm the requested identity.");
      }
      // Only an acknowledged exact write supplies compensation authority. The
      // storage adapter may already have registered its bytes in the catalog.
      storageKey = candidateKey;
      this.saveCleanup.set(requestId, { storageKey, workspaceId: workspace.value.workspaceId });
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
        throw new ContextSaveFailure("catalog unavailable");
      }
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
        throw new ContextSaveFailure("binding unavailable");
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
      this.saveCleanup.delete(requestId);
      this.completed.set(requestId, completed);
      return createSuccessResult(completed, context);
    } catch (error) {
      if (!await this.finishSaveCleanup(requestId, context)) return this.saveCleanupUnavailable(context);
      return createFailureResult(
        createContractError(
          "internal",
          error instanceof ContextSaveFailure
            ? error.message
            : "Context artifact could not be saved.",
        ),
        context,
      );
    }
  }

  public async discard(
    requestId: string, context?: ApplicationRequestContext,
  ): Promise<ContractResult<ContextGenerationStatus>> { return this.reviewAction(requestId, context, "discard"); }

  private async performDiscard(
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
    if (!await this.finishSaveCleanup(requestId, context)) return this.saveCleanupUnavailable(context);
    await this.cleanup(requestId);
    const discarded: ContextGenerationStatus = {
      requestId,
      state: "discarded",
    };
    this.completed.set(requestId, discarded);
    return createSuccessResult(discarded, context);
  }

  public async cancel(
    requestId: string, context?: ApplicationRequestContext,
  ): Promise<ContractResult<ContextGenerationStatus>> { return this.reviewAction(requestId, context, "cancel"); }

  private async performCancel(
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
    if (this.pendingPowerStarts.has(requestId)) return createFailureResult(
      createContractError("unavailable", "Context generation startup is still being confirmed."), context);
    if (!await this.finishSaveCleanup(requestId, context)) return this.saveCleanupUnavailable(context);
    let result: Awaited<ReturnType<RuntimeTaskRegistryPort["cancelTask"]>>;
    try {
      result = await this.runtime.cancelTask(requestId);
      if (!result || result.requestId !== requestId || typeof result.cancelled !== "boolean" ||
          (result.status === "cancelled" && result.cancelled !== true))
        return createFailureResult(createContractError("unavailable", "Context generation cancellation could not be confirmed."), context);
    } catch {
      return createFailureResult(createContractError("unavailable", "Context generation cancellation could not be confirmed."), context);
    }
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
    if (directory) await rm(directory, { recursive: true, force: true });
    this.runtimeDirectories.delete(requestId);
    this.commands.delete(requestId);
    this.sourceInputs.delete(requestId);
    this.pending.delete(requestId);
    const admitted = this.admittedStarts.get(requestId);
    if (admitted) {admitted.runtimeDirectory = undefined; this.admittedStarts.delete(requestId); this.uncertainStarts.delete(admitted);}
    for (const attempt of this.uncertainStarts) if (attempt.confirmedRequestId === requestId) {
      attempt.runtimeDirectory = undefined; this.uncertainStarts.delete(attempt);
    }
  }

  private async stageSources(
    command: StartContextGenerationCommand,
    context?: ApplicationRequestContext,
    attempt?: ContextStartAttempt,
  ): Promise<
    ContractResult<{
      runtimeDirectory: string;
      sources: readonly ContextRuntimeSourceInput[];
    }>
  > {
    const runtimeDirectory = await mkdtemp(
      join(tmpdir(), "ai-system-builder-context-"),
    );
    if (attempt) attempt.runtimeDirectory = runtimeDirectory;
    const sources: ContextRuntimeSourceInput[] = [];
    let aggregateBytes = 0;
    const fail = async (code: ContractErrorCode, message: string) => {
      await rm(runtimeDirectory, { recursive: true, force: true });
      if (attempt) attempt.runtimeDirectory = undefined;
      return createFailureResult(createContractError(code, message), context);
    };
    try {
      for (const [index, source] of command.sources.entries()) {
        const admission = attempt?.admission, selected = admission?.sources[index];
        if (admission && !await approvedContextAdmissionCurrent(admission)) return fail("forbidden", "Context generation permission changed.");
        const bindingResult = await this.bindings.readArtifactStorageBindings(
          {
            workspaceId: context?.workspaceId as WorkspaceId,
            artifactId: source.artifactId,
          },
          context,
        );
        if (!bindingResult.ok && bindingResult.error.code !== "not-found") {
          return fail(bindingResult.error.code, "Context source bindings could not be read. Retry when storage is available.");
        }
        const storageKey = preferredLocalStorageKey(
          source.artifactId,
          bindingResult.ok ? bindingResult.value.bindings : [],
        );
        if (admission && (!selected || selected.artifactId !== source.artifactId || selected.storageKey !== storageKey ||
            !await approvedContextAdmissionCurrent(admission))) return fail("forbidden", "The selected Context source changed.");
        const retrieved = await this.storage.retrieveArtifact<Uint8Array>(
          createRetrieveArtifactRequest(storageKey, {
            maximumBytes: admission ? APPROVED_CONTEXT_MAX_SOURCE_BYTES : CONTEXT_GENERATION_LIMITS.maximumSourceBytes,
          }),
          context,
        );
        if (admission && !await approvedContextAdmissionCurrent(admission)) return fail("forbidden", "Context generation permission changed.");
        if (!retrieved.ok) {
          return fail(retrieved.error.code, "Context source bytes could not be read. Check that the selected source is available.");
        }
        if (!(retrieved.value.content instanceof Uint8Array)) {
          return fail("internal", "Context source bytes are unavailable.");
        }
        const retrievedBytes = retrieved.value.content;
        aggregateBytes += retrievedBytes.byteLength;
        if (
          retrievedBytes.byteLength < 1 ||
          retrievedBytes.byteLength > (admission ? APPROVED_CONTEXT_MAX_SOURCE_BYTES : CONTEXT_GENERATION_LIMITS.maximumSourceBytes) ||
          aggregateBytes > CONTEXT_GENERATION_LIMITS.maximumAggregateSourceBytes
        ) {
          return fail(
            "validation",
            "Selected context sources exceed the safe size limit.",
          );
        }
        // Adapter-owned buffers can change while catalog/permission reads await.
        // Hash and stage a bounded private snapshot, never that mutable alias.
        const bytes = new Uint8Array(retrievedBytes);
        const descriptor = retrieved.value.descriptor;
        if (selected && (descriptor.key !== selected.storageKey || (descriptor.sizeBytes !== undefined && descriptor.sizeBytes !== selected.sizeBytes) ||
            bytes.byteLength !== selected.sizeBytes || sha256(bytes) !== selected.digest ||
            (descriptor.mediaType !== undefined && descriptor.mediaType !== selected.mediaType)))
          return fail("conflict", "The selected Context source bytes changed.");
        const sourceInformation = selected ? (selected.declaredLicense ? {license: selected.declaredLicense} : undefined)
          : projectContextSourceInformation(descriptor.metadata);
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
        if (admission && !await approvedContextAdmissionCurrent(admission)) return fail("forbidden", "Context generation permission changed.");
        const originalName =
          descriptorOriginalName ??
          (catalog.ok ? catalog.value.record.originalName : undefined);
        const mediaType =
          descriptor.mediaType ??
          (catalog.ok ? catalog.value.record.mediaType : undefined) ?? selected?.mediaType;
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
        if (selected && (capability.capability.format !== selected.format || mediaType !== selected.mediaType))
          return fail("conflict", "The selected Context source format changed.");
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
    } catch {
      return fail(
        "internal",
        "Context sources could not be staged.",
      );
    }
  }
}
