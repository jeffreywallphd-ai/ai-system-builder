import { createHash } from "node:crypto";

import {
  CONTEXT_GENERATION_LIMITS,
  evaluateContextSourceCapability,
  isContextArtifactMediaType,
  normalizeContextRetrievalRequest,
  resolveContextArtifactKind,
  type ContextBrowserDetail,
  type ContextBrowserItem,
  type ContextChunkingSettings,
  type ContextConversionReadiness,
  type ContextRetrievalRequest,
  type ContextRetrievalResult,
  type ContextSourceCheckSettings,
  type ContextSourceFreshness,
  type StartContextGenerationCommand,
} from "../../../contracts/context-management";
import {
  createContractError,
  createFailureResult,
  createSuccessResult,
  type ContractResult,
} from "../../../contracts/shared";
import {
  createRetrieveArtifactRequest,
  type ArtifactStorageBinding,
  type StorageObjectMetadata,
} from "../../../contracts/storage";
import type { WorkspaceId } from "../../../contracts/workspace";
import type {
  ArtifactCatalogDeletePort,
  ArtifactCatalogReadPort,
  ArtifactCatalogRecord,
} from "../../ports/artifact-catalog";
import type { ContextArtifactRuntimePort } from "../../ports/context-management";
import type { WorkspaceOperationAuthorizationPort } from "../../ports/security";
import type {
  ArtifactObjectStoragePort,
  ArtifactStorageBindingPort,
} from "../../ports/storage";
import type { WorkspaceRepository } from "../../ports/workspace";
import type { ApplicationRequestContext } from "../../ports";
import { resolveArtifactWorkspaceContext } from "../artifact-workspace-context";
import type { StartContextGenerationValue } from "./context-generation.use-case";
import { projectContextSourceInformation } from "./context-source-information";

interface ContextArtifactCatalogPort
  extends ArtifactCatalogReadPort, ArtifactCatalogDeletePort {}

interface ReadLocalArtifact {
  readonly record: ArtifactCatalogRecord;
  readonly storageKey: string;
  readonly content: Uint8Array;
  readonly digest: string;
  readonly mediaType?: string;
  readonly originalName?: string;
  readonly metadata?: StorageObjectMetadata;
}

export interface InspectContextSourceCommand {
  readonly artifactId: string;
  readonly chunking: ContextChunkingSettings;
  readonly sourceChecks?: ContextSourceCheckSettings;
}

export interface ContextGenerationStartPort {
  start(
    command: StartContextGenerationCommand,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<StartContextGenerationValue>>;
}

export interface RegisteredArtifactDeletePort {
  execute(
    command: { readonly storageKey: string },
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<{ storageKey: string }>>;
}

export interface ContextBrowserUseCasesDependencies {
  readonly catalog: ContextArtifactCatalogPort;
  readonly storageBindings: Pick<
    ArtifactStorageBindingPort,
    "readArtifactStorageBindings"
  >;
  readonly storage: Pick<ArtifactObjectStoragePort, "retrieveArtifact">;
  readonly runtime: ContextArtifactRuntimePort;
  readonly generation: ContextGenerationStartPort;
  readonly deleteArtifact: RegisteredArtifactDeletePort;
  readonly workspaceRepository?: Pick<WorkspaceRepository, "readWorkspace">;
  readonly workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
}

export class ContextBrowserUseCases {
  public constructor(
    private readonly dependencies: ContextBrowserUseCasesDependencies,
  ) {}

