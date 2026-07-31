import type {
  ArtifactBrowseItem,
} from "../../../contracts/artifact-browser";
import { isContractFailure } from "../../../contracts/shared";
import { isWorkspaceId } from "../../../contracts/workspace";
import type {
  AssetFamily,
  AssetMetadata,
  AssetReference,
  AssetResourceBackedView,
  AssetResourceBackedViewKind,
  AssetResourceBacking,
  AssetType,
} from "../../../contracts/asset";
import { normalizeAssetId } from "../../../contracts/asset";
import type { ArtifactBrowserMetadataReadPort } from "../../ports/artifact-browser";
import type {
  AssetResourceBackedViewListQuery,
  AssetResourceBackedViewListResult,
  AssetResourceBackedViewProvider,
  AssetResourceBackedViewProviderDiagnostic,
} from "../../ports/asset";
import { AssetResourceBackedMappingService, assetResourceBackedMappingService } from "./asset-resource-backed-mapping.service";
import { BUILT_IN_ASSET_DEFINITION_VERSION } from "./built-ins";
import { isUnsafeAssetMetadataKey, isUnsafeAssetMetadataString, sanitizeAssetMetadata, sanitizeAssetStringValue, sanitizeAssetViewValue } from "./asset-safe-metadata";

export interface ArtifactResourceBackedViewProviderDependencies {
  readonly artifactBrowserMetadataRead?: Pick<ArtifactBrowserMetadataReadPort, "browseArtifacts">;
  readonly mappingService?: AssetResourceBackedMappingService;
  readonly providerId?: string;
  readonly maxListLimit?: number;
}

const DEFAULT_PROVIDER_ID = "asset-artifact-resource-backed-view-provider";
const DEFAULT_LIST_LIMIT = 100;
const ABSOLUTE_MAX_LIST_LIMIT = 250;
const DOCUMENT_MEDIA_TYPE_PATTERN =
  /^(application\/(json|pdf|msword|rtf|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)|text\/(csv|html|markdown|plain|tab-separated-values))$/i;
const DOCUMENT_EXTENSION_PATTERN = /^(csv|doc|docx|htm|html|json|md|markdown|pdf|rtf|tsv|txt)$/i;
type ArtifactProviderMetadata = Readonly<Record<string, unknown>>;

export class ArtifactResourceBackedViewProvider implements AssetResourceBackedViewProvider {
  public readonly providerId: string;
  private readonly artifactBrowserMetadataRead?: Pick<ArtifactBrowserMetadataReadPort, "browseArtifacts">;
  private readonly mappingService: AssetResourceBackedMappingService;
  private readonly maxListLimit: number;

  public constructor(dependencies: ArtifactResourceBackedViewProviderDependencies = {}) {
    this.artifactBrowserMetadataRead = dependencies.artifactBrowserMetadataRead;
    this.mappingService = dependencies.mappingService ?? assetResourceBackedMappingService;
    this.providerId = dependencies.providerId ?? DEFAULT_PROVIDER_ID;
    this.maxListLimit = Math.min(Math.max(1, dependencies.maxListLimit ?? DEFAULT_LIST_LIMIT), ABSOLUTE_MAX_LIST_LIMIT);
  }

