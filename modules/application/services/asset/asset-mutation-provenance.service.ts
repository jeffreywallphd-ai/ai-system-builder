import type {
  AssetMutationProvenance,
  AssetProvenance,
  AssetReference,
  AssetResourceBackedView,
  AssetSourceIdentity,
  FinalizeGeneratedOutputCommand,
  ImportExternalRepositoryObjectCommand,
  LocalizeExternalRepositoryObjectCommand,
  RegisterResourceBackedViewCommand,
} from "../../../contracts/asset";
import { sanitizeAssetMetadata, sanitizeAssetStringValue, sanitizeAssetViewValue } from "./asset-safe-metadata";

export class AssetMutationProvenanceService {
  public createForResourceBackedRegistration(input: {
    readonly command: RegisterResourceBackedViewCommand;
    readonly sourceIdentity: AssetSourceIdentity;
    readonly sourceView: AssetResourceBackedView;
    readonly createdAt: string;
  }): AssetMutationProvenance {
    const createdProvenance = this.createAssetProvenance(input);
    return {
      sourceIdentity: input.sourceIdentity,
      operation: "asset.register-resource-backed-view",
      actor: {
        initiatedBy: input.command.actor.initiatedBy,
        actorRef: sanitizeAssetStringValue(input.command.actor.actorRef),
        actorDisplayName: sanitizeAssetStringValue(input.command.actor.actorDisplayName),
        automationSafe: input.command.actor.automationSafe,
        thinClientSafe: input.command.actor.thinClientSafe,
      },
      approvalSummary: {
        userConfirmed: input.command.approval.userConfirmed,
        confirmationKind: input.command.approval.confirmationKind,
        confirmationTextVersion: sanitizeAssetStringValue(input.command.approval.confirmationTextVersion),
        allowNetworkAccess: input.command.approval.allowNetworkAccess,
        allowFilesystemWrite: input.command.approval.allowFilesystemWrite,
        allowCredentialUse: input.command.approval.allowCredentialUse,
        allowPartialCompletion: input.command.approval.allowPartialCompletion,
      },
      createdProvenance,
      reviewStatus: "reviewed",
      sourceSnapshot: sanitizeAssetMetadata({
        viewId: input.sourceIdentity.sourceViewId,
        viewKind: input.sourceView.viewKind,
        assetType: input.sourceView.assetType,
        assetFamily: input.sourceView.assetFamily,
        displayName: sanitizeAssetStringValue(input.sourceView.displayName),
        sourceRef: sanitizeAssetViewValue(input.sourceView.sourceRef),
        resourceBacking: input.sourceView.resourceBacking
          ? {
              backingId: input.sourceView.resourceBacking.backingId,
              resourceKind: input.sourceView.resourceBacking.resourceKind,
              role: input.sourceView.resourceBacking.role,
              contentType: input.sourceView.resourceBacking.contentType,
              format: input.sourceView.resourceBacking.format,
              sizeBytes: input.sourceView.resourceBacking.sizeBytes,
            }
          : undefined,
        metadata: sanitizeAssetMetadata(input.sourceView.metadata),
      }),
    };
  }

