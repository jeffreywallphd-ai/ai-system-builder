import type {
  AssetMetadata,
  AssetReference,
  AssetResourceBackedView,
  AssetResourceBacking,
  AssetSourceIdentity,
  AssetSourceIdentityKind,
  AssetSourceSystem,
  AssetValidationIssue,
} from "../../../contracts/asset";
import { normalizeAssetId } from "../../../contracts/asset";
import { sanitizeAssetStringValue, sanitizeAssetViewValue } from "./asset-safe-metadata";

export interface AssetSourceIdentityResult {
  readonly ok: boolean;
  readonly sourceIdentity?: AssetSourceIdentity;
  readonly diagnostics?: readonly { readonly code: string; readonly message: string; readonly metadata?: AssetMetadata }[];
  readonly validationIssues?: readonly AssetValidationIssue[];
}

export interface FinalizedGeneratedImageIdentityInput {
  readonly imageAssetId: string;
  readonly backingArtifactId: string;
  readonly displayName?: string;
  readonly mediaType?: string;
  readonly createdAt?: string;
}

export interface ImportedOrLocalizedExternalObjectIdentityInput {
  readonly operation: "import" | "localize";
  readonly sourceIdentity: AssetSourceIdentity;
  readonly resourceRefs: readonly AssetReference[];
  readonly backings: readonly AssetResourceBacking[];
}

export class AssetSourceIdentityService {
  public deriveFromResourceBackedView(view: AssetResourceBackedView): AssetSourceIdentityResult {
    const sourceKind = sourceKindForView(view);
    const sourceSystem = sourceSystemForView(view);
    const safeViewId = safeIdentityPart(view.viewId, "view");
    const primaryBacking = primaryBackingFor(view);
    const seed = sourceSeedFor(view, primaryBacking);

    if (!seed) {
      return failure("resource-backed-view-source-identity-missing", "Resource-backed view does not expose a reliable safe source identity.");
    }

    const safeSourceId = safeIdentityPart(seed, sourceKind);
    const sourceFingerprint = stableHash(JSON.stringify(sanitizeAssetViewValue({
      sourceKind,
      sourceSystem,
      viewKind: view.viewKind,
      sourceId: safeSourceId,
      assetType: view.assetType,
      resourceKind: primaryBacking?.resourceKind,
      backingId: primaryBacking?.backingId ? safeIdentityPart(primaryBacking.backingId, "backing") : undefined,
    })));
    const backingRefs = safeBackingsFor(view);

    const sourceIdentity: AssetSourceIdentity = {
      sourceKind,
      sourceViewId: safeViewId,
      sourceViewKind: view.viewKind,
      sourceAssetType: view.assetType,
      sourceResourceKind: primaryBacking?.resourceKind,
      sourceSystem,
      sourceId: safeSourceId,
      sourceFingerprint,
      ...(backingRefs.length ? { backingRefs } : {}),
      deduplicationKey: `asset-source.${sourceKind}.${stableHash([
        sourceSystem,
        view.viewKind,
        safeSourceId,
        sourceFingerprint,
      ].join("|"))}`,
    };

    return { ok: true, sourceIdentity };
  }

  public deriveFromFinalizedGeneratedImage(
    finalizedImage: FinalizedGeneratedImageIdentityInput,
    sourceIdentity: AssetSourceIdentity,
  ): AssetSourceIdentity {
    const safeImageId = safeIdentityPart(finalizedImage.imageAssetId, "image-asset");
    const safeArtifactId = safeIdentityPart(finalizedImage.backingArtifactId, "artifact");
    const sourceFingerprint = stableHash(JSON.stringify(sanitizeAssetViewValue({
      imageAssetId: safeImageId,
      artifactId: safeArtifactId,
      source: "generated",
    })));
    return {
      sourceKind: "image-asset",
      sourceViewId: sourceIdentity.sourceViewId,
      sourceViewKind: "image-asset",
      sourceAssetType: "image",
      sourceResourceKind: "image",
      sourceSystem: "image-asset",
      sourceId: safeImageId,
      sourceFingerprint,
      backingRefs: [
        {
          backingId: `image.finalized.${stableHash(`${safeImageId}|${safeArtifactId}`)}`,
          resourceKind: "image",
          ref: { kind: "artifact", id: normalizeAssetId(`artifact.${safeArtifactId}`) },
          role: "primary",
          displayName: sanitizeAssetStringValue(finalizedImage.displayName),
          contentType: sanitizeAssetStringValue(finalizedImage.mediaType),
          createdAt: sanitizeAssetStringValue(finalizedImage.createdAt),
          metadata: sanitizeAssetViewValue({
            imageAssetId: safeImageId,
            artifactId: safeArtifactId,
          }) as AssetMetadata,
        },
      ],
      deduplicationKey: `asset-source.image-asset.${stableHash(["image-asset", safeImageId, safeArtifactId, sourceFingerprint].join("|"))}`,
    };
  }

