import type {
  AssetDefinition,
  AssetMetadata,
  AssetPackManifest,
  AssetReference,
} from "../../../contracts/asset";
import type { WorkspaceId } from "../../../contracts/workspace";
import { isWorkspaceId } from "../../../contracts/workspace";
import type { AssetRegistryDefinitionReadPort } from "../../ports/asset";
import type {
  UserLibraryAssetRepositoryPort,
  WorkspaceToWorkspaceImportRepositoryPort,
  WorkspaceUserLibraryDetachedCopyRepositoryPort,
  WorkspaceUserLibraryLinkRepositoryPort,
} from "../../ports/user-library";
import type {
  AssetCustomizationTargetReaderPort,
  AssetDraftRepositoryPort,
  AssetOverrideRepositoryPort,
  AssetRevisionRepositoryPort,
  AuthoredAssetRepositoryPort,
} from "../../ports/asset-authoring";
import type { WorkspaceRepository } from "../../ports/workspace";
import type { ListWorkspaceSystemPackActivationsUseCase } from "../../use-cases/workspace";
import type {
  AssetDefinitionCard,
  AssetDefinitionDetail,
  AssetRegistryListDiagnostic,
  AssetRegistryListQuery,
  AssetRegistryListResult,
  AssetRegistryReadOptions,
  AssetRegistryResourceBackedViewCard,
  AssetRegistryResourceBackedViewDetail,
} from "./asset-registry-read-facade.types";
import {
  SYSTEM_FOUNDATION_PACK_DISPLAY_NAME,
  SYSTEM_FOUNDATION_PACK_ID,
  SYSTEM_FOUNDATION_PACK_SOURCE_KIND,
  SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
  SYSTEM_FOUNDATION_PACK_TRUST_STATUS,
} from "../asset-packs/system-packs/system-foundation-pack.constants";
import { SYSTEM_FOUNDATION_PACK_CATEGORIES } from "../asset-packs/system-packs/system-foundation-pack.categories";
import {
  readSystemFoundationManifest,
  SYSTEM_FOUNDATION_PACK_VERSIONS,
} from "../asset-packs/system-packs";
import { WorkspaceEffectiveAssetSourceResolver } from "./workspace-effective-asset-source-resolver.service";
import { WorkspaceAssetAuthoringReadModelService } from "./workspace-asset-authoring-read-model.service";

export type WorkspaceAssetRegistryReadFailureCode =
  | "workspace-required"
  | "workspace-invalid"
  | "workspace-not-found"
  | "workspace-unavailable"
  | "workspace-effective-asset-view-unavailable"
  | "workspace-system-pack-activation-unavailable"
  | "workspace-asset-not-in-effective-view"
  | "workspace-resource-backed-view-deferred";

export class WorkspaceAssetRegistryReadFacadeError extends Error {
  public readonly code: WorkspaceAssetRegistryReadFailureCode;

  public constructor(
    code: WorkspaceAssetRegistryReadFailureCode,
    message = "Workspace asset registry read failed.",
  ) {
    super(message);
    this.name = "WorkspaceAssetRegistryReadFacadeError";
    this.code = code;
    this.stack = undefined;
  }
}

export interface WorkspaceAssetRegistryReadFacadeDependencies {
  readonly assetRegistryRead: AssetRegistryDefinitionReadPort;
  readonly listWorkspaceSystemPackActivations: ListWorkspaceSystemPackActivationsUseCase;
  readonly workspaceRepository?: WorkspaceRepository;
  readonly workspaceUserLibraryLinkRepository?: WorkspaceUserLibraryLinkRepositoryPort;
  readonly userLibraryAssetRepository?: UserLibraryAssetRepositoryPort;
  readonly detachedCopyRepository?: WorkspaceUserLibraryDetachedCopyRepositoryPort;
  readonly workspaceImportRepository?: WorkspaceToWorkspaceImportRepositoryPort;
  readonly authoredAssetRepository?: AuthoredAssetRepositoryPort;
  readonly assetRevisionRepository?: AssetRevisionRepositoryPort;
  readonly assetDraftRepository?: AssetDraftRepositoryPort;
  readonly assetOverrideRepository?: AssetOverrideRepositoryPort;
  readonly customizationTargetReader?: AssetCustomizationTargetReaderPort;
}

