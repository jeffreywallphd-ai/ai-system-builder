import type { AssetDefinitionRepositoryPort } from "../../ports/asset";
import type { AssetDerivedCustomizationRepositoryPort } from "../../ports/asset-authoring";
import type {
  AssetImplementationArtifactPort,
  AssetImplementationRepositoryPort,
} from "../../ports/asset-implementation";
import {
  AssetDerivedCustomizationTargetCatalogService,
  validateAssetDefinition,
} from "../../services/asset";
import type {
  AssetDefinition,
  AssetMetadata,
  AssetReference,
} from "../../../contracts/asset";
import {
  ASSET_CUSTOMIZATION_SOURCE_OVERLAY_MEDIA_TYPE,
  createAssetCustomizationSourceOverlayDescriptor,
  normalizeAssetCustomizationId,
  normalizeAssetCustomizationSourceChanges,
  normalizeAssetCustomizationSourceOverlay,
  normalizeAssetDerivedCustomizationDraftRecord,
  normalizeAssetDerivedCustomizationSemanticPatch,
  normalizeExactAssetDefinitionReference,
  type AbandonAssetDerivedCustomizationCommand,
  type AbandonAssetDerivedCustomizationResult,
  type AssetCustomizationSourceFileChange,
  type AssetCustomizationSourceOverlayV1,
  type AssetDerivedCustomizationDraftRecord,
  type AssetDerivedCustomizationSemanticPatch,
  type AssetDerivedCustomizationTargetDetail,
  type CreateAssetDerivedCustomizationCommand,
  type CreateAssetDerivedCustomizationResult,
  type ListAssetDerivedCustomizationsQuery,
  type PublishAssetDerivedCustomizationCommand,
  type PublishAssetDerivedCustomizationResult,
  type ReviewAssetDerivedCustomizationCommand,
  type ReviewAssetDerivedCustomizationResult,
  type UpdateAssetDerivedCustomizationCommand,
  type UpdateAssetDerivedCustomizationResult,
} from "../../../contracts/asset-authoring";
import {
  ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE,
  normalizeAssetImplementationBackingResourceBundle,
  normalizeAssetImplementationDraftId,
  normalizeAssetSourceSnapshotId,
  type AssetImplementationArtifactDescriptor,
  type AssetImplementationBackingResourceBundleV1,
  type AssetImplementationBackingResourceFile,
  type AssetSourceSnapshot,
  type AssetImplementationReleaseId,
  type AssetSourceSnapshotId,
  type Sha256Digest,
} from "../../../contracts/asset-implementation";
import {
  CreateAssetImplementationDraftUseCase,
  SnapshotAssetImplementationSourceUseCase,
} from "../asset-implementation";
import { fail } from "./asset-authoring-use-case-results";

export class AssetDerivedCustomizationWorkflowUseCase {
  private readonly createImplementationDraft: CreateAssetImplementationDraftUseCase;
  private readonly snapshotImplementationSource: SnapshotAssetImplementationSourceUseCase;

