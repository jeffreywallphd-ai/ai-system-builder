import type {
  AssetFamily,
  AssetLifecycleStatus,
  AssetMetadata,
  AssetResourceBackedView,
  AssetResourceBackedViewKind,
  AssetType,
} from "../../../contracts/asset";
import type { WorkspaceId } from "../../../contracts/workspace";

export type AssetResourceBackedViewProviderDiagnosticSeverity = "info" | "warning" | "error";

export interface AssetResourceBackedViewProviderDiagnostic {
  readonly severity: AssetResourceBackedViewProviderDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly providerId?: string;
  readonly sourceKind?: string;
  readonly metadata?: AssetMetadata;
}

export interface AssetResourceBackedViewListQuery {
  readonly searchText?: string;
  readonly assetTypes?: readonly AssetType[];
  readonly assetFamilies?: readonly AssetFamily[];
  readonly lifecycleStatuses?: readonly AssetLifecycleStatus[];
  readonly viewKinds?: readonly AssetResourceBackedViewKind[];
  readonly limit?: number;
  readonly cursor?: string;
  readonly workspaceId?: WorkspaceId | string;
}

export interface AssetResourceBackedViewListResult {
  readonly items: readonly AssetResourceBackedView[];
  readonly nextCursor?: string;
  readonly diagnostics?: readonly AssetResourceBackedViewProviderDiagnostic[];
}

export interface AssetResourceBackedViewProvider {
  readonly providerId?: string;
  listResourceBackedViews(query?: AssetResourceBackedViewListQuery): Promise<AssetResourceBackedViewListResult>;
  readResourceBackedView(viewId: string, query?: { readonly workspaceId?: WorkspaceId | string }): Promise<AssetResourceBackedView | undefined>;
}

export interface UnsupportedAssetResourceBackedViewProviderOptions {
  readonly providerId?: string;
  readonly sourceKind?: string;
  readonly message?: string;
}

export function createUnsupportedAssetResourceBackedViewProvider(
  options: UnsupportedAssetResourceBackedViewProviderOptions = {},
): AssetResourceBackedViewProvider {
  const providerId = options.providerId ?? "unsupported-resource-backed-view-provider";
  const sourceKind = options.sourceKind ?? "resource-backed-view-provider";
  const message = options.message ?? "Resource-backed views for this source are not wired.";

  return {
    providerId,
    async listResourceBackedViews(): Promise<AssetResourceBackedViewListResult> {
      return {
        items: [],
        diagnostics: [
          {
            severity: "info",
            code: "resource-backed-view-provider-unsupported",
            message,
            providerId,
            sourceKind,
          },
        ],
      };
    },
    async readResourceBackedView(): Promise<AssetResourceBackedView | undefined> {
      return undefined;
    },
  };
}

export const createEmptyAssetResourceBackedViewProvider = createUnsupportedAssetResourceBackedViewProvider;
