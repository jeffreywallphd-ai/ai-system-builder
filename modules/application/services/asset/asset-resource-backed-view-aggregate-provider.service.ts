import type {
  AssetResourceBackedView,
} from "../../../contracts/asset";
import type {
  AssetResourceBackedViewListQuery,
  AssetResourceBackedViewListResult,
  AssetResourceBackedViewProvider,
  AssetResourceBackedViewProviderDiagnostic,
} from "../../ports/asset";
import { sanitizeAssetMetadata, sanitizeAssetStringValue, sanitizeAssetViewValue } from "./asset-safe-metadata";

export interface AssetResourceBackedViewAggregateProviderOptions {
  readonly providers?: readonly AssetResourceBackedViewProvider[];
  readonly maxListLimit?: number;
  readonly providerId?: string;
}

const DEFAULT_LIST_LIMIT = 100;
const ABSOLUTE_MAX_LIST_LIMIT = 250;
const AGGREGATE_PROVIDER_ID = "asset-resource-backed-view-aggregate-provider";

export class AssetResourceBackedViewAggregateProvider implements AssetResourceBackedViewProvider {
  public readonly providerId: string;
  private readonly providers: readonly AssetResourceBackedViewProvider[];
  private readonly maxListLimit: number;
  private readonly providerByPublicViewId = new Map<string, AssetResourceBackedViewProvider>();

  public constructor(options: AssetResourceBackedViewAggregateProviderOptions = {}) {
    this.providers = options.providers ?? [];
    this.maxListLimit = Math.min(Math.max(1, options.maxListLimit ?? DEFAULT_LIST_LIMIT), ABSOLUTE_MAX_LIST_LIMIT);
    this.providerId = options.providerId ?? AGGREGATE_PROVIDER_ID;
  }

  public async listResourceBackedViews(query: AssetResourceBackedViewListQuery = {}): Promise<AssetResourceBackedViewListResult> {
    if (this.providers.length === 0) return { items: [] };

    const limit = this.safeLimit(query.limit);
    const diagnostics: AssetResourceBackedViewProviderDiagnostic[] = [];
    if (typeof query.limit === "number" && Number.isFinite(query.limit) && Math.floor(query.limit) > limit) {
      diagnostics.push({
        severity: "info",
        code: "resource-backed-view-provider-limit-clamped",
        message: "Resource-backed view provider limit was clamped to the configured maximum.",
        providerId: this.providerId,
        metadata: sanitizeAssetMetadata({ requestedLimit: query.limit, appliedLimit: limit }),
      });
    }

    const multiProviderCursorUnsupported = this.providers.length > 1 && Boolean(query.cursor);
    if (multiProviderCursorUnsupported) {
      diagnostics.push({
        severity: "warning",
        code: "resource-backed-view-aggregate-cursor-unsupported",
        message: "Aggregate resource-backed view cursor pagination is not enabled for multiple providers yet; returning a deterministic first page.",
        providerId: this.providerId,
      });
    }

    const items: AssetResourceBackedView[] = [];
    const seenViewIds = new Set<string>();
    let nextCursor: string | undefined;
    for (const provider of this.providers) {
      if (items.length >= limit) break;

      const providerLimit = limit - items.length;
      try {
        const result = await provider.listResourceBackedViews({
          ...query,
          limit: providerLimit,
          ...(multiProviderCursorUnsupported ? { cursor: undefined } : { cursor: query.cursor }),
        });

        for (const diagnostic of result.diagnostics ?? []) diagnostics.push(sanitizeProviderDiagnostic(diagnostic, provider.providerId));
        for (const item of result.items) {
          const sanitized = sanitizeProviderView(item, diagnostics, provider.providerId);
          if (sanitized) {
            if (!this.providerByPublicViewId.has(sanitized.viewId)) this.providerByPublicViewId.set(sanitized.viewId, provider);
            if (seenViewIds.has(sanitized.viewId)) {
              diagnostics.push(duplicateViewIdDiagnostic(sanitized.viewId, provider.providerId));
            } else if (matchesQuery(sanitized, query)) {
              seenViewIds.add(sanitized.viewId);
              items.push(sanitized);
            }
          }
          if (items.length >= limit) break;
        }
        if (this.providers.length === 1 && result.nextCursor) nextCursor = sanitizeAssetStringValue(result.nextCursor);
      } catch {
        diagnostics.push(providerFailureDiagnostic(provider.providerId));
      }
    }

    return sanitizeAssetViewValue({
      items,
      ...(nextCursor ? { nextCursor } : {}),
      ...(diagnostics.length ? { diagnostics } : {}),
    }) as AssetResourceBackedViewListResult;
  }