  public createForGeneratedOutputFinalization(input: {
    readonly command: FinalizeGeneratedOutputCommand;
    readonly sourceIdentity: AssetSourceIdentity;
    readonly sourceView: AssetResourceBackedView;
    readonly createdAt: string;
    readonly finalizedImage?: {
      readonly imageAssetId?: string;
      readonly backingArtifactId?: string;
      readonly createdAt?: string;
      readonly mediaType?: string;
      readonly width?: number;
      readonly height?: number;
      readonly seed?: number;
      readonly model?: string;
      readonly engine?: string;
    };
  }): AssetMutationProvenance {
    const createdProvenance = this.createGeneratedOutputAssetProvenance(input);
    return {
      sourceIdentity: input.sourceIdentity,
      operation: "asset.finalize-generated-output",
      actor: {
        initiatedBy: input.command.actor.initiatedBy,
        actorRef: sanitizeAssetStringValue(input.command.actor.actorRef),
        actorDisplayName: sanitizeAssetStringValue(input.command.actor.actorDisplayName),
        automationSafe: input.command.actor.automationSafe,
        thinClientSafe: input.command.actor.thinClientSafe,
      },
      approvalSummary: {
        userConfirmed: input.command.approval.userConfirmed,
        confirmationKind: input.command.approval.confirmationKind,
        confirmationTextVersion: sanitizeAssetStringValue(input.command.approval.confirmationTextVersion),
        allowNetworkAccess: input.command.approval.allowNetworkAccess,
        allowFilesystemWrite: input.command.approval.allowFilesystemWrite,
        allowCredentialUse: input.command.approval.allowCredentialUse,
        allowPartialCompletion: input.command.approval.allowPartialCompletion,
      },
      createdProvenance,
      reviewStatus: "reviewed",
      sourceSnapshot: sanitizeAssetMetadata({
        viewId: input.sourceIdentity.sourceViewId,
        viewKind: input.sourceView.viewKind,
        outputId: input.sourceView.generatedOutput?.outputId,
        assetType: input.sourceView.assetType,
        displayName: sanitizeAssetStringValue(input.sourceView.displayName),
        generatedOutput: sanitizeAssetViewValue({
          outputId: input.sourceView.generatedOutput?.outputId,
          runtimeCapabilityId: input.sourceView.generatedOutput?.runtimeCapabilityId,
          producedAssetType: input.sourceView.generatedOutput?.producedAssetType,
          producedAt: input.sourceView.generatedOutput?.producedAt,
        }),
        finalizedImage: sanitizeAssetMetadata(input.finalizedImage),
        metadata: sanitizeAssetMetadata(input.sourceView.metadata),
      }),
    };
  }

  public createForExternalRepositoryObjectImportOrLocalization(input: {
    readonly command: ImportExternalRepositoryObjectCommand | LocalizeExternalRepositoryObjectCommand;
    readonly sourceIdentity: AssetSourceIdentity;
    readonly importedOrLocalizedIdentity?: AssetSourceIdentity;
    readonly sourceView: AssetResourceBackedView;
    readonly createdAt: string;
    readonly result?: {
      readonly status?: string;
      readonly resultId?: string;
      readonly providerLabel?: string;
      readonly repositoryLabel?: string;
      readonly objectLabel?: string;
      readonly internalResourceRefs?: readonly AssetReference[];
    };
  }): AssetMutationProvenance {
    const createdProvenance = this.createExternalRepositoryObjectAssetProvenance(input);
    return {
      sourceIdentity: input.sourceIdentity,
      operation: input.command.operation,
      actor: {
        initiatedBy: input.command.actor.initiatedBy,
        actorRef: sanitizeAssetStringValue(input.command.actor.actorRef),
        actorDisplayName: sanitizeAssetStringValue(input.command.actor.actorDisplayName),
        automationSafe: input.command.actor.automationSafe,
        thinClientSafe: input.command.actor.thinClientSafe,
      },
      approvalSummary: {
        userConfirmed: input.command.approval.userConfirmed,
        confirmationKind: input.command.approval.confirmationKind,
        confirmationTextVersion: sanitizeAssetStringValue(input.command.approval.confirmationTextVersion),
        allowNetworkAccess: input.command.approval.allowNetworkAccess,
        allowFilesystemWrite: input.command.approval.allowFilesystemWrite,
        allowCredentialUse: input.command.approval.allowCredentialUse,
        allowPartialCompletion: input.command.approval.allowPartialCompletion,
      },
      createdProvenance,
      reviewStatus: "reviewed",
      sourceSnapshot: sanitizeAssetMetadata({
        viewId: input.sourceIdentity.sourceViewId,
        viewKind: input.sourceView.viewKind,
        assetType: input.sourceView.assetType,
        displayName: sanitizeAssetStringValue(input.sourceView.displayName),
        sourceRef: sanitizeAssetViewValue(input.sourceView.sourceRef),
        externalObject: sanitizeAssetViewValue({
          provider: input.sourceView.resourceBacking?.ref && typeof input.sourceView.resourceBacking.ref === "object"
            ? (input.sourceView.resourceBacking.ref as unknown as Record<string, unknown>).provider
            : undefined,
          repositoryId: input.sourceView.resourceBacking?.ref && typeof input.sourceView.resourceBacking.ref === "object"
            ? (input.sourceView.resourceBacking.ref as unknown as Record<string, unknown>).repositoryId
            : undefined,
          revision: input.sourceView.resourceBacking?.ref && typeof input.sourceView.resourceBacking.ref === "object"
            ? (input.sourceView.resourceBacking.ref as unknown as Record<string, unknown>).revision
            : undefined,
          objectKind: input.sourceView.resourceBacking?.ref && typeof input.sourceView.resourceBacking.ref === "object"
            ? (input.sourceView.resourceBacking.ref as unknown as Record<string, unknown>).objectKind
            : undefined,
        }),
        importedOrLocalized: sanitizeAssetMetadata({
          status: input.result?.status,
          resultId: input.result?.resultId,
          providerLabel: input.result?.providerLabel,
          repositoryLabel: input.result?.repositoryLabel,
          objectLabel: input.result?.objectLabel,
          internalResourceRefs: input.result?.internalResourceRefs,
          importedOrLocalizedDeduplicationKey: input.importedOrLocalizedIdentity?.deduplicationKey,
        }),
        metadata: sanitizeAssetMetadata(input.sourceView.metadata),
      }),
    };
  }