  public constructor(
    private readonly dependencies: {
      readonly customizations: AssetDerivedCustomizationRepositoryPort;
      readonly targets: AssetDerivedCustomizationTargetCatalogService;
      readonly definitions: AssetDefinitionRepositoryPort;
      readonly implementations: AssetImplementationRepositoryPort;
      readonly artifacts: AssetImplementationArtifactPort;
      readonly digestText: (value: string) => Sha256Digest;
      readonly nextCustomizationId: () => string;
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
    command: CreateAssetDerivedCustomizationCommand,
  ): Promise<CreateAssetDerivedCustomizationResult> {
    try {
      const target = await this.dependencies.targets.read({
        workspaceId: command.workspaceId,
        definitionRef: command.baseDefinitionRef,
        implementationReleaseId: command.baseImplementationReleaseId,
      });
      if (!isUsableTarget(target)) {
        return fail(
          "unsupported",
          target?.eligibility.message ?? "The exact customization base is unavailable.",
        );
      }
      const derivedDefinitionRef = normalizeExactAssetDefinitionReference(
        command.derivedDefinitionRef,
      );
      if (sameReference(target.definitionRef, derivedDefinitionRef)) {
        return fail(
          "validation",
          "The derived definition identity must differ from its base.",
        );
      }
      if (await this.dependencies.definitions.getDefinition(derivedDefinitionRef)) {
        return fail(
          "conflict",
          "The proposed exact asset definition identity already exists.",
        );
      }
      const semanticPatch = normalizeAssetDerivedCustomizationSemanticPatch(
        command.semanticPatch,
      );
      const sourceOverlay = command.sourceChanges
        ? await this.storeSourceOverlay(command.workspaceId, command.sourceChanges)
        : undefined;
      const at = this.dependencies.now();
      const record = normalizeAssetDerivedCustomizationDraftRecord({
        customizationId: normalizeAssetCustomizationId(
          this.dependencies.nextCustomizationId(),
        ),
        workspaceId: command.workspaceId,
        base: {
          definitionRef: target.definitionRef,
          implementationReleaseId: target.implementationReleaseId,
          sourceSnapshotId: target.baseSourceSnapshotId,
          sourceArtifact: target.baseSourceArtifact,
        },
        derivedDefinitionRef,
        semanticPatch,
        ...(sourceOverlay ? { sourceOverlay } : {}),
        status: "draft",
        revision: 1,
        provenance: {
          kind: "layered-derived-customization",
          sourceKind: target.sourceKind,
          baseDefinitionRef: target.definitionRef,
          baseImplementationReleaseId: target.implementationReleaseId,
          baseSourceSnapshotId: target.baseSourceSnapshotId,
          derivedAt: at,
          derivedBy: command.actorId,
        },
        createdAt: at,
        updatedAt: at,
        createdBy: command.actorId,
      });
      return {
        kind: "success",
        value: await this.dependencies.customizations.create(record),
      };
    } catch {
      return fail(
        "validation",
        "The derived customization request is invalid or could not be persisted.",
      );
    }
  }

  public async update(
    command: UpdateAssetDerivedCustomizationCommand,
  ): Promise<UpdateAssetDerivedCustomizationResult> {
    try {
      if (command.clearSourceOverlay && command.sourceChanges) {
        return fail(
          "validation",
          "A source overlay cannot be cleared and replaced in one request.",
        );
      }
      const current = await this.dependencies.customizations.read(
        command.workspaceId,
        normalizeAssetCustomizationId(command.customizationId),
      );
      if (!current) return fail("not-found", "Derived customization was not found.");
      if (current.revision !== command.expectedRevision) {
        return fail("conflict", "Derived customization revision is stale.");
      }
      if (["published", "abandoned"].includes(current.status)) {
        return fail("conflict", "Closed customizations cannot be updated.");
      }
      const target = await this.readPinnedTarget(current);
      if (!isPinnedBaseCurrent(current, target)) {
        return fail(
          "conflict",
          "The exact base implementation or backing resource changed or is unavailable.",
        );
      }
      const semanticPatch = normalizeAssetDerivedCustomizationSemanticPatch(
        command.semanticPatch,
      );
      const sourceOverlay = command.sourceChanges
        ? await this.storeSourceOverlay(command.workspaceId, command.sourceChanges)
        : command.clearSourceOverlay
          ? undefined
          : current.sourceOverlay;
      const next = normalizeAssetDerivedCustomizationDraftRecord({
        ...current,
        semanticPatch,
        ...(sourceOverlay ? { sourceOverlay } : { sourceOverlay: undefined }),
        status: "draft",
        revision: current.revision + 1,
        review: undefined,
        publication: undefined,
        updatedAt: this.dependencies.now(),
      });
      return {
        kind: "success",
        value: await this.dependencies.customizations.update(
          next,
          command.expectedRevision,
        ),
      };
    } catch {
      return fail(
        "validation",
        "The derived customization update is invalid or conflicted.",
      );
    }
  }

  public async review(
    command: ReviewAssetDerivedCustomizationCommand,
  ): Promise<ReviewAssetDerivedCustomizationResult> {
    try {
      const current = await this.dependencies.customizations.read(
        command.workspaceId,
        normalizeAssetCustomizationId(command.customizationId),
      );
      if (!current) return fail("not-found", "Derived customization was not found.");
      if (current.revision !== command.expectedRevision) {
        return fail("conflict", "Derived customization revision is stale.");
      }
      if (["published", "abandoned"].includes(current.status)) {
        return fail("conflict", "Closed customizations cannot be reviewed.");
      }
      const target = await this.readPinnedTarget(current);
      if (!isPinnedBaseCurrent(current, target)) {
        return fail(
          "conflict",
          "The exact base implementation or backing resource changed or is unavailable.",
        );
      }
      const nextRevision = current.revision + 1;
      const definition = materializeDerivedDefinition(current, target.definition);
      const validation = validateAssetDefinition(definition);
      if (validation.status === "invalid") {
        return fail(
          "validation",
          "The complete derived asset definition is invalid.",
          validation.issues.map((issue) => ({
            severity: issue.severity,
            code: "asset-authoring-publication-invalid",
            message: issue.message,
          })),
        );
      }
      const overlay = current.sourceOverlay
        ? await this.readSourceOverlay(current)
        : undefined;
      const bundle = materializeBackingBundle(
        target.backingResources,
        overlay?.changes ?? [],
        definition,
      );
      const snapshot = await this.ensureReviewedSnapshot(
        current,
        nextRevision,
        JSON.stringify(bundle),
        command.actorId,
      );
      const at = this.dependencies.now();
      const next = normalizeAssetDerivedCustomizationDraftRecord({
        ...current,
        status: "reviewed",
        revision: nextRevision,
        review: {
          implementationDraftId: snapshot.draftId,
          sourceSnapshotId: snapshot.snapshotId,
          sourceArtifact: snapshot.artifact,
          semanticPatchDigest: this.dependencies.digestText(
            JSON.stringify(current.semanticPatch),
          ),
          ...(current.sourceOverlay
            ? { sourceOverlayDigest: current.sourceOverlay.artifact.digest }
            : {}),
          materializedFromRevision: nextRevision,
          materializedAt: at,
          materializedBy: command.actorId,
        },
        publication: undefined,
        updatedAt: at,
      });
      return {
        kind: "success",
        value: await this.dependencies.customizations.update(
          next,
          command.expectedRevision,
        ),
      };
    } catch {
      return fail(
        "unavailable",
        "The derived customization could not be safely materialized for review.",
      );
    }
  }

  public async publish(
    command: PublishAssetDerivedCustomizationCommand,
  ): Promise<PublishAssetDerivedCustomizationResult> {
    try {
      const current = await this.dependencies.customizations.read(
        command.workspaceId,
        normalizeAssetCustomizationId(command.customizationId),
      );
      if (!current) return fail("not-found", "Derived customization was not found.");
      if (current.revision !== command.expectedRevision) {
        return fail("conflict", "Derived customization revision is stale.");
      }
      if (current.status !== "reviewed" || !current.review) {
        return fail("conflict", "Only a reviewed customization can be published.");
      }
      const target = await this.readPinnedTarget(current);
      if (!isPinnedBaseCurrent(current, target)) {
        return fail(
          "conflict",
          "The exact base implementation or backing resource changed or is unavailable.",
        );
      }
      const definition = await this.readReviewedDefinition(current);
      const validation = validateAssetDefinition(definition);
      if (
        validation.status === "invalid" ||
        !definitionMatchesReference(definition, current.derivedDefinitionRef)
      ) {
        return fail(
          "validation",
          "Reviewed source does not contain the proposed valid asset definition.",
        );
      }
      const existing = await this.dependencies.definitions.getDefinition(
        current.derivedDefinitionRef,
      );
      if (existing && JSON.stringify(existing) !== JSON.stringify(definition)) {
        return fail(
          "conflict",
          "The proposed exact asset definition identity now has different content.",
        );
      }
      if (!existing) await this.dependencies.definitions.saveDefinition(definition);
      const at = this.dependencies.now();
      const next = normalizeAssetDerivedCustomizationDraftRecord({
        ...current,
        status: "published",
        revision: current.revision + 1,
        publication: {
          definitionRef: current.derivedDefinitionRef,
          implementationDraftId: current.review.implementationDraftId,
          sourceSnapshotId: current.review.sourceSnapshotId,
          publishedAt: at,
          publishedBy: command.actorId,
        },
        updatedAt: at,
      });
      return {
        kind: "success",
        value: await this.dependencies.customizations.update(
          next,
          command.expectedRevision,
        ),
      };
    } catch {
      return fail(
        "unavailable",
        "The reviewed customization could not be published safely.",
      );
    }
  }

  public async abandon(
    command: AbandonAssetDerivedCustomizationCommand,
  ): Promise<AbandonAssetDerivedCustomizationResult> {
    try {
      const current = await this.dependencies.customizations.read(
        command.workspaceId,
        normalizeAssetCustomizationId(command.customizationId),
      );
      if (!current) return fail("not-found", "Derived customization was not found.");
      if (current.revision !== command.expectedRevision) {
        return fail("conflict", "Derived customization revision is stale.");
      }
      if (current.status === "published") {
        return fail("conflict", "Published customizations cannot be abandoned.");
      }
      if (current.status === "abandoned") {
        return { kind: "success", value: current };
      }
      const next = normalizeAssetDerivedCustomizationDraftRecord({
        ...current,
        status: "abandoned",
        revision: current.revision + 1,
        updatedAt: this.dependencies.now(),
      });
      return {
        kind: "success",
        value: await this.dependencies.customizations.update(
          next,
          command.expectedRevision,
        ),
      };
    } catch {
      return fail("unavailable", "The customization could not be abandoned.");
    }
  }

  public read(
    workspaceId: ListAssetDerivedCustomizationsQuery["workspaceId"],
    customizationId: string,
  ) {
    return this.dependencies.customizations.read(
      workspaceId,
      normalizeAssetCustomizationId(customizationId),
    );
  }

  public list(query: ListAssetDerivedCustomizationsQuery) {
    return this.dependencies.customizations.list(query);
  }

  private async storeSourceOverlay(
    workspaceId: CreateAssetDerivedCustomizationCommand["workspaceId"],
    changesValue: readonly AssetCustomizationSourceFileChange[],
  ) {
    const changes = normalizeAssetCustomizationSourceChanges(changesValue);
    const overlay: AssetCustomizationSourceOverlayV1 = {
      formatVersion: "1.0",
      changes,
    };
    const artifact = await this.dependencies.artifacts.putImmutable({
      workspaceId,
      kind: "source",
      mediaType: ASSET_CUSTOMIZATION_SOURCE_OVERLAY_MEDIA_TYPE,
      content: JSON.stringify(overlay),
    });
    return createAssetCustomizationSourceOverlayDescriptor(artifact, changes);
  }

  private async readSourceOverlay(
    record: AssetDerivedCustomizationDraftRecord,
  ): Promise<AssetCustomizationSourceOverlayV1> {
    if (!record.sourceOverlay) throw new Error("Source overlay is unavailable.");
    const stored = await this.dependencies.artifacts.readVerified<Uint8Array>(
      record.workspaceId,
      record.sourceOverlay.artifact,
    );
    return normalizeAssetCustomizationSourceOverlay(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored)),
    );
  }

  private readPinnedTarget(record: AssetDerivedCustomizationDraftRecord) {
    return this.dependencies.targets.read({
      workspaceId: record.workspaceId,
      definitionRef: record.base.definitionRef,
      implementationReleaseId: record.base.implementationReleaseId,
    });
  }

  private async ensureReviewedSnapshot(
    record: AssetDerivedCustomizationDraftRecord,
    revision: number,
    content: string,
    actorId: string,
  ): Promise<AssetSourceSnapshot> {
    const draftId = normalizeAssetImplementationDraftId(
      `implementation-draft.${record.customizationId}.${revision}`,
    );
    const snapshotId = normalizeAssetSourceSnapshotId(
      `source-snapshot.${record.customizationId}.${revision}`,
    );
    const existingSnapshot =
      await this.dependencies.implementations.readSourceSnapshot(
        record.workspaceId,
        snapshotId,
      );
    if (existingSnapshot) {
      const stored = await this.dependencies.artifacts.readVerified<Uint8Array>(
        record.workspaceId,
        existingSnapshot.artifact,
      );
      if (new TextDecoder().decode(stored) !== content) {
        throw new Error("Existing reviewed snapshot content differs.");
      }
      return existingSnapshot;
    }
    const existingDraft = await this.dependencies.implementations.readDraft(
      record.workspaceId,
      draftId,
    );
    if (!existingDraft) {
      const created = await this.createImplementationDraft.execute({
        draftId,
        workspaceId: record.workspaceId,
        definitionRef: record.derivedDefinitionRef,
        displayName: displayName(record),
        actorId,
      });
      if (!created.ok) throw new Error(created.error.message);
    } else if (!sameReference(existingDraft.definitionRef, record.derivedDefinitionRef)) {
      throw new Error("Existing implementation draft identity differs.");
    }
    const snapshotted = await this.snapshotImplementationSource.execute({
      snapshotId,
      workspaceId: record.workspaceId,
      draftId,
      content,
      mediaType: ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE,
      actorId,
    });
    if (!snapshotted.ok) throw new Error(snapshotted.error.message);
    return snapshotted.value;
  }

  private async readReviewedDefinition(
    record: AssetDerivedCustomizationDraftRecord,
  ): Promise<AssetDefinition> {
    if (!record.review) throw new Error("Review evidence is unavailable.");
    const snapshot = await this.dependencies.implementations.readSourceSnapshot(
      record.workspaceId,
      record.review.sourceSnapshotId,
    );
    if (!snapshot || !sameArtifact(snapshot.artifact, record.review.sourceArtifact)) {
      throw new Error("Reviewed source snapshot is unavailable.");
    }
    const stored = await this.dependencies.artifacts.readVerified<Uint8Array>(
      record.workspaceId,
      snapshot.artifact,
    );
    const bundle = normalizeAssetImplementationBackingResourceBundle(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored)),
    );
    const definitionFile = bundle.files.find(
      (file) => file.path.toLowerCase() === "other/definition.json",
    );
    if (!definitionFile) throw new Error("Reviewed definition resource is missing.");
    return JSON.parse(definitionFile.content) as AssetDefinition;
  }
}

