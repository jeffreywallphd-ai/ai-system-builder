import type { AssetDefinition, AssetReference } from "../../../contracts/asset";
import {
  ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE,
  describeAssetImplementationBackingResourceFiles,
  normalizeAssetImplementationBackingResourceBundle,
  normalizeAssetImplementationDraftId,
  normalizeAssetSourceSnapshotId,
  type AssetImplementationArtifactDescriptor,
  type AssetImplementationBackingResourceBundleV1,
  type AssetImplementationBackingResourceFile,
  type AssetSourceSnapshot,
} from "../../../contracts/asset-implementation";
import {
  normalizeAssetStudioAssetDraftId,
  normalizeAssetStudioAssetDraftRecord,
  normalizeAssetStudioExactDefinitionReference,
  normalizeAssetStudioSemanticDefinitionInput,
  type AssetStudioAssetDraftListView,
  type AssetStudioAssetDraftRecord,
  type AssetStudioAssetDraftSummary,
  type AssetStudioAssetDraftView,
  type AssetStudioResult,
  type CreateAssetStudioAssetDraftCommand,
  type ListAssetStudioAssetDraftsQuery,
  type ReadAssetStudioAssetDraftQuery,
  type TransitionAssetStudioAssetDraftCommand,
  type UpdateAssetStudioAssetDraftCommand,
} from "../../../contracts/asset-studio";
import type { AssetDefinitionRepositoryPort } from "../../ports/asset";
import type { AssetStudioAssetDraftRepositoryPort } from "../../ports/asset-studio";
import type {
  AssetImplementationArtifactPort,
  AssetImplementationRepositoryPort,
} from "../../ports/asset-implementation";
import { validateAssetDefinition } from "../../services/asset";
import {
  CreateAssetImplementationDraftUseCase,
  SnapshotAssetImplementationSourceUseCase,
} from "../asset-implementation";
import { studioFailure, studioSuccess } from "./asset-studio-result";

const DEFINITION_RESOURCE_PATH = "other/definition.json";

export class AssetStudioAssetDraftWorkflowUseCase {
  private readonly createImplementationDraft: CreateAssetImplementationDraftUseCase;
  private readonly snapshotImplementationSource: SnapshotAssetImplementationSourceUseCase;

  public constructor(
    private readonly dependencies: {
      readonly drafts: AssetStudioAssetDraftRepositoryPort;
      readonly definitions: AssetDefinitionRepositoryPort;
      readonly implementations: AssetImplementationRepositoryPort;
      readonly artifacts: AssetImplementationArtifactPort;
      readonly nextDraftId: () => string;
      readonly now: () => string;
    },
  ) {
    this.createImplementationDraft = new CreateAssetImplementationDraftUseCase(
      dependencies.implementations,
      dependencies.now,
    );
    this.snapshotImplementationSource =
      new SnapshotAssetImplementationSourceUseCase(
        dependencies.implementations,
        dependencies.artifacts,
        dependencies.now,
      );
  }

  public async create(
    command: CreateAssetStudioAssetDraftCommand,
  ): Promise<AssetStudioResult<AssetStudioAssetDraftRecord>> {
    try {
      if (command.sourceLegacyDraftId) {
        const existing = await this.findLegacyDraft(
          command.workspaceId,
          command.sourceLegacyDraftId,
        );
        if (existing) return studioSuccess(existing);
      }
      const definitionRef = normalizeAssetStudioExactDefinitionReference(
        command.definitionRef,
      );
      if (await this.dependencies.definitions.getDefinition(definitionRef)) {
        return studioFailure(
          "asset-studio.asset-draft.conflict",
          "The exact asset definition identity already exists.",
        );
      }
      const draftId = normalizeAssetStudioAssetDraftId(
        this.dependencies.nextDraftId(),
      );
      const implementationDraftId = normalizeAssetImplementationDraftId(
        `implementation.${draftId}`,
      );
      const semanticDefinition = normalizeAssetStudioSemanticDefinitionInput(
        command.semanticDefinition,
      );
      const source = await this.storeResources(
        command.workspaceId,
        command.resources,
      );
      const createdImplementation =
        await this.createImplementationDraft.execute({
          draftId: implementationDraftId,
          workspaceId: command.workspaceId,
          definitionRef,
          displayName: semanticDefinition.displayName,
          actorId: command.actorId,
        });
      if (!createdImplementation.ok) {
        return studioFailure(
          createdImplementation.error.code,
          createdImplementation.error.message,
        );
      }
      const at = this.dependencies.now();
      const record = normalizeAssetStudioAssetDraftRecord({
        draftId,
        workspaceId: command.workspaceId,
        definitionRef,
        semanticDefinition,
        implementationDraftId,
        source,
        status: "draft",
        revision: 1,
        provenance: {
          kind: "studio-from-scratch",
          ...(command.sourceLegacyDraftId
            ? { sourceLegacyDraftId: command.sourceLegacyDraftId }
            : {}),
          createdAt: at,
          createdBy: command.actorId,
        },
        createdAt: at,
        updatedAt: at,
        createdBy: command.actorId,
      });
      return studioSuccess(await this.dependencies.drafts.create(record));
    } catch {
      return studioFailure(
        "asset-studio.asset-draft.invalid",
        "The Studio asset draft is invalid or could not be persisted.",
      );
    }
  }