  public async listResourceBackedViews(query: AssetResourceBackedViewListQuery = {}): Promise<AssetResourceBackedViewListResult> {
    const diagnostics: AssetResourceBackedViewProviderDiagnostic[] = [];
    const limit = this.safeLimit(query.limit);

    if (typeof query.limit === "number" && Number.isFinite(query.limit) && Math.floor(query.limit) > limit) {
      diagnostics.push(this.diagnostic("info", "artifact-resource-backed-view-limit-clamped", "Artifact resource-backed view limit was clamped.", {
        requestedLimit: query.limit,
        appliedLimit: limit,
      }));
    }

    if (query.cursor) {
      diagnostics.push(this.diagnostic("warning", "artifact-resource-backed-view-cursor-unsupported", "Artifact resource-backed view cursor pagination is not supported by the descriptor list seam."));
    }
    diagnostics.push(this.diagnostic("info", "artifact-resource-backed-view-source-pagination-unavailable", "Artifact metadata browse does not expose source-level cursor or limit pagination; provider output is bounded after browse."));

    if (query.lifecycleStatuses?.length) {
      diagnostics.push(this.diagnostic("info", "artifact-resource-backed-view-lifecycle-filter-unsupported", "Artifact lifecycle state is not mapped to Asset Kernel lifecycle status by this provider."));
    }

    if (!isWorkspaceId(query.workspaceId)) {
      return {
        items: [],
        diagnostics: [
          ...diagnostics,
          this.diagnostic("warning", "workspace-required", "Workspace id is required for artifact-backed resource views."),
        ],
      };
    }

    if (!this.artifactBrowserMetadataRead) {
      return {
        items: [],
        diagnostics: [
          ...diagnostics,
          this.diagnostic("warning", "artifact-resource-backed-view-source-unavailable", "Artifact metadata list seam is not available."),
        ],
      };
    }

    let items: readonly ArtifactBrowseItem[];
    try {
      const result = await this.artifactBrowserMetadataRead.browseArtifacts({}, { workspaceId: query.workspaceId });
      if (isContractFailure(result)) {
        return {
          items: [],
          diagnostics: [
            ...diagnostics,
            this.diagnostic("warning", "artifact-resource-backed-view-source-failed", "Artifact metadata source failed while listing resource-backed views.", {
              failureCode: result.error.code,
            }),
          ],
        };
      }
      items = result.value.items;
    } catch {
      return {
        items: [],
        diagnostics: [
          ...diagnostics,
          this.diagnostic("warning", "artifact-resource-backed-view-source-failed", "Artifact metadata source failed while listing resource-backed views.", {
            failureKind: "source-exception",
          }),
        ],
      };
    }

    const views: AssetResourceBackedView[] = [];
    for (const item of items) {
      const view = this.viewFromBrowseItem(item, diagnostics);
      if (!view) continue;
      if (!matchesQuery(view, query)) continue;
      views.push(view);
      if (views.length >= limit) break;
    }

    return sanitizeAssetViewValue({
      items: views,
      ...(diagnostics.length ? { diagnostics } : {}),
    }) as AssetResourceBackedViewListResult;
  }

  public async readResourceBackedView(viewId: string, query: { readonly workspaceId?: string } = {}): Promise<AssetResourceBackedView | undefined> {
    const result = await this.listResourceBackedViews({ limit: this.maxListLimit, workspaceId: query.workspaceId });
    const view = result.items.find((item) => item.viewId === viewId);
    return view ? withDetailFallbackDiagnostic(view, this.diagnostic("info", "artifact-resource-backed-view-detail-list-fallback-limited", "Artifact detail read used the bounded browse-list fallback because public view ids do not expose reversible artifact locators.")) : undefined;
  }

  private viewFromBrowseItem(
    item: ArtifactBrowseItem,
    diagnostics: AssetResourceBackedViewProviderDiagnostic[],
  ): AssetResourceBackedView | undefined {
    const identity = safeArtifactIdentity(item.artifactId);
    if (!identity) {
      diagnostics.push(this.diagnostic("warning", "artifact-resource-backed-view-skipped-invalid-descriptor", "An artifact descriptor was skipped because its identifier was invalid."));
      return undefined;
    }

    const safeName = safeDisplayName(item.originalName);
    const displayName = safeName ?? identity.safeLabel;
    if ((item.originalName && !safeName) || hasUnsafeMetadata(item.metadata)) {
      diagnostics.push(this.diagnostic("warning", "artifact-resource-backed-view-unsafe-data-omitted", "Unsafe artifact metadata fields were omitted from a resource-backed view."));
    }
    const mediaType = safeContentType(item.mediaType) ?? metadataString(item.metadata, ["mediaType", "mimeType", "contentType"]);
    const extension = safeExtension(displayName) ?? safeExtension(metadataString(item.metadata, ["extension", "format", "fileExtension"]));
    const documentLike = isDocumentLike({ mediaType, extension, artifactFamily: item.artifactFamily, metadata: item.metadata });
    const viewKind: AssetResourceBackedViewKind = documentLike ? "document" : "artifact";
    const assetType: AssetType = documentLike ? "document" : "data-source";
    const assetDefinitionRef = builtInDefinitionRef(documentLike ? "builtin.document" : "builtin.artifact");
    const backing = this.backingFromBrowseItem(item, identity, displayName, mediaType, extension);
    const view = sanitizeAssetViewValue({
      viewId: `${documentLike ? "asset-view.document" : "asset-view.artifact"}.internal.${stableHash(identity.raw)}`,
      viewKind,
      assetType,
      assetFamily: "resource-backed" satisfies AssetFamily,
      assetDefinitionRef,
      resourceBacking: backing,
      resourceBackedAsset: this.mappingService.mapBackingToResourceBackedAsset(
        {
          kind: "resource-backed-asset",
          id: normalizeAssetId(`${documentLike ? "document" : "artifact"}.${stableHash(identity.raw)}`),
          label: displayName,
        },
        backing,
        assetType,
      ),
      sourceRef: artifactSourceRef(identity, displayName),
      displayName,
      summary: documentLike
        ? "Document-like stored artifact metadata view; not a registered asset instance."
        : "Stored artifact metadata view; not a registered asset instance.",
      metadata: metadataOf({
        artifactId: identity.publicId,
        artifactFamily: item.artifactFamily,
        artifactSourceKind: item.sourceKind,
        mediaType,
        extension,
        sizeBytes: item.sizeBytes,
        createdAt: item.createdAt,
        ...safePublicMetadata(item.metadata),
      }),
    }) as AssetResourceBackedView;

    return view;
  }