function isUsableTarget(
  target: Awaited<ReturnType<AssetDerivedCustomizationTargetCatalogService["read"]>>,
): target is AssetDerivedCustomizationTargetDetail & {
  definition: AssetDefinition;
  implementationReleaseId: AssetImplementationReleaseId;
  baseSourceSnapshotId: AssetSourceSnapshotId;
  baseSourceArtifact: AssetImplementationArtifactDescriptor;
} {
  return Boolean(
    target?.eligibility.eligible &&
      target.definition &&
      target.implementationReleaseId &&
      target.baseSourceSnapshotId &&
      target.baseSourceArtifact,
  );
}

function isPinnedBaseCurrent(
  record: AssetDerivedCustomizationDraftRecord,
  target: Awaited<ReturnType<AssetDerivedCustomizationTargetCatalogService["read"]>>,
): target is AssetDerivedCustomizationTargetDetail & {
  definition: AssetDefinition;
  implementationReleaseId: AssetImplementationReleaseId;
  baseSourceSnapshotId: AssetSourceSnapshotId;
  baseSourceArtifact: AssetImplementationArtifactDescriptor;
} {
  return Boolean(
    isUsableTarget(target) &&
      target.baseSourceSnapshotId === record.base.sourceSnapshotId &&
      sameArtifact(target.baseSourceArtifact, record.base.sourceArtifact),
  );
}