  public async update(
    command: UpdateAssetStudioAssetDraftCommand,
  ): Promise<AssetStudioResult<AssetStudioAssetDraftRecord>> {
    try {
      const current = await this.readRecord(
        command.workspaceId,
        command.draftId,
      );
      const checked = checkEditable(current, command.expectedRevision);
      if (!checked.ok) return checked;
      const semanticDefinition = normalizeAssetStudioSemanticDefinitionInput(
        command.semanticDefinition,
      );
      const source = await this.storeResources(
        command.workspaceId,
        command.resources,
      );
      const next = normalizeAssetStudioAssetDraftRecord({
        ...checked.value,
        semanticDefinition,
        source,
        status: "draft",
        revision: checked.value.revision + 1,
        review: undefined,
        publication: undefined,
        updatedAt: this.dependencies.now(),
      });
      return studioSuccess(
        await this.dependencies.drafts.update(next, command.expectedRevision),
      );
    } catch {
      return studioFailure(
        "asset-studio.asset-draft.invalid",
        "The Studio asset draft update is invalid or conflicted.",
      );
    }
  }

  public async read(
    query: ReadAssetStudioAssetDraftQuery,
  ): Promise<AssetStudioResult<AssetStudioAssetDraftView>> {
    try {
      const record = await this.readRecord(query.workspaceId, query.draftId);
      if (!record) {
        return studioFailure(
          "asset-studio.asset-draft.not-found",
          "Studio asset draft was not found.",
        );
      }
      return studioSuccess({
        record,
        resources: await this.readResources(record),
      });
    } catch {
      return studioFailure(
        "asset-studio.asset-draft.unavailable",
        "Studio asset draft resources could not be verified.",
      );
    }
  }

  public async list(
    query: ListAssetStudioAssetDraftsQuery,
  ): Promise<AssetStudioResult<AssetStudioAssetDraftListView>> {
    try {
      const page = await this.dependencies.drafts.list(query);
      return studioSuccess({
        drafts: page.records.map(toSummary),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      });
    } catch {
      return studioFailure(
        "asset-studio.asset-draft.unavailable",
        "Studio asset drafts could not be listed.",
      );
    }
  }

  public async review(
    command: TransitionAssetStudioAssetDraftCommand,
  ): Promise<AssetStudioResult<AssetStudioAssetDraftRecord>> {
    try {
      const current = await this.readRecord(
        command.workspaceId,
        command.draftId,
      );
      const checked = checkEditable(current, command.expectedRevision);
      if (!checked.ok) return checked;
      const definition = materializeDefinition(checked.value);
      const validation = validateAssetDefinition(definition, {
        options: { requireAiContextForResourceBackedAssets: true },
      });
      if (validation.status === "invalid") {
        return studioFailure(
          "asset-studio.asset-draft.validation",
          "The complete Studio asset definition is invalid.",
          validation.issues.map((issue) => ({
            severity: issue.severity,
            code: "asset-studio-asset-draft-invalid",
            message: issue.message,
            ...(issue.path ? { path: issue.path.join(".") } : {}),
          })),
        );
      }
      if (
        await this.dependencies.definitions.getDefinition(
          checked.value.definitionRef,
        )
      ) {
        return studioFailure(
          "asset-studio.asset-draft.conflict",
          "The exact asset definition identity already exists.",
        );
      }
      const bundle = materializeReviewBundle(
        await this.readResources(checked.value),
        definition,
      );
      const snapshot = await this.ensureReviewSnapshot(
        checked.value,
        JSON.stringify(bundle),
        command.actorId,
      );
      const at = this.dependencies.now();
      const next = normalizeAssetStudioAssetDraftRecord({
        ...checked.value,
        status: "reviewed",
        revision: checked.value.revision + 1,
        review: {
          sourceSnapshotId: snapshot.snapshotId,
          sourceArtifact: snapshot.artifact,
          materializedFromRevision: checked.value.revision,
          materializedAt: at,
          materializedBy: command.actorId,
        },
        publication: undefined,
        updatedAt: at,
      });
      return studioSuccess(
        await this.dependencies.drafts.update(next, command.expectedRevision),
      );
    } catch {
      return studioFailure(
        "asset-studio.asset-draft.unavailable",
        "The Studio asset draft could not be safely materialized for review.",
      );
    }
  }