interface ActiveSystemPackKey {
  readonly packId: string;
  readonly packVersion: string;
}

export class WorkspaceAssetRegistryReadFacade implements AssetRegistryDefinitionReadPort {
  private readonly sourceResolver: WorkspaceEffectiveAssetSourceResolver;
  private readonly authoringReadModel: WorkspaceAssetAuthoringReadModelService;

  public constructor(
    private readonly dependencies: WorkspaceAssetRegistryReadFacadeDependencies,
  ) {
    this.sourceResolver = new WorkspaceEffectiveAssetSourceResolver({
      workspaceUserLibraryLinkRepository:
        dependencies.workspaceUserLibraryLinkRepository,
      userLibraryAssetRepository: dependencies.userLibraryAssetRepository,
      detachedCopyRepository: dependencies.detachedCopyRepository,
      workspaceImportRepository: dependencies.workspaceImportRepository,
    });
    this.authoringReadModel = new WorkspaceAssetAuthoringReadModelService({
      authoredAssetRepository: dependencies.authoredAssetRepository,
      assetRevisionRepository: dependencies.assetRevisionRepository,
      assetDraftRepository: dependencies.assetDraftRepository,
      assetOverrideRepository: dependencies.assetOverrideRepository,
      customizationTargetReader: dependencies.customizationTargetReader,
    });
  }

  public async listDefinitionCards(
    query: AssetRegistryListQuery = {},
  ): Promise<AssetRegistryListResult<AssetDefinitionCard>> {
    const context = await this.resolveWorkspaceContext(query.workspaceId);
    if (!context.ok)
      throw new WorkspaceAssetRegistryReadFacadeError(
        context.diagnostic.code as WorkspaceAssetRegistryReadFailureCode,
        context.diagnostic.message,
      );

    const activations = await this.readActiveSystemPacks(context.workspaceId);
    if (!activations.ok)
      throw new WorkspaceAssetRegistryReadFacadeError(
        activations.diagnostic.code as WorkspaceAssetRegistryReadFailureCode,
        activations.diagnostic.message,
      );

    const globalResult =
      await this.dependencies.assetRegistryRead.listDefinitionCards(query);
    const activeSystemPacks = activations.activeSystemPacks;
    const manifestCards = systemFoundationCards(
      activeSystemPacks,
      query,
    ).filter(
      (card) =>
        !globalResult.items.some(
          (item) => definitionKey(item) === definitionKey(card),
        ),
    );
    const candidateItems = [...globalResult.items, ...manifestCards];
    const resolvedItems = await Promise.all(
      candidateItems.map(
        async (card) =>
          ({
            ...card,
            effectiveSourceSummary: await this.sourceResolver.resolve(
              context.workspaceId,
              card,
            ),
            assetAuthoringEffectiveSourceSummary:
              await this.authoringReadModel.readEffectiveSourceSummary(
                context.workspaceId,
                card.definitionRef,
              ),
          }) as AssetDefinitionCard,
      ),
    );
    const items = resolvedItems.filter(
      (card) =>
        isInWorkspaceEffectiveView(card, activeSystemPacks) ||
        isUserLibraryOrWorkspaceReuseSource(
          card.effectiveSourceSummary?.effectiveSourceKind,
        ) ||
        isWorkspaceAuthoringSource(
          card.assetAuthoringEffectiveSourceSummary?.effectiveSourceKind,
        ),
    );
    items.sort(compareDefinitionCards);

    return {
      items,
      ...(globalResult.nextCursor
        ? { nextCursor: globalResult.nextCursor }
        : {}),
      ...(mergeDiagnostics(globalResult.diagnostics, activations.diagnostics)
        .length
        ? {
            diagnostics: mergeDiagnostics(
              globalResult.diagnostics,
              activations.diagnostics,
            ),
          }
        : {}),
    };
  }