function materializeDerivedDefinition(
  record: AssetDerivedCustomizationDraftRecord,
  base: AssetDefinition,
): AssetDefinition {
  const patch = record.semanticPatch as AssetDerivedCustomizationSemanticPatch &
    Record<string, unknown>;
  const metadata = mergeMetadata(base.metadata, patch);
  return {
    ...base,
    definitionId: record.derivedDefinitionRef.id,
    version: record.derivedDefinitionRef.version!,
    displayName:
      typeof patch["display-name"] === "string"
        ? patch["display-name"]
        : base.displayName,
    description:
      typeof patch.description === "string" ? patch.description : base.description,
    lifecycleStatus: "published",
    reviewStatus: "reviewed",
    provenance: {
      sourceKind: "human-authored",
      sourceAssetRefs: [record.base.definitionRef],
      derivedFromRefs: [record.base.definitionRef],
      authorship: "human-authored",
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      createdBy: record.createdBy,
      updatedBy: record.createdBy,
      metadata: {
        customizationId: record.customizationId,
        baseImplementationReleaseId: record.base.implementationReleaseId,
        baseSourceSnapshotId: record.base.sourceSnapshotId,
      },
    },
    ...(patch["configuration-schema"] === undefined
      ? {}
      : { configurationSchema: patch["configuration-schema"] }),
    ...(patch["default-configuration"] === undefined
      ? {}
      : { defaultConfiguration: patch["default-configuration"] }),
    ...(patch.ports === undefined ? {} : { ports: patch.ports }),
    ...(patch["ai-context"] === undefined
      ? {}
      : { aiContext: patch["ai-context"] }),
    ...(patch.requirements === undefined
      ? {}
      : { requirements: patch.requirements }),
    ...(patch["composition-rules"] === undefined
      ? {}
      : { compositionRules: patch["composition-rules"] }),
    ...(patch.dependencies === undefined
      ? {}
      : { dependencies: patch.dependencies }),
    ...(metadata ? { metadata } : {}),
  };
}