  public async publish(
    command: TransitionAssetStudioAssetDraftCommand,
  ): Promise<AssetStudioResult<AssetStudioAssetDraftRecord>> {
    try {
      const current = await this.readRecord(
        command.workspaceId,
        command.draftId,
      );
      if (!current) {
        return studioFailure(
          "asset-studio.asset-draft.not-found",
          "Studio asset draft was not found.",
        );
      }
      if (current.revision !== command.expectedRevision) {
        return studioFailure(
          "asset-studio.asset-draft.conflict",
          "Studio asset draft revision is stale.",
        );
      }
      if (current.status === "published") return studioSuccess(current);
      if (current.status !== "reviewed" || !current.review) {
        return studioFailure(
          "asset-studio.asset-draft.conflict",
          "Only a reviewed Studio asset draft can be published.",
        );
      }
      const definition = await this.readReviewedDefinition(current);
      const validation = validateAssetDefinition(definition, {
        options: { requireAiContextForResourceBackedAssets: true },
      });
      if (
        validation.status === "invalid" ||
        !definitionMatchesReference(definition, current.definitionRef)
      ) {
        return studioFailure(
          "asset-studio.asset-draft.validation",
          "Reviewed source does not contain the proposed valid asset definition.",
        );
      }
      const existing = await this.dependencies.definitions.getDefinition(
        current.definitionRef,
      );
      if (existing && JSON.stringify(existing) !== JSON.stringify(definition)) {
        return studioFailure(
          "asset-studio.asset-draft.conflict",
          "The exact asset definition identity now has different content.",
        );
      }
      if (!existing)
        await this.dependencies.definitions.saveDefinition(definition);
      const at = this.dependencies.now();
      const next = normalizeAssetStudioAssetDraftRecord({
        ...current,
        status: "published",
        revision: current.revision + 1,
        publication: {
          definitionRef: current.definitionRef,
          implementationDraftId: current.implementationDraftId,
          sourceSnapshotId: current.review.sourceSnapshotId,
          publishedAt: at,
          publishedBy: command.actorId,
        },
        updatedAt: at,
      });
      return studioSuccess(
        await this.dependencies.drafts.update(next, command.expectedRevision),
      );
    } catch {
      return studioFailure(
        "asset-studio.asset-draft.unavailable",
        "The reviewed Studio asset draft could not be published safely.",
      );
    }
  }

  public async abandon(
    command: TransitionAssetStudioAssetDraftCommand,
  ): Promise<AssetStudioResult<AssetStudioAssetDraftRecord>> {
    try {
      const current = await this.readRecord(
        command.workspaceId,
        command.draftId,
      );
      if (!current) {
        return studioFailure(
          "asset-studio.asset-draft.not-found",
          "Studio asset draft was not found.",
        );
      }
      if (current.revision !== command.expectedRevision) {
        return studioFailure(
          "asset-studio.asset-draft.conflict",
          "Studio asset draft revision is stale.",
        );
      }
      if (current.status === "published") {
        return studioFailure(
          "asset-studio.asset-draft.conflict",
          "Published Studio asset drafts cannot be abandoned.",
        );
      }
      if (current.status === "abandoned") return studioSuccess(current);
      const next = normalizeAssetStudioAssetDraftRecord({
        ...current,
        status: "abandoned",
        revision: current.revision + 1,
        updatedAt: this.dependencies.now(),
      });
      return studioSuccess(
        await this.dependencies.drafts.update(next, command.expectedRevision),
      );
    } catch {
      return studioFailure(
        "asset-studio.asset-draft.unavailable",
        "The Studio asset draft could not be abandoned.",
      );
    }
  }