  public deriveFromImportedOrLocalizedExternalObject(
    input: ImportedOrLocalizedExternalObjectIdentityInput,
  ): AssetSourceIdentity {
    const safeBackings = safeImportedBackings(input.backings);
    const seed = input.resourceRefs.map((ref) => `${ref.kind}:${safeIdentityPart(ref.id, "resource")}:${sanitizeAssetStringValue(ref.version) ?? ""}`).join("|")
      || safeBackings.map((backing) => safeIdentityPart(backing.backingId, "backing")).join("|");
    const sourceFingerprint = stableHash(JSON.stringify(sanitizeAssetViewValue({
      operation: input.operation,
      seed,
      source: input.sourceIdentity.deduplicationKey,
    })));
    const sourceKind = input.sourceIdentity.sourceAssetType === "model"
      ? "model"
      : input.sourceIdentity.sourceAssetType === "dataset"
        ? "dataset"
        : input.sourceIdentity.sourceAssetType === "image"
          ? "image-asset"
          : "artifact";
    return {
      sourceKind,
      sourceViewId: input.sourceIdentity.sourceViewId,
      sourceViewKind: input.sourceIdentity.sourceViewKind,
      sourceAssetType: input.sourceIdentity.sourceAssetType,
      sourceResourceKind: input.sourceIdentity.sourceResourceKind,
      sourceSystem: sourceKind === "image-asset" ? "image-asset" : sourceKind,
      sourceId: `${input.operation}.${stableHash(seed)}`,
      sourceFingerprint,
      ...(safeBackings.length ? { backingRefs: safeBackings } : {}),
      deduplicationKey: `asset-source.${sourceKind}.${stableHash([input.operation, seed, sourceFingerprint].join("|"))}`,
    };
  }
}

export const assetSourceIdentityService = new AssetSourceIdentityService();

function failure(code: string, message: string): AssetSourceIdentityResult {
  return {
    ok: false,
    diagnostics: [{ code, message }],
    validationIssues: [{ severity: "error", category: "identity", message }],
  };
}

function sourceKindForView(view: AssetResourceBackedView): AssetSourceIdentityKind {
  switch (view.viewKind) {
    case "document":
      return "artifact";
    case "artifact":
    case "image-asset":
    case "generated-output":
    case "dataset":
    case "model":
    case "external-repository-object":
    case "preview":
      return view.viewKind;
    default:
      return "resource-backed-view";
  }
}

function sourceSystemForView(view: AssetResourceBackedView): AssetSourceSystem {
  switch (view.viewKind) {
    case "document":
    case "artifact":
      return "artifact";
    case "image-asset":
      return "image-asset";
    case "generated-output":
      return "generated-output";
    case "dataset":
      return "dataset";
    case "model":
      return "model";
    case "external-repository-object":
      return "external-repository-object";
    case "preview":
      return "asset-resource-backed-view";
    default:
      return "unknown";
  }
}

function sourceSeedFor(view: AssetResourceBackedView, backing: AssetResourceBacking | undefined): string | undefined {
  const candidates = [
    backing?.backingId,
    assetReferenceId(backing?.ref),
    view.resourceBackedAsset?.assetRef.id,
    view.sourceRef?.id,
    view.generatedOutput?.outputId,
  ];
  return candidates.find((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
}

function primaryBackingFor(view: AssetResourceBackedView): AssetResourceBacking | undefined {
  return view.resourceBacking ?? view.resourceBackedAsset?.backings.find((backing) => backing.role === "primary") ?? view.resourceBackedAsset?.backings[0];
}

function safeBackingsFor(view: AssetResourceBackedView): readonly AssetResourceBacking[] {
  const backings = [
    ...(view.resourceBacking ? [view.resourceBacking] : []),
    ...(view.resourceBackedAsset?.backings ?? []),
  ];
  const unique = new Map<string, AssetResourceBacking>();
  for (const backing of backings) {
    const safeBacking = sanitizeAssetViewValue(backing) as AssetResourceBacking;
    const key = safeBacking.backingId;
    if (key && !unique.has(key)) unique.set(key, safeBacking);
  }
  return [...unique.values()];
}

function safeImportedBackings(backings: readonly AssetResourceBacking[]): readonly AssetResourceBacking[] {
  return backings
    .map((backing) => {
      const sanitized = sanitizeAssetViewValue(backing) as AssetResourceBacking;
      const ref = sanitizeImportedBackingRef(sanitized.ref);
      return {
        ...sanitized,
        backingId: safeIdentityPart(backing.backingId, "backing"),
        ...(ref ? { ref } : {}),
      };
    })
    .filter((backing) => typeof backing.backingId === "string" && backing.backingId.length > 0);
}

function sanitizeImportedBackingRef(ref: unknown): AssetResourceBacking["ref"] | undefined {
  if (!ref || typeof ref !== "object") return sanitizeAssetViewValue(ref) as AssetResourceBacking["ref"] | undefined;
  const record = sanitizeAssetViewValue(ref) as Record<string, unknown>;
  if (typeof record.id === "string") {
    return {
      ...record,
      id: safeIdentityPart(record.id, "resource"),
    } as AssetResourceBacking["ref"];
  }
  return record as unknown as AssetResourceBacking["ref"];
}

function assetReferenceId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" ? record.id : undefined;
}

function safeIdentityPart(value: string, fallbackPrefix: string): string {
  const sanitized = sanitizeAssetStringValue(value);
  if (
    sanitized &&
    /^[a-z0-9_.:-]{1,180}$/i.test(sanitized) &&
    !/[\\/]/.test(sanitized) &&
    !/^https?:/i.test(sanitized) &&
    !looksSensitiveSourceId(sanitized)
  ) {
    return stableToken(sanitized);
  }
  return `${fallbackPrefix}.${stableHash(value)}`;
}

function looksSensitiveSourceId(value: string): boolean {
  return /(?:prompt|negativeprompt|workflow|bearer|token|secret|password|credential|auth|base64|data:image|raw|payload|command|stack|process\.env|signed|presigned|hf:|huggingface)/i.test(value);
}

function stableToken(value: string): string {
  const token = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return token.length > 0 ? token : "source";
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