  public async readDefinitionDetail(
    ref: AssetReference,
    options: AssetRegistryReadOptions = {},
  ): Promise<AssetDefinitionDetail | undefined> {
    const context = await this.resolveWorkspaceContext(options.workspaceId);
    if (!context.ok)
      throw new WorkspaceAssetRegistryReadFacadeError(
        context.diagnostic.code as WorkspaceAssetRegistryReadFailureCode,
        context.diagnostic.message,
      );

    const activations = await this.readActiveSystemPacks(context.workspaceId);
    if (!activations.ok)
      throw new WorkspaceAssetRegistryReadFacadeError(
        activations.diagnostic.code as WorkspaceAssetRegistryReadFailureCode,
        activations.diagnostic.message,
      );

    const detail =
      (await this.dependencies.assetRegistryRead.readDefinitionDetail(ref, {
        ...options,
        includeMetadata: true,
      })) ?? systemFoundationDetail(ref);
    if (!detail) return undefined;

    if (
      !isDetailInWorkspaceEffectiveView(detail, activations.activeSystemPacks)
    ) {
      throw new WorkspaceAssetRegistryReadFacadeError(
        "workspace-asset-not-in-effective-view",
        "Asset definition is not in the workspace effective asset view.",
      );
    }

    return {
      ...detail,
      effectiveSourceSummary: await this.sourceResolver.resolve(
        context.workspaceId,
        {
          definitionRef: ref,
          sourcePackId: readStringMetadata(
            detail.definition.metadata,
            "sourcePackId",
          ),
          sourcePackVersion: readStringMetadata(
            detail.definition.metadata,
            "sourcePackVersion",
          ),
          sourceKind: readStringMetadata(
            detail.definition.metadata,
            "sourceKind",
          ),
          sourceLayer: readStringMetadata(
            detail.definition.metadata,
            "sourceLayer",
          ),
          trustStatus: readStringMetadata(
            detail.definition.metadata,
            "trustStatus",
          ),
          systemDefault: readBooleanMetadata(
            detail.definition.metadata,
            "systemDefault",
          ),
        },
      ),
      assetAuthoringEffectiveSourceSummary:
        await this.authoringReadModel.readEffectiveSourceSummary(
          context.workspaceId,
          ref,
        ),
    };
  }

  public async listResourceBackedViewCards(
    query: AssetRegistryListQuery = {},
  ): Promise<AssetRegistryListResult<AssetRegistryResourceBackedViewCard>> {
    const context = await this.resolveWorkspaceContext(query.workspaceId);
    if (!context.ok)
      throw new WorkspaceAssetRegistryReadFacadeError(
        context.diagnostic.code as WorkspaceAssetRegistryReadFailureCode,
        context.diagnostic.message,
      );
    if (!queryAllowsModelResourceViews(query)) {
      return emptyList(
        diagnostic(
          "workspace-resource-backed-view-deferred",
          "info",
          "Workspace resource-backed view descriptors are currently limited to model inventory views.",
        ),
      );
    }
    if (!this.dependencies.assetRegistryRead.listResourceBackedViewCards) {
      return emptyList(
        diagnostic(
          "workspace-resource-backed-view-deferred",
          "info",
          "Workspace model resource-backed view descriptors are unavailable.",
        ),
      );
    }
    const result =
      await this.dependencies.assetRegistryRead.listResourceBackedViewCards({
        ...query,
        workspaceId: context.workspaceId,
        viewKinds: ["model"],
      });
    return {
      items: result.items.filter((item) => item.viewKind === "model"),
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      ...(result.diagnostics?.length
        ? { diagnostics: result.diagnostics }
        : {}),
    };
  }

  public async readResourceBackedViewDetail(
    viewId: string,
    options: AssetRegistryReadOptions = {},
  ): Promise<AssetRegistryResourceBackedViewDetail | undefined> {
    const context = await this.resolveWorkspaceContext(options.workspaceId);
    if (!context.ok)
      throw new WorkspaceAssetRegistryReadFacadeError(
        context.diagnostic.code as WorkspaceAssetRegistryReadFailureCode,
        context.diagnostic.message,
      );
    if (!this.dependencies.assetRegistryRead.readResourceBackedViewDetail) {
      throw new WorkspaceAssetRegistryReadFacadeError(
        "workspace-resource-backed-view-deferred",
        "Workspace model resource-backed view descriptors are unavailable.",
      );
    }
    const detail =
      await this.dependencies.assetRegistryRead.readResourceBackedViewDetail(
        viewId,
        {
          ...options,
          workspaceId: context.workspaceId,
        },
      );
    return detail?.view.viewKind === "model" ? detail : undefined;
  }