  private async findLegacyDraft(
    workspaceId: CreateAssetStudioAssetDraftCommand["workspaceId"],
    sourceLegacyDraftId: NonNullable<
      CreateAssetStudioAssetDraftCommand["sourceLegacyDraftId"]
    >,
  ): Promise<AssetStudioAssetDraftRecord | undefined> {
    let cursor: string | undefined;
    do {
      const page = await this.dependencies.drafts.list({
        workspaceId,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      const found = page.records.find(
        (record) =>
          record.provenance.sourceLegacyDraftId === sourceLegacyDraftId,
      );
      if (found) return found;
      cursor = page.nextCursor;
    } while (cursor);
    return undefined;
  }

  private readRecord(
    workspaceId: ReadAssetStudioAssetDraftQuery["workspaceId"],
    draftId: ReadAssetStudioAssetDraftQuery["draftId"],
  ) {
    return this.dependencies.drafts.read(
      workspaceId,
      normalizeAssetStudioAssetDraftId(draftId),
    );
  }

  private async storeResources(
    workspaceId: CreateAssetStudioAssetDraftCommand["workspaceId"],
    resources: readonly AssetImplementationBackingResourceFile[],
  ) {
    const bundle = normalizeEditableResourceBundle(resources);
    const artifact = await this.dependencies.artifacts.putImmutable({
      workspaceId,
      kind: "source",
      mediaType: ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE,
      content: JSON.stringify(bundle),
    });
    return {
      artifact,
      files: describeAssetImplementationBackingResourceFiles(bundle),
      totalCharacters: bundle.files.reduce(
        (total, file) => total + file.content.length,
        0,
      ),
    };
  }

  private async readResources(
    record: AssetStudioAssetDraftRecord,
  ): Promise<readonly AssetImplementationBackingResourceFile[]> {
    const stored = await this.dependencies.artifacts.readVerified<Uint8Array>(
      record.workspaceId,
      record.source.artifact,
    );
    const bundle = normalizeAssetImplementationBackingResourceBundle(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored)),
    );
    if (!sameResourceDescriptors(record, bundle)) {
      throw new Error(
        "Stored Studio backing resources differ from their descriptor.",
      );
    }
    return bundle.files;
  }

  private async ensureReviewSnapshot(
    record: AssetStudioAssetDraftRecord,
    content: string,
    actorId: string,
  ): Promise<AssetSourceSnapshot> {
    const snapshotId = normalizeAssetSourceSnapshotId(
      `source-snapshot.${record.draftId}.${record.revision}`,
    );
    const existing = await this.dependencies.implementations.readSourceSnapshot(
      record.workspaceId,
      snapshotId,
    );
    if (existing) {
      const stored = await this.dependencies.artifacts.readVerified<Uint8Array>(
        record.workspaceId,
        existing.artifact,
      );
      if (new TextDecoder().decode(stored) !== content) {
        throw new Error("Existing Studio review snapshot content differs.");
      }
      return existing;
    }
    const snapshotted = await this.snapshotImplementationSource.execute({
      snapshotId,
      workspaceId: record.workspaceId,
      draftId: record.implementationDraftId,
      content,
      mediaType: ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE,
      actorId,
    });
    if (!snapshotted.ok) throw new Error(snapshotted.error.message);
    return snapshotted.value;
  }

  private async readReviewedDefinition(
    record: AssetStudioAssetDraftRecord,
  ): Promise<AssetDefinition> {
    if (!record.review)
      throw new Error("Studio review evidence is unavailable.");
    const snapshot = await this.dependencies.implementations.readSourceSnapshot(
      record.workspaceId,
      record.review.sourceSnapshotId,
    );
    if (
      !snapshot ||
      !sameArtifact(snapshot.artifact, record.review.sourceArtifact)
    ) {
      throw new Error("Studio review snapshot is unavailable.");
    }
    const stored = await this.dependencies.artifacts.readVerified<Uint8Array>(
      record.workspaceId,
      snapshot.artifact,
    );
    const bundle = normalizeAssetImplementationBackingResourceBundle(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored)),
    );
    const definitionFile = bundle.files.find(
      (file) => file.path.toLowerCase() === DEFINITION_RESOURCE_PATH,
    );
    if (!definitionFile)
      throw new Error("Studio definition resource is missing.");
    return JSON.parse(definitionFile.content) as AssetDefinition;
  }
}