  public async readResourceBackedView(viewId: string, query: { readonly workspaceId?: string } = {}): Promise<AssetResourceBackedView | undefined> {
    const scopedProvider = this.providerForScopedViewId(viewId);
    const cachedProvider = !scopedProvider ? this.providerByPublicViewId.get(viewId) : undefined;
    const providers = scopedProvider ? [scopedProvider.provider] : cachedProvider ? [cachedProvider] : this.providers;
    const scopedViewId = scopedProvider?.viewId ?? viewId;

    for (const provider of providers) {
      try {
        const view = await provider.readResourceBackedView(scopedViewId, query);
        if (view) return sanitizeAssetViewValue(view) as AssetResourceBackedView;
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private safeLimit(limit: number | undefined): number {
    if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return this.maxListLimit;
    return Math.min(Math.floor(limit), this.maxListLimit);
  }

  private providerForScopedViewId(viewId: string): { readonly provider: AssetResourceBackedViewProvider; readonly viewId: string } | undefined {
    const separator = viewId.indexOf("::");
    if (separator <= 0) return undefined;
    const providerId = viewId.slice(0, separator);
    const providerViewId = viewId.slice(separator + 2);
    const provider = this.providers.find((candidate) => candidate.providerId === providerId);
    return provider && providerViewId ? { provider, viewId: providerViewId } : undefined;
  }
}

export function createAssetResourceBackedViewAggregateProvider(
  providers: readonly AssetResourceBackedViewProvider[] = [],
  options: Omit<AssetResourceBackedViewAggregateProviderOptions, "providers"> = {},
): AssetResourceBackedViewAggregateProvider {
  return new AssetResourceBackedViewAggregateProvider({ ...options, providers });
}

function duplicateViewIdDiagnostic(
  viewId: string,
  providerId: string | undefined,
): AssetResourceBackedViewProviderDiagnostic {
  return {
    severity: "warning",
    code: "resource-backed-view-provider-duplicate-view-id",
    message: "A duplicate resource-backed view id was omitted; the first provider result was kept deterministically.",
    ...(sanitizeIdentifier(providerId) ? { providerId: sanitizeIdentifier(providerId) } : {}),
    metadata: sanitizeAssetMetadata({ viewId, conflictResolution: "first-provider-wins" }),
  };
}

function sanitizeProviderDiagnostic(
  diagnostic: AssetResourceBackedViewProviderDiagnostic,
  fallbackProviderId: string | undefined,
): AssetResourceBackedViewProviderDiagnostic {
  return {
    severity: diagnostic.severity === "error" || diagnostic.severity === "warning" ? diagnostic.severity : "info",
    code: sanitizeIdentifier(diagnostic.code) ?? "resource-backed-view-provider-diagnostic",
    message: sanitizeAssetStringValue(diagnostic.message) ?? "Resource-backed view provider diagnostic was sanitized.",
    ...(sanitizeIdentifier(diagnostic.providerId ?? fallbackProviderId) ? { providerId: sanitizeIdentifier(diagnostic.providerId ?? fallbackProviderId) } : {}),
    ...(sanitizeIdentifier(diagnostic.sourceKind) ? { sourceKind: sanitizeIdentifier(diagnostic.sourceKind) } : {}),
    ...(sanitizeAssetMetadata(diagnostic.metadata) ? { metadata: sanitizeAssetMetadata(diagnostic.metadata) } : {}),
  };
}

function providerFailureDiagnostic(providerId: string | undefined): AssetResourceBackedViewProviderDiagnostic {
  return {
    severity: "warning",
    code: "resource-backed-view-provider-partial-failure",
    message: "A resource-backed view provider failed while listing views.",
    ...(sanitizeIdentifier(providerId) ? { providerId: sanitizeIdentifier(providerId) } : {}),
    metadata: { failureKind: "provider-exception" },
  };
}

function sanitizeProviderView(
  view: AssetResourceBackedView,
  diagnostics: AssetResourceBackedViewProviderDiagnostic[],
  providerId: string | undefined,
): AssetResourceBackedView | undefined {
  const sanitized = sanitizeAssetViewValue(view) as AssetResourceBackedView | undefined;
  if (!sanitized || typeof sanitized.viewId !== "string" || typeof sanitized.viewKind !== "string") {
    diagnostics.push({
      severity: "warning",
      code: "resource-backed-view-provider-unsafe-data",
      message: "A resource-backed view provider returned data that could not be safely exposed.",
      ...(sanitizeIdentifier(providerId) ? { providerId: sanitizeIdentifier(providerId) } : {}),
    });
    return undefined;
  }

  if (changedDuringSanitization(view, sanitized)) {
    diagnostics.push({
      severity: "warning",
      code: "resource-backed-view-provider-unsafe-data",
      message: "Unsafe resource-backed view provider fields were omitted.",
      ...(sanitizeIdentifier(providerId) ? { providerId: sanitizeIdentifier(providerId) } : {}),
    });
  }

  return sanitized;
}

function changedDuringSanitization(original: unknown, sanitized: unknown): boolean {
  try {
    return JSON.stringify(original) !== JSON.stringify(sanitized);
  } catch {
    return true;
  }
}

function matchesQuery(view: AssetResourceBackedView, query: AssetResourceBackedViewListQuery): boolean {
  return (
    (!query.assetTypes?.length || (view.assetType !== undefined && query.assetTypes.includes(view.assetType))) &&
    (!query.assetFamilies?.length || (view.assetFamily !== undefined && query.assetFamilies.includes(view.assetFamily))) &&
    (!query.lifecycleStatuses?.length || (view.lifecycleStatus !== undefined && query.lifecycleStatuses.includes(view.lifecycleStatus))) &&
    (!query.viewKinds?.length || query.viewKinds.includes(view.viewKind)) &&
    matchesSearch(query.searchText, [view.viewId, view.viewKind, view.displayName, view.summary, view.assetType, view.assetFamily])
  );
}

function matchesSearch(searchText: string | undefined, values: readonly (string | undefined)[]): boolean {
  const needle = searchText?.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => value?.toLowerCase().includes(needle));
}

function sanitizeIdentifier(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || !/^[a-z0-9_.:-]+$/i.test(sanitized)) return undefined;
  return sanitized;
}