function mergeMetadata(
  base: AssetMetadata | undefined,
  patch: AssetDerivedCustomizationSemanticPatch,
): AssetMetadata | undefined {
  const safe = patch["safe-metadata"];
  const metadata: Record<string, unknown> = {
    ...(base ?? {}),
    ...(safe && typeof safe === "object" && !Array.isArray(safe) ? safe : {}),
  };
  if (patch.summary !== undefined) metadata.summary = patch.summary;
  if (patch.tags !== undefined) metadata.tags = patch.tags;
  if (patch.classification !== undefined) {
    metadata.classification = patch.classification;
  }
  return Object.keys(metadata).length > 0 ? (metadata as AssetMetadata) : undefined;
}

function materializeBackingBundle(
  baseResources: readonly {
    path: string;
    role: AssetImplementationBackingResourceFile["role"];
    mediaType: string;
    content: string;
    editable: boolean;
  }[],
  changes: readonly AssetCustomizationSourceFileChange[],
  definition: AssetDefinition,
): AssetImplementationBackingResourceBundleV1 {
  const files = new Map<string, AssetImplementationBackingResourceFile>();
  for (const resource of baseResources) {
    files.set(resource.path.toLowerCase(), {
      path: resource.path,
      role: resource.role,
      mediaType: resource.mediaType,
      content: resource.content,
    });
  }
  for (const change of normalizeAssetCustomizationSourceChanges(changes)) {
    const key = change.path.toLowerCase();
    if (key === "other/definition.json") {
      throw new Error("The generated definition resource is protected.");
    }
    const existing = baseResources.find(
      (resource) => resource.path.toLowerCase() === key,
    );
    if (existing && !existing.editable) {
      throw new Error("Read-only backing resources cannot be changed.");
    }
    if (change.operation === "delete") {
      if (!existing) {
        throw new Error("Only an existing editable resource can be deleted.");
      }
      files.delete(key);
    } else {
      files.set(key, {
        path: change.path,
        role: change.role ?? existing?.role ?? "other",
        mediaType:
          change.mediaType ?? existing?.mediaType ?? "text/typescript",
        content: change.content,
      });
    }
  }
  files.set("other/definition.json", {
    path: "other/definition.json",
    role: "other",
    mediaType: "application/json",
    content: JSON.stringify(definition, null, 2),
  });
  return normalizeAssetImplementationBackingResourceBundle({
    formatVersion: "1.0",
    files: [...files.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
  });
}

function displayName(record: AssetDerivedCustomizationDraftRecord): string {
  return typeof record.semanticPatch["display-name"] === "string"
    ? record.semanticPatch["display-name"]
    : String(record.derivedDefinitionRef.id);
}

function sameReference(left: AssetReference, right: AssetReference): boolean {
  return left.id === right.id && left.version === right.version;
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