  public async inspectSource(
    command: InspectContextSourceCommand,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<ContextConversionReadiness>> {
    const workspace = await this.authorize(
      context,
      "context.source.inspect",
      "artifact:read",
    );
    if (!workspace.ok) return workspace;
    const artifactId = normalizeArtifactId(command.artifactId);
    if (!artifactId) {
      return invalid("Context source artifact id is invalid.", context);
    }
    const artifact = await this.readLocalArtifact(
      workspace.value.workspaceId,
      artifactId,
      CONTEXT_GENERATION_LIMITS.maximumSourceBytes,
      context,
    );
    if (!artifact.ok) {
      if (
        artifact.error.code === "not-found" ||
        artifact.error.code === "unavailable"
      ) {
        return createSuccessResult(
          {
            artifactId,
            ready: false,
            locallyReadable: false,
            textFields: [],
            alreadyChunked: false,
            reasonCode: "source-local-copy-required",
            message:
              "This artifact is not available as a local context source.",
            action: "Download or localize the artifact, then try again.",
          },
          context,
        );
      }
      return artifact;
    }
    const capability = evaluateContextSourceCapability({
      fileName: artifact.value.originalName ?? artifact.value.storageKey,
      mediaType: artifact.value.mediaType,
    });
    if (!capability.ready) {
      return createSuccessResult(
        {
          artifactId,
          ready: false,
          locallyReadable: true,
          digest: artifact.value.digest,
          mediaType: artifact.value.mediaType,
          originalName: artifact.value.originalName,
          sizeBytes: artifact.value.content.byteLength,
          format: capability.capability?.format,
          sourceKind:
            capability.capability?.kind === "structured" ||
            capability.capability?.kind === "document"
              ? capability.capability.kind
              : undefined,
          textFields: [],
          alreadyChunked: false,
          reasonCode: capability.code,
          message: capability.message,
          action: capability.action,
        },
        context,
      );
    }
    try {
      const sourceInformation = projectContextSourceInformation(
        artifact.value.metadata,
      );
      const inspection = await this.dependencies.runtime.inspectSource({
        workspaceId: workspace.value.workspaceId,
        artifactId,
        content: artifact.value.content,
        mediaType:
          artifact.value.mediaType ?? capability.capability!.mediaTypes[0]!,
        ...(artifact.value.originalName
          ? { originalName: artifact.value.originalName }
          : {}),
        digest: artifact.value.digest,
        chunking: command.chunking,
        ...(sourceInformation ? { sourceInformation } : {}),
        ...(command.sourceChecks ? { sourceChecks: command.sourceChecks } : {}),
      });
      return createSuccessResult(
        {
          artifactId,
          ready: inspection.ready,
          locallyReadable: true,
          digest: inspection.digest,
          mediaType: inspection.mediaType,
          originalName: inspection.originalName,
          sizeBytes: inspection.sizeBytes,
          format: inspection.format,
          sourceKind: inspection.sourceKind,
          textFields: inspection.textFields ?? [],
          alreadyChunked: inspection.alreadyChunked,
          chunkCount: inspection.chunkCount,
          sourceInformation: inspection.sourceInformation,
          checks: inspection.checks,
          ...(inspection.ready
            ? {}
            : {
                reasonCode: "source-checks-blocked",
                message:
                  "The selected source did not pass the configured RAG data checks.",
                action:
                  "Correct the source data or adjust the advanced data rules, then prepare again.",
              }),
        },
        context,
      );
    } catch {
      return createFailureResult(
        createContractError(
          "unavailable",
          "Context source inspection could not be completed. Retry after checking the local runtime.",
        ),
        context,
      );
    }
  }

  public async list(
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<{ items: readonly ContextBrowserItem[] }>> {
    const workspace = await this.authorize(
      context,
      "context.browser.list",
      "artifact:read",
    );
    if (!workspace.ok) return workspace;
    const result = await this.dependencies.catalog.browseArtifactCatalogRecords(
      { workspaceId: workspace.value.workspaceId },
      context,
    );
    if (!result.ok) return result;
    const items = result.value.records
      .map(toBrowserItem)
      .filter((item): item is ContextBrowserItem => item !== undefined)
      .sort((left, right) =>
        (right.createdAt ?? "").localeCompare(left.createdAt ?? ""),
      );
    return createSuccessResult({ items }, context);
  }

  public async detail(
    artifactIdValue: string,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<ContextBrowserDetail>> {
    const workspace = await this.authorize(
      context,
      "context.browser.detail",
      "artifact:read",
    );
    if (!workspace.ok) return workspace;
    const artifactId = normalizeArtifactId(artifactIdValue);
    if (!artifactId) {
      return invalid("Context artifact id is invalid.", context);
    }
    const artifact = await this.readLocalArtifact(
      workspace.value.workspaceId,
      artifactId,
      CONTEXT_GENERATION_LIMITS.maximumArtifactBytes,
      context,
    );
    if (!artifact.ok) return opaqueNotFound(artifactId, context);
    if (!isContextArtifactMediaType(artifact.value.mediaType)) {
      return opaqueNotFound(artifactId, context);
    }
    const item = toBrowserItem(artifact.value.record);
    if (!item) return opaqueNotFound(artifactId, context);
    try {
      const inspection = await this.dependencies.runtime.inspectArtifact({
        workspaceId: workspace.value.workspaceId,
        artifactId,
        content: artifact.value.content,
        mediaType: artifact.value.mediaType,
        digest: artifact.value.digest,
      });
      const freshness = await Promise.all(
        inspection.manifest.sources.map((source) =>
          this.readFreshness(
            workspace.value.workspaceId,
            source.artifactId,
            source.digest,
            context,
          ),
        ),
      );
      const unavailable = freshness.some(
        (entry) => entry.state === "unavailable",
      );
      const manual = inspection.manifest.manualEntries.length > 0;
      return createSuccessResult(
        {
          item,
          manifest: inspection.manifest,
          freshness,
          chunkCount: inspection.chunkCount,
          packageEntries: inspection.packageEntries,
          topics: inspection.topics,
          rebuildAllowed: !manual && !unavailable,
          ...(manual || unavailable
            ? {
                rebuildAction: manual
                  ? "Re-enter the manual context before rebuilding this pack."
                  : "Restore every unavailable source before rebuilding.",
              }
            : {}),
        },
        context,
      );
    } catch {
      return createFailureResult(
        createContractError(
          "validation",
          "This context artifact could not be verified. Rebuild it from trusted sources.",
        ),
        context,
      );
    }
  }

  public async query(
    request: ContextRetrievalRequest,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<ContextRetrievalResult>> {
    const workspace = await this.authorize(
      context,
      "context.browser.query",
      "artifact:read",
    );
    if (!workspace.ok) return workspace;
    let normalized;
    try {
      normalized = normalizeContextRetrievalRequest(request);
    } catch {
      return invalid("Context retrieval request is invalid.", context);
    }
    const artifact = await this.readLocalArtifact(
      workspace.value.workspaceId,
      normalized.artifactId,
      CONTEXT_GENERATION_LIMITS.maximumArtifactBytes,
      context,
    );
    if (
      !artifact.ok ||
      resolveContextArtifactKind(artifact.value.mediaType) !== "rag-database"
    ) {
      return opaqueNotFound(normalized.artifactId, context);
    }
    try {
      const matches = await this.dependencies.runtime.query({
        workspaceId: workspace.value.workspaceId,
        artifactId: normalized.artifactId,
        content: artifact.value.content,
        mediaType: artifact.value.mediaType!,
        digest: artifact.value.digest,
        query: normalized.query,
        maximumResults: normalized.maximumResults,
      });
      return createSuccessResult(
        { artifactId: normalized.artifactId, matches },
        context,
      );
    } catch {
      return createFailureResult(
        createContractError(
          "unavailable",
          "Context retrieval could not be completed. Verify the local model and retry.",
        ),
        context,
      );
    }
  }

  public async rebuild(
    artifactId: string,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<StartContextGenerationValue>> {
    const detail = await this.detail(artifactId, context);
    if (!detail.ok) return detail;
    if (!detail.value.rebuildAllowed) {
      return createFailureResult(
        createContractError(
          "validation",
          detail.value.rebuildAction ??
            "This context artifact cannot be rebuilt from its current sources.",
        ),
        context,
      );
    }
    const manifest = detail.value.manifest;
    const command: StartContextGenerationCommand = {
      kind: manifest.kind,
      name: manifest.name,
      sources: manifest.sources.map((source) => ({
        artifactId: source.artifactId,
      })),
      chunking:
        manifest.kind === "markdown-context-pack"
          ? {
              strategy: "topic-aware",
              chunkCharacters: 1_200,
              overlapCharacters: 0,
              maximumTokensPerChunk: 320,
              topicBoundarySensitivity: 0.22,
              maximumChunks: manifest.chunking.maximumChunks,
            }
          : manifest.chunking,
      ...(manifest.embedding
        ? { embedding: { ...manifest.embedding, batchSize: 16 } }
        : {}),
      ...(manifest.contextPack
        ? {
            contextPack: {
              inputMode: manifest.contextPack.inputMode ?? "source-materials",
              method:
                manifest.contextPack.method === "local-model"
                  ? "local-model"
                  : "none",
              cleaningPreset:
                manifest.contextPack.inputMode === "manual"
                  ? undefined
                  : (manifest.contextPack.cleaningPreset ?? "standard"),
              ...(manifest.contextPack.method === "local-model"
                ? {
                    maximumSummaryLines:
                      manifest.contextPack.maximumSummaryLines ?? 200,
                  }
                : {}),
              ...(manifest.contextPack.method === "local-model" &&
              manifest.contextPack.modelId
                ? {
                    model: {
                      provider: "transformers" as const,
                      modelId: manifest.contextPack.modelId,
                    },
                  }
                : {}),
            },
          }
        : {}),
    };
    return this.dependencies.generation.start(command, context);
  }

  public async delete(
    artifactIdValue: string,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<{ storageKey: string }>> {
    const workspace = await this.authorize(
      context,
      "context.browser.delete",
      "artifact:write",
    );
    if (!workspace.ok) return workspace;
    const artifactId = normalizeArtifactId(artifactIdValue);
    if (!artifactId) {
      return invalid("Context artifact id is invalid.", context);
    }
    const record = await this.dependencies.catalog.readArtifactCatalogRecord(
      { workspaceId: workspace.value.workspaceId, storageKey: artifactId },
      context,
    );
    if (
      !record.ok ||
      !isContextArtifactMediaType(record.value.record.mediaType)
    ) {
      return opaqueNotFound(artifactId, context);
    }
    return this.dependencies.deleteArtifact.execute(
      { storageKey: artifactId },
      context,
    );
  }

  private async authorize(
    context: ApplicationRequestContext | undefined,
    operation: string,
    scope: "artifact:read" | "artifact:write",
  ) {
    return resolveArtifactWorkspaceContext(
      context ?? {},
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

  private async readLocalArtifact(
    workspaceId: WorkspaceId,
    artifactId: string,
    maximumBytes: number,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<ReadLocalArtifact>> {
    const catalog = await this.dependencies.catalog.readArtifactCatalogRecord(
      { workspaceId, storageKey: artifactId },
      context,
    );
    if (!catalog.ok) return catalog;
    const bindings =
      await this.dependencies.storageBindings.readArtifactStorageBindings(
        { workspaceId, artifactId },
        context,
      );
    if (!bindings.ok && bindings.error.code !== "not-found") return bindings;
    const storageKey = preferredLocalStorageKey(
      artifactId,
      bindings.ok ? bindings.value.bindings : [],
    );
    const retrieved =
      await this.dependencies.storage.retrieveArtifact<Uint8Array>(
        createRetrieveArtifactRequest(storageKey, { maximumBytes }),
        context,
      );
    if (!retrieved.ok) return retrieved;
    if (!(retrieved.value.content instanceof Uint8Array)) {
      return createFailureResult(
        createContractError("unavailable", "Artifact bytes are unavailable."),
        context,
      );
    }
    const digest = sha256(retrieved.value.content);
    const expected = catalog.value.record.checksum;
    if (
      expected?.algorithm === "sha256" &&
      digest !== "sha256:" + expected.value
    ) {
      return createFailureResult(
        createContractError(
          "validation",
          "Artifact checksum verification failed.",
        ),
        context,
      );
    }
    const metadata = retrieved.value.descriptor.metadata;
    const originalName =
      metadataText(metadata, "originalFileName") ??
      metadataText(metadata, "originalName") ??
      catalog.value.record.originalName;
    return createSuccessResult(
      {
        record: catalog.value.record,
        storageKey,
        content: retrieved.value.content,
        digest,
        mediaType:
          retrieved.value.descriptor.mediaType ??
          catalog.value.record.mediaType,
        originalName,
        metadata,
      },
      context,
    );
  }

  private async readFreshness(
    workspaceId: WorkspaceId,
    artifactId: string,
    expectedDigest: string,
    context?: ApplicationRequestContext,
  ): Promise<ContextSourceFreshness> {
    const source = await this.readLocalArtifact(
      workspaceId,
      artifactId,
      CONTEXT_GENERATION_LIMITS.maximumSourceBytes,
      context,
    );
    if (!source.ok) {
      return { artifactId, expectedDigest, state: "unavailable" };
    }
    return {
      artifactId,
      expectedDigest,
      actualDigest: source.value.digest,
      state: source.value.digest === expectedDigest ? "current" : "stale",
    };
  }
}

function toBrowserItem(
  record: ArtifactCatalogRecord,
): ContextBrowserItem | undefined {
  const kind = resolveContextArtifactKind(record.mediaType);
  if (
    !kind ||
    !isContextArtifactMediaType(record.mediaType) ||
    !record.checksum ||
    record.checksum.algorithm !== "sha256" ||
    !/^[a-f0-9]{64}$/.test(record.checksum.value) ||
    !Number.isSafeInteger(record.sizeBytes) ||
    (record.sizeBytes ?? 0) < 1 ||
    (record.sizeBytes ?? 0) > CONTEXT_GENERATION_LIMITS.maximumArtifactBytes
  ) {
    return undefined;
  }
  const extension = kind === "rag-database" ? ".sqlite3" : ".zip";
  const originalName = record.originalName ?? record.storageKey;
  const name = originalName.toLowerCase().endsWith(extension)
    ? originalName.slice(0, -extension.length)
    : originalName;
  return {
    artifactId: record.storageKey,
    storageKey: record.storageKey,
    kind,
    name: name.slice(0, CONTEXT_GENERATION_LIMITS.maximumNameCharacters),
    mediaType: record.mediaType,
    sizeBytes: record.sizeBytes!,
    digest: "sha256:" + record.checksum.value,
    createdAt: record.createdAt,
  };
}

function preferredLocalStorageKey(
  artifactId: string,
  bindings: readonly ArtifactStorageBinding[],
): string {
  return (
    bindings.find(
      (binding) =>
        binding.backing.kind === "artifact-object" &&
        binding.backing.provider === "local-filesystem" &&
        binding.role === "primary",
    )?.backing.locator ??
    bindings.find(
      (binding) =>
        binding.backing.kind === "artifact-object" &&
        binding.backing.provider === "local-filesystem",
    )?.backing.locator ??
    artifactId
  );
}

function metadataText(metadata: unknown, key: string): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeArtifactId(value: string): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length <= 512 ? normalized : undefined;
}

function sha256(content: Uint8Array): string {
  return "sha256:" + createHash("sha256").update(content).digest("hex");
}

function invalid<T>(
  message: string,
  context?: ApplicationRequestContext,
): ContractResult<T> {
  return createFailureResult(
    createContractError("validation", message),
    context,
  );
}

function opaqueNotFound<T>(
  _artifactId: string,
  context?: ApplicationRequestContext,
): ContractResult<T> {
  return createFailureResult(
    createContractError("not-found", "Context artifact was not found."),
    context,
  );
}