  public createAssetProvenance(input: {
    readonly command: RegisterResourceBackedViewCommand;
    readonly sourceIdentity: AssetSourceIdentity;
    readonly sourceView: AssetResourceBackedView;
    readonly createdAt: string;
  }): AssetProvenance {
    const sourceResourceRefs = sourceResourceRefsFor(input.sourceView);
    const actorName = sanitizeAssetStringValue(input.command.actor.actorDisplayName ?? input.command.actor.actorRef);
    return {
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      createdBy: actorName,
      updatedBy: actorName,
      sourceKind: sourceProvenanceKind(input.sourceView),
      sourceResourceRefs,
      derivedFromRefs: input.sourceView.sourceRef ? [input.sourceView.sourceRef] : undefined,
      authorship: input.command.actor.initiatedBy === "human"
        ? "human-authored"
        : input.command.actor.initiatedBy === "ai-assisted"
          ? "mixed"
          : "unknown",
      metadata: sanitizeAssetMetadata({
        operation: "asset.register-resource-backed-view",
        sourceViewId: input.sourceIdentity.sourceViewId,
        sourceViewKind: input.sourceIdentity.sourceViewKind,
        sourceSystem: input.sourceIdentity.sourceSystem,
        sourceId: input.sourceIdentity.sourceId,
        sourceFingerprint: input.sourceIdentity.sourceFingerprint,
        deduplicationKey: input.sourceIdentity.deduplicationKey,
        idempotencyKey: sanitizeAssetStringValue(input.command.context?.idempotencyKey),
        initiatedBy: input.command.actor.initiatedBy,
      }),
    };
  }

  public createGeneratedOutputAssetProvenance(input: {
    readonly command: FinalizeGeneratedOutputCommand;
    readonly sourceIdentity: AssetSourceIdentity;
    readonly sourceView: AssetResourceBackedView;
    readonly createdAt: string;
    readonly finalizedImage?: {
      readonly imageAssetId?: string;
      readonly backingArtifactId?: string;
      readonly createdAt?: string;
      readonly mediaType?: string;
      readonly width?: number;
      readonly height?: number;
      readonly seed?: number;
      readonly model?: string;
      readonly engine?: string;
    };
  }): AssetProvenance {
    const refs = sourceResourceRefsFor(input.sourceView);
    const actorName = sanitizeAssetStringValue(input.command.actor.actorDisplayName ?? input.command.actor.actorRef);
    return {
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      createdBy: actorName,
      updatedBy: actorName,
      sourceKind: "runtime-generated",
      sourceResourceRefs: refs,
      derivedFromRefs: input.sourceView.generatedOutput?.sourceRefs,
      authorship: "ai-generated",
      redactedGenerationSummary: "Generated image output finalized into a managed image asset.",
      metadata: sanitizeAssetMetadata({
        operation: "asset.finalize-generated-output",
        sourceViewId: input.sourceIdentity.sourceViewId,
        sourceViewKind: input.sourceIdentity.sourceViewKind,
        sourceSystem: input.sourceIdentity.sourceSystem,
        sourceId: input.sourceIdentity.sourceId,
        sourceFingerprint: input.sourceIdentity.sourceFingerprint,
        deduplicationKey: input.sourceIdentity.deduplicationKey,
        generatedOutputId: input.sourceView.generatedOutput?.outputId,
        finalizedImage: input.finalizedImage,
        idempotencyKey: sanitizeAssetStringValue(input.command.context?.idempotencyKey),
        initiatedBy: input.command.actor.initiatedBy,
      }),
    };
  }