  private async resolveWorkspaceContext(
    workspaceId: unknown,
  ): Promise<
    | { readonly ok: true; readonly workspaceId: WorkspaceId }
    | { readonly ok: false; readonly diagnostic: AssetRegistryListDiagnostic }
  > {
    if (
      workspaceId === undefined ||
      workspaceId === null ||
      workspaceId === ""
    ) {
      return {
        ok: false,
        diagnostic: diagnostic(
          "workspace-required",
          "error",
          "Workspace id is required for Asset Library reads.",
        ),
      };
    }
    if (!isWorkspaceId(workspaceId)) {
      return {
        ok: false,
        diagnostic: diagnostic(
          "workspace-invalid",
          "error",
          "Workspace id is invalid for Asset Library reads.",
        ),
      };
    }

    if (this.dependencies.workspaceRepository) {
      const workspace =
        await this.dependencies.workspaceRepository.readWorkspace(workspaceId);
      if (!workspace) {
        return {
          ok: false,
          diagnostic: diagnostic(
            "workspace-not-found",
            "error",
            "Workspace was not found for Asset Library reads.",
          ),
        };
      }
      if (workspace.status !== "active") {
        return {
          ok: false,
          diagnostic: diagnostic(
            "workspace-unavailable",
            "error",
            "Workspace is unavailable for Asset Library reads.",
          ),
        };
      }
    }

    return { ok: true, workspaceId };
  }

  private async readActiveSystemPacks(
    workspaceId: WorkspaceId,
  ): Promise<
    | {
        readonly ok: true;
        readonly activeSystemPacks: readonly ActiveSystemPackKey[];
        readonly diagnostics: readonly AssetRegistryListDiagnostic[];
      }
    | { readonly ok: false; readonly diagnostic: AssetRegistryListDiagnostic }
  > {
    const result =
      await this.dependencies.listWorkspaceSystemPackActivations.execute(
        workspaceId,
      );
    if (result.status !== "listed") {
      return {
        ok: false,
        diagnostic: diagnostic(
          "workspace-system-pack-activation-unavailable",
          "error",
          "Workspace system pack activations are unavailable for Asset Library reads.",
        ),
      };
    }
    return {
      ok: true,
      activeSystemPacks: result.activeSystemPacks.map((pack) => ({
        packId: String(pack.packId),
        packVersion: String(pack.packVersion),
      })),
      diagnostics: result.diagnostics.map((entry) =>
        diagnostic(entry.code, entry.severity, entry.message),
      ),
    };
  }
}

function isUserLibraryOrWorkspaceReuseSource(
  kind: string | undefined,
): boolean {
  return (
    kind === "user-library-linked" ||
    kind === "user-library-copied" ||
    kind === "workspace-imported"
  );
}

function isWorkspaceAuthoringSource(kind: string | undefined): boolean {
  return (
    kind === "workspace-authored" ||
    kind === "workspace-override" ||
    kind === "linked-with-workspace-override"
  );
}

function systemFoundationCards(
  activeSystemPacks: readonly ActiveSystemPackKey[],
  query: AssetRegistryListQuery,
): readonly AssetDefinitionCard[] {
  return activeSystemPacks
    .filter((pack) => pack.packId === SYSTEM_FOUNDATION_PACK_ID)
    .flatMap((pack) => {
      const manifest = readSystemFoundationManifest(pack.packVersion);
      return (
        manifest?.assets.map((entry) =>
          systemFoundationCard(
            entry,
            manifest.version,
            query.includeMetadata === true,
          ),
        ) ?? []
      );
    })
    .filter((card) => matchesDefinitionQuery(card, query));
}