function checkEditable(
  current: AssetStudioAssetDraftRecord | undefined,
  expectedRevision: number,
): AssetStudioResult<AssetStudioAssetDraftRecord> {
  if (!current) {
    return studioFailure(
      "asset-studio.asset-draft.not-found",
      "Studio asset draft was not found.",
    );
  }
  if (current.revision !== expectedRevision) {
    return studioFailure(
      "asset-studio.asset-draft.conflict",
      "Studio asset draft revision is stale.",
    );
  }
  if (current.status === "published" || current.status === "abandoned") {
    return studioFailure(
      "asset-studio.asset-draft.conflict",
      "Closed Studio asset drafts cannot be changed.",
    );
  }
  return studioSuccess(current);
}

function normalizeEditableResourceBundle(
  resources: readonly AssetImplementationBackingResourceFile[],
): AssetImplementationBackingResourceBundleV1 {
  if (
    resources.some(
      (resource) => resource.path.toLowerCase() === DEFINITION_RESOURCE_PATH,
    )
  ) {
    throw new Error("The generated Studio definition resource is protected.");
  }
  return normalizeAssetImplementationBackingResourceBundle({
    formatVersion: "1.0",
    files: resources,
  });
}

function materializeReviewBundle(
  resources: readonly AssetImplementationBackingResourceFile[],
  definition: AssetDefinition,
): AssetImplementationBackingResourceBundleV1 {
  return normalizeAssetImplementationBackingResourceBundle({
    formatVersion: "1.0",
    files: [
      ...resources,
      {
        path: DEFINITION_RESOURCE_PATH,
        role: "other",
        mediaType: "application/json",
        content: JSON.stringify(definition, null, 2),
      } satisfies AssetImplementationBackingResourceFile,
    ].sort((left, right) => left.path.localeCompare(right.path)),
  });
}

function materializeDefinition(
  record: AssetStudioAssetDraftRecord,
): AssetDefinition {
  return {
    definitionId: record.definitionRef.id,
    version: record.definitionRef.version!,
    ...record.semanticDefinition,
    lifecycleStatus: "published",
    reviewStatus: "reviewed",
    provenance: {
      sourceKind: "human-authored",
      authorship: "human-authored",
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      createdBy: record.createdBy,
      updatedBy: record.createdBy,
      metadata: {
        studioDraftId: record.draftId,
        implementationDraftId: record.implementationDraftId,
        ...(record.provenance.sourceLegacyDraftId
          ? { sourceLegacyDraftId: record.provenance.sourceLegacyDraftId }
          : {}),
      },
    },
  };
}

function toSummary(
  record: AssetStudioAssetDraftRecord,
): AssetStudioAssetDraftSummary {
  return {
    draftId: record.draftId,
    definitionRef: record.definitionRef,
    implementationDraftId: record.implementationDraftId,
    displayName: record.semanticDefinition.displayName,
    assetType: record.semanticDefinition.assetType,
    assetFamily: record.semanticDefinition.assetFamily,
    status: record.status,
    revision: record.revision,
    ...(record.provenance.sourceLegacyDraftId
      ? { sourceLegacyDraftId: record.provenance.sourceLegacyDraftId }
      : {}),
    resourceCount: record.source.files.length,
    updatedAt: record.updatedAt,
  };
}

function sameResourceDescriptors(
  record: AssetStudioAssetDraftRecord,
  bundle: AssetImplementationBackingResourceBundleV1,
): boolean {
  const files = describeAssetImplementationBackingResourceFiles(bundle);
  return (
    JSON.stringify(files) === JSON.stringify(record.source.files) &&
    bundle.files.reduce((total, file) => total + file.content.length, 0) ===
      record.source.totalCharacters
  );
}

function sameArtifact(
  left: AssetImplementationArtifactDescriptor,
  right: AssetImplementationArtifactDescriptor,
): boolean {
  return (
    left.artifactId === right.artifactId &&
    left.digest === right.digest &&
    left.kind === right.kind &&
    left.mediaType === right.mediaType &&
    left.sizeBytes === right.sizeBytes
  );
}

function definitionMatchesReference(
  definition: AssetDefinition,
  reference: AssetReference,
): boolean {
  return (
    definition.definitionId === reference.id &&
    definition.version === reference.version
  );
}