  private backingFromBrowseItem(
    item: ArtifactBrowseItem,
    identity: SafeArtifactIdentity,
    displayName: string,
    mediaType: string | undefined,
    extension: string | undefined,
  ): AssetResourceBacking {
    return sanitizeAssetViewValue({
      backingId: `artifact.internal.${stableHash(identity.raw)}`,
      resourceKind: "artifact",
      ref: artifactSourceRef(identity, displayName),
      role: "primary",
      displayName,
      contentType: mediaType,
      format: extension,
      sizeBytes: item.sizeBytes,
      createdAt: sanitizeAssetStringValue(item.createdAt),
      metadata: metadataOf({
        artifactId: identity.publicId,
        artifactFamily: item.artifactFamily,
        artifactSourceKind: item.sourceKind,
        ...safePublicMetadata(item.metadata),
      }),
    }) as AssetResourceBacking;
  }

  private safeLimit(limit: number | undefined): number {
    if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return this.maxListLimit;
    return Math.min(Math.floor(limit), this.maxListLimit);
  }

  private diagnostic(
    severity: AssetResourceBackedViewProviderDiagnostic["severity"],
    code: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): AssetResourceBackedViewProviderDiagnostic {
    return {
      severity,
      code,
      message,
      providerId: this.providerId,
      sourceKind: "artifact",
      ...(metadataOf(metadata) ? { metadata: metadataOf(metadata) } : {}),
    };
  }
}

export function createArtifactResourceBackedViewProvider(
  dependencies: ArtifactResourceBackedViewProviderDependencies = {},
): ArtifactResourceBackedViewProvider {
  return new ArtifactResourceBackedViewProvider(dependencies);
}

interface SafeArtifactIdentity {
  readonly raw: string;
  readonly publicId: string;
  readonly safeLabel: string;
}

function safeArtifactIdentity(value: string | undefined): SafeArtifactIdentity | undefined {
  const raw = typeof value === "string" ? value.trim() : undefined;
  if (!raw) return undefined;
  const pathLikeOrUnsafe = /[\\/]/.test(raw) || /^[a-z]:/i.test(raw) || isUnsafeAssetMetadataString(raw);
  if (!pathLikeOrUnsafe) {
    const publicId = stableToken(raw);
    return { raw, publicId, safeLabel: raw };
  }
  const publicId = `artifact.${stableHash(raw)}`;
  return { raw, publicId, safeLabel: publicId };
}

function artifactSourceRef(identity: SafeArtifactIdentity, label: string): AssetReference {
  return {
    kind: "artifact",
    id: normalizeAssetId(`artifact-ref.${identity.publicId}`),
    label,
    metadata: metadataOf({ artifactId: identity.publicId }),
  };
}

function builtInDefinitionRef(id: "builtin.artifact" | "builtin.document"): AssetReference {
  return {
    kind: "asset-definition",
    id: normalizeAssetId(id),
    version: BUILT_IN_ASSET_DEFINITION_VERSION,
  };
}