function systemFoundationCard(
  entry: AssetPackManifest["assets"][number],
  packVersion: string,
  includeMetadata: boolean,
): AssetDefinitionCard {
  const definition = entry.definition;
  const category = SYSTEM_FOUNDATION_PACK_CATEGORIES.find(
    (item) => item.categoryId === entry.category,
  );
  return {
    definitionRef: entry.definitionRef,
    definitionId: String(definition.definitionId),
    version: definition.version,
    assetType: definition.assetType,
    assetFamily: definition.assetFamily,
    displayName: definition.displayName,
    summary: definition.description,
    lifecycleStatus: definition.lifecycleStatus,
    builtIn: true,
    sourcePackId: SYSTEM_FOUNDATION_PACK_ID,
    sourcePackVersion: packVersion,
    sourcePackDisplayName: SYSTEM_FOUNDATION_PACK_DISPLAY_NAME,
    sourceKind: SYSTEM_FOUNDATION_PACK_SOURCE_KIND,
    sourceLayer: SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
    trustStatus: SYSTEM_FOUNDATION_PACK_TRUST_STATUS,
    packCategoryId: entry.category,
    ...(category ? { packCategoryDisplayName: category.displayName } : {}),
    ...(entry.tags?.length ? { packTags: entry.tags } : {}),
    systemDefault: true,
    installedPack: true,
    ...(includeMetadata
      ? { metadata: systemFoundationMetadata(entry, packVersion) }
      : {}),
  };
}

function systemFoundationDetail(
  ref: AssetReference,
): AssetDefinitionDetail | undefined {
  const requestedVersion =
    typeof ref.version === "string" ? ref.version : undefined;
  const versions = requestedVersion
    ? [requestedVersion]
    : [...SYSTEM_FOUNDATION_PACK_VERSIONS].reverse();
  const match = versions
    .map((version) => readSystemFoundationManifest(version))
    .filter((manifest): manifest is AssetPackManifest => Boolean(manifest))
    .map((manifest) => ({
      manifest,
      entry: manifest.assets.find(
        (candidate) =>
          String(candidate.definition.definitionId) === String(ref.id),
      ),
    }))
    .find((candidate) => candidate.entry);
  if (!match?.entry) return undefined;
  return {
    definition: withSystemFoundationMetadata(
      match.entry.definition,
      match.entry,
      match.manifest.version,
    ),
    builtIn: true,
  };
}

function withSystemFoundationMetadata(
  definition: AssetDefinition,
  entry: AssetPackManifest["assets"][number],
  packVersion: string,
): AssetDefinition {
  return {
    ...definition,
    metadata: {
      ...(definition.metadata ?? {}),
      ...systemFoundationMetadata(entry, packVersion),
    },
    provenance: {
      ...definition.provenance,
      metadata: {
        ...(definition.provenance.metadata ?? {}),
        sourcePackId: SYSTEM_FOUNDATION_PACK_ID,
        sourcePackVersion: packVersion,
        sourceLayer: SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
        sourcePackEntryId: entry.entryId,
      },
    },
  };
}

function systemFoundationMetadata(
  entry: AssetPackManifest["assets"][number],
  packVersion: string,
): AssetMetadata {
  return {
    sourcePackId: SYSTEM_FOUNDATION_PACK_ID,
    sourcePackVersion: packVersion,
    sourceKind: SYSTEM_FOUNDATION_PACK_SOURCE_KIND,
    sourceLayer: SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
    sourcePackEntryId: entry.entryId,
    sourcePackFingerprint: entry.fingerprint,
    trustStatus: SYSTEM_FOUNDATION_PACK_TRUST_STATUS,
    systemDefault: true,
    assetPackInstall: {
      packId: SYSTEM_FOUNDATION_PACK_ID,
      packVersion,
      entryId: entry.entryId,
      fingerprint: entry.fingerprint,
      sourceKind: SYSTEM_FOUNDATION_PACK_SOURCE_KIND,
      sourceLayer: SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
      trustStatus: SYSTEM_FOUNDATION_PACK_TRUST_STATUS,
      managedBy: "asset-kernel",
      installedAt: "system-foundation-manifest",
    },
  };
}

function matchesDefinitionQuery(
  card: AssetDefinitionCard,
  query: AssetRegistryListQuery,
): boolean {
  return (
    (!query.assetTypes?.length || query.assetTypes.includes(card.assetType)) &&
    (!query.assetFamilies?.length ||
      query.assetFamilies.includes(card.assetFamily)) &&
    (!query.lifecycleStatuses?.length ||
      query.lifecycleStatuses.includes(card.lifecycleStatus)) &&
    (query.includeBuiltIns !== false || card.builtIn !== true) &&
    (query.includeCustom !== false || card.builtIn === true) &&
    matchesSearchText(query.searchText, [
      card.definitionId,
      card.displayName,
      card.summary,
      card.assetType,
      card.assetFamily,
      card.sourcePackDisplayName,
      card.packCategoryDisplayName,
    ])
  );
}