  public createExternalRepositoryObjectAssetProvenance(input: {
    readonly command: ImportExternalRepositoryObjectCommand | LocalizeExternalRepositoryObjectCommand;
    readonly sourceIdentity: AssetSourceIdentity;
    readonly importedOrLocalizedIdentity?: AssetSourceIdentity;
    readonly sourceView: AssetResourceBackedView;
    readonly createdAt: string;
    readonly result?: {
      readonly status?: string;
      readonly resultId?: string;
      readonly providerLabel?: string;
      readonly repositoryLabel?: string;
      readonly objectLabel?: string;
      readonly internalResourceRefs?: readonly AssetReference[];
    };
  }): AssetProvenance {
    const refs = input.result?.internalResourceRefs?.length
      ? input.result.internalResourceRefs
      : sourceResourceRefsFor(input.sourceView);
    const actorName = sanitizeAssetStringValue(input.command.actor.actorDisplayName ?? input.command.actor.actorRef);
    return {
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      createdBy: actorName,
      updatedBy: actorName,
      sourceKind: "imported",
      sourceResourceRefs: refs,
      derivedFromRefs: input.sourceView.sourceRef ? [input.sourceView.sourceRef] : undefined,
      authorship: input.command.actor.initiatedBy === "human"
        ? "human-authored"
        : input.command.actor.initiatedBy === "ai-assisted"
          ? "mixed"
          : "unknown",
      metadata: sanitizeAssetMetadata({
        operation: input.command.operation,
        sourceViewId: input.sourceIdentity.sourceViewId,
        sourceViewKind: input.sourceIdentity.sourceViewKind,
        sourceSystem: input.sourceIdentity.sourceSystem,
        sourceId: input.sourceIdentity.sourceId,
        sourceFingerprint: input.sourceIdentity.sourceFingerprint,
        deduplicationKey: input.sourceIdentity.deduplicationKey,
        importedOrLocalizedIdentity: input.importedOrLocalizedIdentity,
        result: input.result,
        idempotencyKey: sanitizeAssetStringValue(input.command.context?.idempotencyKey),
        initiatedBy: input.command.actor.initiatedBy,
      }),
    };
  }
}

export const assetMutationProvenanceService = new AssetMutationProvenanceService();

function sourceProvenanceKind(view: AssetResourceBackedView): AssetProvenance["sourceKind"] {
  if (view.viewKind === "generated-output") return "runtime-generated";
  if (view.viewKind === "external-repository-object") return "imported";
  return "system-generated";
}

function sourceResourceRefsFor(view: AssetResourceBackedView): readonly AssetReference[] | undefined {
  const refs: AssetReference[] = [];
  for (const candidate of [
    view.sourceRef,
    view.resourceBackedAsset?.assetRef,
    view.resourceBackedAsset?.primaryBackingRef,
    ...(view.resourceBackedAsset?.previewRefs ?? []),
    assetReferenceFromUnknown(view.resourceBacking?.ref),
  ]) {
    if (candidate && !refs.some((ref) => ref.kind === candidate.kind && ref.id === candidate.id && ref.version === candidate.version)) {
      refs.push(candidate);
    }
  }
  return refs.length ? refs : undefined;
}

function assetReferenceFromUnknown(value: unknown): AssetReference | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.kind !== "string" || typeof record.id !== "string") return undefined;
  return sanitizeAssetViewValue(value) as AssetReference;
}