function metadataOf(value: Record<string, unknown> | AssetMetadata | undefined): AssetMetadata | undefined {
  return sanitizeAssetMetadata(value);
}

function safePublicMetadata(metadata: ArtifactProviderMetadata | undefined): AssetMetadata | undefined {
  const safe = sanitizeAssetMetadata(metadata);
  if (!safe) return undefined;
  const entries = Object.entries(safe).filter(([key]) => !/^(publishedBacking|importedSourceBacking|locator|storageKey)$/i.test(key));
  return entries.length ? Object.fromEntries(entries) as AssetMetadata : undefined;
}

function safeDisplayName(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || /[\\/]/.test(sanitized) || /^[a-z]:/i.test(sanitized)) return undefined;
  return sanitized;
}

function safeContentType(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(sanitized)) return undefined;
  return sanitized.toLowerCase();
}

function safeExtension(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized) return undefined;
  const extension = sanitized.includes(".") ? sanitized.slice(sanitized.lastIndexOf(".") + 1) : sanitized;
  if (!/^[a-z0-9]{1,12}$/i.test(extension)) return undefined;
  return extension.toLowerCase();
}

function metadataString(metadata: ArtifactProviderMetadata | undefined, keys: readonly string[]): string | undefined {
  if (!metadata) return undefined;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value !== "string") continue;
    const sanitized = key.toLowerCase().includes("type") ? safeContentType(value) : sanitizeAssetStringValue(value);
    if (sanitized) return sanitized;
  }
  return undefined;
}

function isDocumentLike(input: {
  readonly mediaType?: string;
  readonly extension?: string;
  readonly artifactFamily?: string;
  readonly metadata?: ArtifactProviderMetadata;
}): boolean {
  if (input.mediaType && DOCUMENT_MEDIA_TYPE_PATTERN.test(input.mediaType)) return true;
  if (input.extension && DOCUMENT_EXTENSION_PATTERN.test(input.extension)) return true;
  if (input.artifactFamily === "document" || input.artifactFamily === "text" || input.artifactFamily === "structured-text" || input.artifactFamily === "tabular") return true;

  const category = metadataString(input.metadata, ["artifactKind", "category", "type"]);
  return category === "document" || category === "text" || category === "markdown" || category === "pdf";
}

function matchesQuery(view: AssetResourceBackedView, query: AssetResourceBackedViewListQuery): boolean {
  return (
    (!query.assetTypes?.length || (view.assetType !== undefined && query.assetTypes.includes(view.assetType))) &&
    (!query.assetFamilies?.length || (view.assetFamily !== undefined && query.assetFamilies.includes(view.assetFamily))) &&
    (!query.viewKinds?.length || query.viewKinds.includes(view.viewKind)) &&
    matchesSearch(query.searchText, [
      view.viewId,
      view.viewKind,
      view.displayName,
      view.summary,
      view.assetType,
      view.assetFamily,
      view.sourceRef?.id,
      view.resourceBacking?.contentType,
      view.resourceBacking?.format,
    ])
  );
}

function matchesSearch(searchText: string | undefined, values: readonly (string | undefined)[]): boolean {
  const needle = searchText?.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => value?.toLowerCase().includes(needle));
}

function stableToken(value: string): string {
  const token = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return token.length > 0 ? token : "artifact";
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function hasUnsafeMetadata(value: unknown): boolean {
  if (typeof value === "string") return isUnsafeAssetMetadataString(value);
  if (Array.isArray(value)) return value.some((entry) => hasUnsafeMetadata(entry));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value as Record<string, unknown>).some(([key, entry]) => isUnsafeAssetMetadataKey(key) || hasUnsafeMetadata(entry));
  }
  return false;
}

function withDetailFallbackDiagnostic(
  view: AssetResourceBackedView,
  diagnostic: AssetResourceBackedViewProviderDiagnostic,
): AssetResourceBackedView {
  return sanitizeAssetViewValue({
    ...view,
    diagnostics: [...(view.diagnostics ?? []), {
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      sourceKind: diagnostic.sourceKind,
      metadata: diagnostic.metadata,
    }],
  }) as AssetResourceBackedView;
}