function matchesSearchText(
  searchText: string | undefined,
  values: readonly (string | undefined)[],
): boolean {
  const needle = searchText?.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => value?.toLowerCase().includes(needle));
}

function definitionKey(card: AssetDefinitionCard): string {
  return `${card.definitionId}@${card.version}`;
}

function queryAllowsModelResourceViews(query: AssetRegistryListQuery): boolean {
  return (
    (!query.viewKinds?.length || query.viewKinds.includes("model")) &&
    (!query.assetTypes?.length || query.assetTypes.includes("model")) &&
    (!query.assetFamilies?.length ||
      query.assetFamilies.includes("resource-backed"))
  );
}

function isInWorkspaceEffectiveView(
  card: AssetDefinitionCard,
  activeSystemPacks: readonly ActiveSystemPackKey[],
): boolean {
  return activeSystemPacks.some(
    (pack) =>
      card.sourcePackId === pack.packId &&
      card.sourcePackVersion === pack.packVersion &&
      card.sourceKind === "system" &&
      card.sourceLayer === "system-default" &&
      card.trustStatus === "system-trusted" &&
      card.systemDefault === true,
  );
}

function isDetailInWorkspaceEffectiveView(
  detail: AssetDefinitionDetail,
  activeSystemPacks: readonly ActiveSystemPackKey[],
): boolean {
  const metadata = (detail.definition.metadata ?? {}) as Record<
    string,
    unknown
  >;
  const installMetadata = (
    typeof metadata.assetPackInstall === "object" &&
    metadata.assetPackInstall !== null
      ? metadata.assetPackInstall
      : {}
  ) as Record<string, unknown>;
  const sourcePackId =
    typeof metadata.sourcePackId === "string"
      ? metadata.sourcePackId
      : installMetadata.packId;
  const sourcePackVersion =
    typeof metadata.sourcePackVersion === "string"
      ? metadata.sourcePackVersion
      : installMetadata.packVersion;
  const sourceKind = metadata.sourceKind ?? installMetadata.sourceKind;
  const sourceLayer = metadata.sourceLayer ?? installMetadata.sourceLayer;
  const trustStatus = metadata.trustStatus ?? installMetadata.trustStatus;
  const hasTrustedInstallMarker =
    typeof installMetadata.entryId === "string" &&
    typeof installMetadata.fingerprint === "string" &&
    installMetadata.managedBy === "asset-kernel";
  return activeSystemPacks.some(
    (pack) =>
      sourcePackId === pack.packId &&
      sourcePackVersion === pack.packVersion &&
      sourceKind === "system" &&
      sourceLayer === "system-default" &&
      trustStatus === "system-trusted" &&
      (hasTrustedInstallMarker ||
        metadata.systemDefault === true ||
        detail.builtIn === true),
  );
}

function emptyList<T>(
  entry: AssetRegistryListDiagnostic,
): AssetRegistryListResult<T> {
  return { items: [], diagnostics: [entry] };
}

function diagnostic(
  code: string,
  severity: AssetRegistryListDiagnostic["severity"],
  message: string,
): AssetRegistryListDiagnostic {
  return { code, severity, message };
}

function mergeDiagnostics(
  left: readonly AssetRegistryListDiagnostic[] | undefined,
  right: readonly AssetRegistryListDiagnostic[] | undefined,
): readonly AssetRegistryListDiagnostic[] {
  return [...(left ?? []), ...(right ?? [])]
    .map((entry) => diagnostic(entry.code, entry.severity, entry.message))
    .sort((a, b) =>
      `${a.severity}:${a.code}:${a.message}`.localeCompare(
        `${b.severity}:${b.code}:${b.message}`,
      ),
    );
}

function compareDefinitionCards(
  left: AssetDefinitionCard,
  right: AssetDefinitionCard,
): number {
  const name = left.displayName.localeCompare(right.displayName);
  if (name !== 0) return name;
  const id = left.definitionId.localeCompare(right.definitionId);
  if (id !== 0) return id;
  return left.version.localeCompare(right.version);
}

function readStringMetadata(
  metadata: unknown,
  key: string,
): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function readBooleanMetadata(
  metadata: unknown,
  key: string,
): boolean | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : undefined;
}
