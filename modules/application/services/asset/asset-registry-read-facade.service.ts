import type {
  AssetBinding,
  AssetComposition,
  AssetDefinition,
  AssetInstance,
  AssetMetadata,
  AssetPackSourceKind,
  AssetPackTrustStatus,
  AssetReference,
  AssetResourceBackedView,
  AssetSourceLayer,
} from "../../../contracts/asset";
import {
  isAssetPackSourceKind,
  isAssetPackTrustStatus,
  isAssetSourceLayer,
  normalizeAssetId,
} from "../../../contracts/asset";
import type {
  AssetBindingRepositoryPort,
  AssetCompositionListQuery,
  AssetCompositionRepositoryPort,
  AssetDefinitionListQuery,
  AssetDefinitionRepositoryPort,
  AssetInstanceListQuery,
  AssetInstanceRepositoryPort,
  AssetResourceBackedViewListQuery,
  AssetResourceBackedViewProvider,
  AssetResourceBackedViewProviderDiagnostic,
} from "../../ports/asset";
import { BUILT_IN_ASSET_DEFINITION_CATALOG } from "./built-ins";
import { sanitizeAssetJsonValue, sanitizeAssetMetadata, sanitizeAssetStringValue, sanitizeAssetViewValue } from "./asset-safe-metadata";
import { validateAssetComposition } from "./validate-asset-composition.service";
import { validateAssetDefinition } from "./validate-asset-definition.service";
import { validateAssetInstance } from "./validate-asset-instance.service";
import type {
  AssetBindingSummary,
  AssetCompositionCard,
  AssetCompositionDetail,
  AssetConfigurationSummary,
  AssetDefinitionCard,
  AssetDefinitionDetail,
  AssetInstanceCard,
  AssetInstanceDetail,
  AssetRegistryListDiagnostic,
  AssetRegistryListQuery,
  AssetRegistryListResult,
  AssetRegistryReadOptions,
  AssetRegistryResourceBackedViewCard,
  AssetRegistryResourceBackedViewDetail,
} from "./asset-registry-read-facade.types";
import type { AssetValidationContext } from "./asset-validation-helpers";

export interface AssetRegistryReadFacadeDependencies {
  readonly definitionRepository: AssetDefinitionRepositoryPort;
  readonly instanceRepository: AssetInstanceRepositoryPort;
  readonly compositionRepository: AssetCompositionRepositoryPort;
  readonly bindingRepository?: AssetBindingRepositoryPort;
  readonly resourceBackedViewProvider?: AssetResourceBackedViewProvider;
  readonly maxListLimit?: number;
}

export class AssetRegistryReadFacadeError extends Error {
  public readonly code: "repository-read-failed" | "resource-backed-view-provider-failed";

  public constructor(code: AssetRegistryReadFacadeError["code"], message = "Asset registry read failed.") {
    super(message);
    this.name = "AssetRegistryReadFacadeError";
    this.code = code;
  }
}

const DEFAULT_LIST_LIMIT = 100;
const ABSOLUTE_MAX_LIST_LIMIT = 250;
const FACADE_SIDE_FILTERING_DIAGNOSTIC: AssetRegistryListDiagnostic = {
  severity: "info",
  code: "facade-side-filtering",
  message: "Some filters were applied after repository retrieval because the repository query port does not support the full query shape.",
};

const builtInDefinitionKeys = new Set(
  BUILT_IN_ASSET_DEFINITION_CATALOG.map((seed) => definitionKey(String(seed.definition.definitionId), String(seed.definition.version))),
);

const SYSTEM_FOUNDATION_PACK_ID = "system.foundation";
const SYSTEM_FOUNDATION_PACK_DISPLAY_NAME = "System Foundation";
const SYSTEM_FOUNDATION_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  "ui-structure": "UI Structure",
  "forms-fields": "Forms and Fields",
  "data-display": "Data Display",
  "state-messages": "State Messages",
  "page-feature-shells": "Page and Feature Shells",
  "workflow-system-shells": "Workflow and System Shells",
};

export class AssetRegistryReadFacade {
  private readonly maxListLimit: number;

  public constructor(private readonly dependencies: AssetRegistryReadFacadeDependencies) {
    this.maxListLimit = Math.min(Math.max(1, dependencies.maxListLimit ?? DEFAULT_LIST_LIMIT), ABSOLUTE_MAX_LIST_LIMIT);
  }

  public async listDefinitionCards(query: AssetRegistryListQuery = {}): Promise<AssetRegistryListResult<AssetDefinitionCard>> {
    const limit = this.safeLimit(query.limit);
    const repositoryQuery = this.definitionRepositoryQuery(query, limit);
    const list = await this.readRepository(() => this.dependencies.definitionRepository.listDefinitions(repositoryQuery), "repository-read-failed");
    const cards = list.definitions
      .map((definition) => this.toDefinitionCard(definition, query))
      .filter((card): card is AssetDefinitionCard => Boolean(card))
      .filter((card) => this.matchesDefinitionQuery(card, query));
    return this.toListResult(cards, limit, list.nextCursor, this.listDiagnostics(query, this.definitionNeedsFacadeSideFiltering(query)));
  }

  public async readDefinitionDetail(ref: AssetReference, options: AssetRegistryReadOptions = {}): Promise<AssetDefinitionDetail | undefined> {
    const definition = await this.readRepository(() => this.dependencies.definitionRepository.getDefinition(ref), "repository-read-failed");
    if (!definition) return undefined;

    const detail: AssetDefinitionDetail = {
      definition: sanitizeDefinition(definition, options),
      ...(isBuiltInDefinition(definition) ? { builtIn: true } : {}),
      ...(options.includeValidation ? { validationSummary: sanitizeValue(validateAssetDefinition(definition)) as AssetDefinitionDetail["validationSummary"] } : {}),
    };
    return sanitizeValue(detail) as AssetDefinitionDetail;
  }

  public async listInstanceCards(query: AssetRegistryListQuery = {}): Promise<AssetRegistryListResult<AssetInstanceCard>> {
    const limit = this.safeLimit(query.limit);
    const repositoryQuery = this.instanceRepositoryQuery(query, limit);
    const list = await this.readRepository(() => this.dependencies.instanceRepository.listInstances(repositoryQuery), "repository-read-failed");
    const cards = list.instances.map((instance) => this.toInstanceCard(instance, query)).filter((card) => this.matchesInstanceQuery(card, query));
    return this.toListResult(cards, limit, list.nextCursor, this.listDiagnostics(query, this.instanceNeedsFacadeSideFiltering(query)));
  }

  public async readInstanceDetail(ref: AssetReference, options: AssetRegistryReadOptions = {}): Promise<AssetInstanceDetail | undefined> {
    const instance = await this.readRepository(() => this.dependencies.instanceRepository.getInstance(ref), "repository-read-failed");
    if (!instance) return undefined;

    const validationContext = options.includeValidation ? await this.validationContextForInstance(instance) : undefined;
    const detail: AssetInstanceDetail = {
      instance: sanitizeInstance(instance, options),
      ...(summarizeConfiguration(instance.selectedConfiguration) ? { configurationSummary: summarizeConfiguration(instance.selectedConfiguration) } : {}),
      ...(options.includeValidation ? { validationSummary: sanitizeValue(validateAssetInstance(instance, validationContext)) as AssetInstanceDetail["validationSummary"] } : {}),
    };
    return sanitizeValue(detail) as AssetInstanceDetail;
  }

  public async listCompositionCards(query: AssetRegistryListQuery = {}): Promise<AssetRegistryListResult<AssetCompositionCard>> {
    const limit = this.safeLimit(query.limit);
    const repositoryQuery = this.compositionRepositoryQuery(query, limit);
    const list = await this.readRepository(() => this.dependencies.compositionRepository.listCompositions(repositoryQuery), "repository-read-failed");
    const cards = list.compositions.map((composition) => this.toCompositionCard(composition, query)).filter((card) => this.matchesCompositionQuery(card, query));
    return this.toListResult(cards, limit, list.nextCursor, this.listDiagnostics(query, this.compositionNeedsFacadeSideFiltering(query)));
  }

  public async readCompositionDetail(ref: AssetReference, options: AssetRegistryReadOptions = {}): Promise<AssetCompositionDetail | undefined> {
    const composition = await this.readRepository(() => this.dependencies.compositionRepository.getComposition(ref), "repository-read-failed");
    if (!composition) return undefined;

    const resolvedBindings = await this.resolveBindings(composition);
    const validationContext = options.includeValidation ? await this.validationContextForComposition(composition, resolvedBindings) : undefined;
    const detail: AssetCompositionDetail = {
      composition: sanitizeComposition(composition, options),
      rootInstanceRefs: sanitizeValue(composition.rootInstanceRefs) as readonly AssetReference[],
      childInstanceRefs: sanitizeValue(composition.instanceRefs) as readonly AssetReference[],
      bindingRefs: sanitizeValue(composition.bindingRefs ?? []) as readonly AssetReference[],
      bindingSummaries: resolvedBindings.map(toBindingSummary),
      ...(options.includeValidation ? { validationSummary: sanitizeValue(validateAssetComposition(composition, validationContext)) as AssetCompositionDetail["validationSummary"] } : {}),
    };
    return sanitizeValue(detail) as AssetCompositionDetail;
  }

  public async listResourceBackedViewCards(query: AssetRegistryListQuery = {}): Promise<AssetRegistryListResult<AssetRegistryResourceBackedViewCard>> {
    if (!this.dependencies.resourceBackedViewProvider) {
      const diagnostics = this.cursorDiagnostics(query);
      return diagnostics?.length ? { items: [], diagnostics } : { items: [] };
    }
    const limit = this.safeLimit(query.limit);
    const providerQuery: AssetResourceBackedViewListQuery = {
      searchText: query.searchText,
      assetTypes: query.assetTypes,
      assetFamilies: query.assetFamilies,
      lifecycleStatuses: query.lifecycleStatuses,
      viewKinds: query.viewKinds,
      limit,
      cursor: query.cursor,
      workspaceId: query.workspaceId,
    };
    const result = await this.readRepository(
      () => this.dependencies.resourceBackedViewProvider!.listResourceBackedViews(providerQuery),
      "resource-backed-view-provider-failed",
    );
    const views = result.items;
    const cards = views.map((view) => this.toResourceBackedViewCard(view, query)).filter((card) => this.matchesResourceBackedViewQuery(card, query));
    return this.toListResult(cards, limit, result.nextCursor, this.resourceBackedListDiagnostics(query, result.diagnostics));
  }

  public async readResourceBackedViewDetail(viewId: string, options: AssetRegistryReadOptions = {}): Promise<AssetRegistryResourceBackedViewDetail | undefined> {
    if (!this.dependencies.resourceBackedViewProvider) return undefined;
    const view = await this.readRepository(
      () => this.dependencies.resourceBackedViewProvider!.readResourceBackedView(viewId, { workspaceId: options.workspaceId }),
      "resource-backed-view-provider-failed",
    );
    if (!view) return undefined;
    const detail: AssetRegistryResourceBackedViewDetail = {
      view: sanitizeResourceBackedView(view, options),
      ...(options.includeValidation && view.validationSummary ? { validationSummary: sanitizeValue(view.validationSummary) as AssetRegistryResourceBackedViewDetail["validationSummary"] } : {}),
    };
    return sanitizeValue(detail) as AssetRegistryResourceBackedViewDetail;
  }

  private toDefinitionCard(definition: AssetDefinition, query: AssetRegistryListQuery): AssetDefinitionCard | undefined {
    const builtIn = isBuiltInDefinition(definition);
    if (query.includeBuiltIns === false && builtIn) return undefined;
    if (query.includeCustom === false && !builtIn) return undefined;
    const sourceMetadata = safeDefinitionSourceMetadata(definition);
    return sanitizeValue({
      definitionRef: definitionRef(definition),
      definitionId: String(definition.definitionId),
      version: String(definition.version),
      assetType: definition.assetType,
      assetFamily: definition.assetFamily,
      displayName: definition.displayName,
      summary: definition.description,
      lifecycleStatus: definition.lifecycleStatus,
      ...(builtIn ? { builtIn: true } : {}),
      ...sourceMetadata,
      ...(query.includeMetadata ? { metadata: metadataOf(definition.metadata) } : {}),
    }) as AssetDefinitionCard;
  }

  private toInstanceCard(instance: AssetInstance, query: AssetRegistryListQuery): AssetInstanceCard {
    return sanitizeValue({
      instanceRef: instanceRef(instance),
      instanceId: String(instance.instanceId),
      definitionRef: instance.definitionRef,
      displayName: instance.displayName,
      lifecycleStatus: instance.lifecycleStatus,
      ...(summarizeConfiguration(instance.selectedConfiguration) ? { configurationSummary: summarizeConfiguration(instance.selectedConfiguration) } : {}),
      ...(instance.stateSummary ? { stateSummary: instance.stateSummary } : {}),
      ...(query.includeMetadata ? { metadata: metadataOf(instance.metadata) } : {}),
    }) as AssetInstanceCard;
  }

  private toCompositionCard(composition: AssetComposition, query: AssetRegistryListQuery): AssetCompositionCard {
    return sanitizeValue({
      compositionRef: compositionRef(composition),
      compositionId: String(composition.compositionId),
      compositionType: composition.compositionType,
      version: String(composition.version),
      displayName: composition.displayName,
      summary: composition.description,
      lifecycleStatus: composition.lifecycleStatus,
      rootInstanceCount: composition.rootInstanceRefs.length,
      instanceCount: composition.instanceRefs.length,
      bindingCount: (composition.bindingRefs?.length ?? 0) + (composition.bindings?.length ?? 0),
      ...(query.includeMetadata ? { metadata: metadataOf(composition.metadata) } : {}),
    }) as AssetCompositionCard;
  }

  private toResourceBackedViewCard(view: AssetResourceBackedView, query: AssetRegistryListQuery): AssetRegistryResourceBackedViewCard {
    return sanitizeValue({
      viewId: view.viewId,
      viewKind: view.viewKind,
      displayName: view.displayName,
      summary: view.summary,
      assetType: view.assetType,
      assetFamily: view.assetFamily,
      assetDefinitionRef: view.assetDefinitionRef,
      lifecycleStatus: view.lifecycleStatus,
      ...(query.includeMetadata ? { metadata: metadataOf(view.metadata) } : {}),
    }) as AssetRegistryResourceBackedViewCard;
  }

  private matchesDefinitionQuery(card: AssetDefinitionCard, query: AssetRegistryListQuery): boolean {
    return matchesCommon(card, query, [card.displayName, card.definitionId, card.summary, card.assetType, card.assetFamily]);
  }

  private matchesInstanceQuery(card: AssetInstanceCard, query: AssetRegistryListQuery): boolean {
    return matchesLifecycle(card.lifecycleStatus, query) && matchesSearch(query.searchText, [card.displayName, card.instanceId, card.definitionRef.id]);
  }

  private matchesCompositionQuery(card: AssetCompositionCard, query: AssetRegistryListQuery): boolean {
    return matchesLifecycle(card.lifecycleStatus, query) && matchesSearch(query.searchText, [card.displayName, card.compositionId, card.summary, card.compositionType]);
  }

  private matchesResourceBackedViewQuery(card: AssetRegistryResourceBackedViewCard, query: AssetRegistryListQuery): boolean {
    return matchesCommon(card, query, [card.displayName, card.viewId, card.summary, card.assetType, card.assetFamily, card.viewKind]) && matchesViewKind(card.viewKind, query);
  }

  private async validationContextForInstance(instance: AssetInstance): Promise<AssetValidationContext> {
    const definition = await this.readRepository(() => this.dependencies.definitionRepository.getDefinition(instance.definitionRef), "repository-read-failed");
    return definition ? { definitionsById: new Map([[String(definition.definitionId), definition]]) } : {};
  }

  private async validationContextForComposition(composition: AssetComposition, bindings: readonly AssetBinding[]): Promise<AssetValidationContext> {
    const instances = await Promise.all(composition.instanceRefs.map((ref) => this.readRepository(() => this.dependencies.instanceRepository.getInstance(ref), "repository-read-failed")));
    return {
      instancesById: new Map(instances.filter((item): item is AssetInstance => Boolean(item)).map((item) => [String(item.instanceId), item])),
      bindingsById: new Map(bindings.map((binding) => [String(binding.bindingId), binding])),
    };
  }

  private async resolveBindings(composition: AssetComposition): Promise<readonly AssetBinding[]> {
    const embedded = composition.bindings ?? [];
    if (!this.dependencies.bindingRepository || !composition.bindingRefs?.length) return embedded;
    const resolved = await Promise.all(composition.bindingRefs.map((ref) => this.readRepository(() => this.dependencies.bindingRepository!.getBinding(ref), "repository-read-failed")));
    return [...embedded, ...resolved.filter((binding): binding is AssetBinding => Boolean(binding))];
  }

  private safeLimit(limit: number | undefined): number {
    if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return this.maxListLimit;
    return Math.min(Math.floor(limit), this.maxListLimit);
  }

  private repositoryFetchLimit(query: AssetRegistryListQuery, resultLimit: number, needsFacadeSideFiltering: boolean): number {
    return needsFacadeSideFiltering && !query.cursor ? this.maxListLimit : resultLimit;
  }

  private definitionRepositoryQuery(query: AssetRegistryListQuery, limit: number): AssetDefinitionListQuery {
    const needsFacadeFiltering = this.definitionNeedsFacadeSideFiltering(query);
    const assetType = singleValue(query.assetTypes);
    const assetFamily = singleValue(query.assetFamilies);
    const lifecycleStatus = singleValue(query.lifecycleStatuses);
    const text = trimmedText(query.searchText);
    return {
      ...(assetType ? { assetType } : {}),
      ...(assetFamily ? { assetFamily } : {}),
      ...(lifecycleStatus ? { lifecycleStatus } : {}),
      ...(text ? { text } : {}),
      limit: this.repositoryFetchLimit(query, limit, needsFacadeFiltering),
      cursor: query.cursor,
    };
  }

  private instanceRepositoryQuery(query: AssetRegistryListQuery, limit: number): AssetInstanceListQuery {
    const needsFacadeFiltering = this.instanceNeedsFacadeSideFiltering(query);
    const lifecycleStatus = singleValue(query.lifecycleStatuses);
    const text = trimmedText(query.searchText);
    return {
      ...(lifecycleStatus ? { lifecycleStatus } : {}),
      ...(text ? { text } : {}),
      limit: this.repositoryFetchLimit(query, limit, needsFacadeFiltering),
      cursor: query.cursor,
    };
  }

  private compositionRepositoryQuery(query: AssetRegistryListQuery, limit: number): AssetCompositionListQuery {
    const needsFacadeFiltering = this.compositionNeedsFacadeSideFiltering(query);
    const lifecycleStatus = singleValue(query.lifecycleStatuses);
    const text = trimmedText(query.searchText);
    return {
      ...(lifecycleStatus ? { lifecycleStatus } : {}),
      ...(text ? { text } : {}),
      limit: this.repositoryFetchLimit(query, limit, needsFacadeFiltering),
      cursor: query.cursor,
    };
  }

  private definitionNeedsFacadeSideFiltering(query: AssetRegistryListQuery): boolean {
    return hasMultipleValues(query.assetTypes) || hasMultipleValues(query.assetFamilies) || hasMultipleValues(query.lifecycleStatuses) || query.includeBuiltIns === false || query.includeCustom === false;
  }

  private instanceNeedsFacadeSideFiltering(query: AssetRegistryListQuery): boolean {
    return Boolean(query.assetTypes?.length || query.assetFamilies?.length || hasMultipleValues(query.lifecycleStatuses));
  }

  private compositionNeedsFacadeSideFiltering(query: AssetRegistryListQuery): boolean {
    return Boolean(query.assetTypes?.length || query.assetFamilies?.length || hasMultipleValues(query.lifecycleStatuses));
  }

  private toListResult<TCard>(items: readonly TCard[], limit: number, nextCursor?: string, diagnostics?: readonly AssetRegistryListDiagnostic[]): AssetRegistryListResult<TCard> {
    return sanitizeValue({ items: items.slice(0, limit), ...(nextCursor ? { nextCursor } : {}), ...(diagnostics?.length ? { diagnostics } : {}) }) as AssetRegistryListResult<TCard>;
  }

  private listDiagnostics(query: AssetRegistryListQuery, facadeSideFiltering: boolean): readonly AssetRegistryListDiagnostic[] | undefined {
    const diagnostics: AssetRegistryListDiagnostic[] = [];
    if (query.cursor) diagnostics.push({ severity: "info", code: "cursor-passed-through", message: "Cursor pagination is passed through to repositories or providers before facade-side filtering." });
    if (facadeSideFiltering) diagnostics.push(FACADE_SIDE_FILTERING_DIAGNOSTIC);
    return diagnostics.length ? diagnostics : undefined;
  }

  private cursorDiagnostics(query: AssetRegistryListQuery): readonly AssetRegistryListDiagnostic[] | undefined {
    return this.listDiagnostics(query, false);
  }

  private resourceBackedListDiagnostics(
    query: AssetRegistryListQuery,
    providerDiagnostics: readonly AssetResourceBackedViewProviderDiagnostic[] | undefined,
  ): readonly AssetRegistryListDiagnostic[] | undefined {
    const diagnostics = [
      ...(this.cursorDiagnostics(query) ?? []),
      ...(providerDiagnostics ?? []).map(toRegistryDiagnostic),
    ];
    return diagnostics.length ? diagnostics : undefined;
  }

  private async readRepository<T>(operation: () => Promise<T>, code: AssetRegistryReadFacadeError["code"]): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new AssetRegistryReadFacadeError(code);
    }
  }
}

function matchesCommon(
  card: { readonly assetType?: string; readonly assetFamily?: string; readonly lifecycleStatus?: string },
  query: AssetRegistryListQuery,
  textValues: readonly (string | undefined)[],
): boolean {
  return matchesAssetTypes(card.assetType, query) && matchesAssetFamilies(card.assetFamily, query) && matchesLifecycle(card.lifecycleStatus, query) && matchesSearch(query.searchText, textValues);
}

function matchesAssetTypes(assetType: string | undefined, query: AssetRegistryListQuery): boolean {
  return !query.assetTypes?.length || (assetType !== undefined && query.assetTypes.includes(assetType as never));
}

function matchesAssetFamilies(assetFamily: string | undefined, query: AssetRegistryListQuery): boolean {
  return !query.assetFamilies?.length || (assetFamily !== undefined && query.assetFamilies.includes(assetFamily as never));
}

function matchesLifecycle(lifecycleStatus: string | undefined, query: AssetRegistryListQuery): boolean {
  return !query.lifecycleStatuses?.length || (lifecycleStatus !== undefined && query.lifecycleStatuses.includes(lifecycleStatus as never));
}

function matchesViewKind(viewKind: string | undefined, query: AssetRegistryListQuery): boolean {
  return !query.viewKinds?.length || (viewKind !== undefined && query.viewKinds.includes(viewKind as never));
}

function matchesSearch(searchText: string | undefined, values: readonly (string | undefined)[]): boolean {
  const needle = searchText?.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => value?.toLowerCase().includes(needle));
}

function singleValue<T>(values: readonly T[] | undefined): T | undefined {
  return values?.length === 1 ? values[0] : undefined;
}

function hasMultipleValues(values: readonly unknown[] | undefined): boolean {
  return Boolean(values && values.length > 1);
}

function trimmedText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function definitionKey(id: string, version?: string): string {
  return `${id}@${version ?? ""}`;
}

function isBuiltInDefinition(definition: AssetDefinition): boolean {
  const metadata = definition.metadata as Record<string, unknown> | undefined;
  const marker = metadata?.builtInSeed;
  const markerRecord = isRecord(marker) ? marker : undefined;
  if (
    markerRecord?.managedBy === "asset-kernel" &&
    typeof markerRecord.seedId === "string" &&
    typeof markerRecord.seedVersion === "string" &&
    typeof markerRecord.fingerprint === "string"
  ) {
    return true;
  }
  if (isSystemFoundationSystemDefaultDefinition(definition)) {
    return true;
  }
  return builtInDefinitionKeys.has(definitionKey(String(definition.definitionId), String(definition.version)));
}

function isSystemFoundationSystemDefaultDefinition(definition: AssetDefinition): boolean {
  const metadata = isRecord(definition.metadata) ? definition.metadata : {};
  return hasTrustedSystemFoundationInstallMarker(metadata) || hasTrustedSystemFoundationSourceMetadata(metadata);
}

function hasTrustedSystemFoundationInstallMarker(metadata: Record<string, unknown>): boolean {
  const installMetadata = isRecord(metadata.assetPackInstall) ? metadata.assetPackInstall : undefined;
  return Boolean(
    installMetadata &&
      safeIdentifier(installMetadata.packId) === SYSTEM_FOUNDATION_PACK_ID &&
      typeof installMetadata.packVersion === "string" &&
      typeof installMetadata.entryId === "string" &&
      typeof installMetadata.fingerprint === "string" &&
      installMetadata.sourceKind === "system" &&
      installMetadata.sourceLayer === "system-default" &&
      installMetadata.trustStatus === "system-trusted" &&
      installMetadata.managedBy === "asset-kernel" &&
      typeof installMetadata.installedAt === "string",
  );
}

function hasTrustedSystemFoundationSourceMetadata(metadata: Record<string, unknown>): boolean {
  return (
    safeIdentifier(metadata.sourcePackId) === SYSTEM_FOUNDATION_PACK_ID &&
    metadata.sourceKind === "system" &&
    metadata.sourceLayer === "system-default" &&
    metadata.trustStatus === "system-trusted"
  );
}

function definitionRef(definition: AssetDefinition): AssetReference {
  return { kind: "asset-definition-version", id: normalizeAssetId(String(definition.definitionId)), version: String(definition.version) };
}

function instanceRef(instance: AssetInstance): AssetReference {
  return { kind: "asset-instance", id: normalizeAssetId(String(instance.instanceId)) };
}

function compositionRef(composition: AssetComposition): AssetReference {
  return { kind: "asset-composition", id: normalizeAssetId(String(composition.compositionId)), version: String(composition.version) };
}

function bindingRef(binding: AssetBinding): AssetReference {
  return { kind: "asset-binding", id: normalizeAssetId(String(binding.bindingId)) };
}

function toBindingSummary(binding: AssetBinding): AssetBindingSummary {
  return sanitizeValue({
    bindingRef: bindingRef(binding),
    bindingId: String(binding.bindingId),
    bindingKind: binding.bindingKind,
    sourceRef: binding.sourceRef,
    targetRef: binding.targetRef,
    lifecycleStatus: binding.lifecycleStatus,
  }) as AssetBindingSummary;
}

function safeDefinitionSourceMetadata(definition: AssetDefinition): Partial<AssetDefinitionCard> {
  const metadata = isRecord(definition.metadata) ? definition.metadata : {};
  const installMetadata = isRecord(metadata.assetPackInstall) ? metadata.assetPackInstall : {};
  const sourcePackId = safeIdentifier(metadata.sourcePackId) ?? safeIdentifier(installMetadata.packId);
  const sourcePackVersion =
    sanitizeAssetStringValue(stringValue(metadata.sourcePackVersion)) ??
    sanitizeAssetStringValue(stringValue(installMetadata.packVersion));
  const sourceLayer = safeSourceLayer(metadata.sourceLayer) ?? safeSourceLayer(installMetadata.sourceLayer);
  const categoryId =
    safeIdentifier(metadata.packCategoryId) ??
    safeIdentifier(metadata.categoryId) ??
    safeIdentifier(installMetadata.categoryId);
  const sourceKind =
    safeSourceKind(metadata.sourceKind) ??
    safeSourceKind(installMetadata.sourceKind);
  const trustStatus =
    safeTrustStatus(metadata.trustStatus) ??
    safeTrustStatus(installMetadata.trustStatus);
  const trustedSystemDefault = hasTrustedSystemFoundationInstallMarker(metadata) || hasTrustedSystemFoundationSourceMetadata(metadata);
  const sourcePackDisplayName =
    sanitizeAssetStringValue(stringValue(metadata.sourcePackDisplayName)) ??
    (trustedSystemDefault ? SYSTEM_FOUNDATION_PACK_DISPLAY_NAME : undefined);
  const packTags = safeStringArray(metadata.packTags ?? metadata.tags);
  const overridesDefinitionRef = safeAssetReference(metadata.overridesDefinitionRef);
  const overriddenByDefinitionRefs = safeAssetReferenceArray(metadata.overriddenByDefinitionRefs);
  const effectiveResolutionStatus = sanitizeAssetStringValue(stringValue(metadata.effectiveResolutionStatus));
  const resolutionSummary = sanitizeAssetStringValue(stringValue(metadata.resolutionSummary));

  return {
    ...(sourcePackId ? { sourcePackId } : {}),
    ...(sourcePackVersion ? { sourcePackVersion } : {}),
    ...(sourcePackDisplayName ? { sourcePackDisplayName } : {}),
    ...(sourceKind ? { sourceKind } : {}),
    ...(sourceLayer ? { sourceLayer } : {}),
    ...(trustStatus ? { trustStatus } : {}),
    ...(categoryId ? { packCategoryId: categoryId } : {}),
    ...(categoryId && SYSTEM_FOUNDATION_CATEGORY_LABELS[categoryId] ? { packCategoryDisplayName: SYSTEM_FOUNDATION_CATEGORY_LABELS[categoryId] } : {}),
    ...(packTags.length ? { packTags } : {}),
    ...(trustedSystemDefault ? { systemDefault: true } : {}),
    ...(sourceLayer === "installed-pack" ? { installedPack: true } : {}),
    ...(sourceLayer === "imported-pack" ? { importedPack: true } : {}),
    ...(sourceLayer === "workspace-pack" ? { workspacePack: true } : {}),
    ...(sourceLayer === "workspace-pack" && overridesDefinitionRef ? { workspaceOverride: true } : {}),
    ...(sourceLayer === "organization-override" ? { organizationOverride: true } : {}),
    ...(sourceLayer === "user-override" ? { userOverride: true } : {}),
    ...(overridesDefinitionRef ? { overridesDefinitionRef } : {}),
    ...(overriddenByDefinitionRefs.length ? { overriddenByDefinitionRefs } : {}),
    ...(effectiveResolutionStatus ? { effectiveResolutionStatus } : {}),
    ...(resolutionSummary ? { resolutionSummary } : {}),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function safeIdentifier(value: unknown): string | undefined {
  const sanitized = sanitizeAssetStringValue(stringValue(value));
  if (!sanitized || !/^[a-z0-9][a-z0-9._:-]*$/i.test(sanitized)) return undefined;
  return sanitized;
}

function safeSourceKind(value: unknown): AssetPackSourceKind | undefined {
  const sanitized = sanitizeAssetStringValue(stringValue(value));
  return sanitized && isAssetPackSourceKind(sanitized) ? sanitized : undefined;
}

function safeSourceLayer(value: unknown): AssetSourceLayer | undefined {
  const sanitized = sanitizeAssetStringValue(stringValue(value));
  return sanitized && isAssetSourceLayer(sanitized) ? sanitized : undefined;
}

function safeTrustStatus(value: unknown): AssetPackTrustStatus | undefined {
  const sanitized = sanitizeAssetStringValue(stringValue(value));
  return sanitized && isAssetPackTrustStatus(sanitized) ? sanitized : undefined;
}

function safeStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(safeIdentifier).filter((entry): entry is string => Boolean(entry))));
}

function safeAssetReference(value: unknown): AssetReference | undefined {
  if (!isRecord(value)) return undefined;
  const kind = sanitizeAssetStringValue(stringValue(value.kind));
  const id = safeIdentifier(value.id);
  const version = sanitizeAssetStringValue(stringValue(value.version));
  if (!kind || !id) return undefined;
  if (kind !== "asset-definition" && kind !== "asset-definition-version") return undefined;
  return {
    kind: kind as AssetReference["kind"],
    id: normalizeAssetId(id),
    ...(version ? { version } : {}),
  };
}

function safeAssetReferenceArray(value: unknown): readonly AssetReference[] {
  if (!Array.isArray(value)) return [];
  return value.map(safeAssetReference).filter((entry): entry is AssetReference => Boolean(entry));
}

function toRegistryDiagnostic(diagnostic: AssetResourceBackedViewProviderDiagnostic): AssetRegistryListDiagnostic {
  return {
    severity: diagnostic.severity === "error" || diagnostic.severity === "warning" ? diagnostic.severity : "info",
    code: sanitizeDiagnosticText(diagnostic.code) ?? "resource-backed-view-provider-diagnostic",
    message: sanitizeAssetStringValue(diagnostic.message) ?? "Resource-backed view provider diagnostic was sanitized.",
    ...(sanitizeDiagnosticText(diagnostic.providerId) ? { providerId: sanitizeDiagnosticText(diagnostic.providerId) } : {}),
    ...(sanitizeDiagnosticText(diagnostic.sourceKind) ? { sourceKind: sanitizeDiagnosticText(diagnostic.sourceKind) } : {}),
    ...(sanitizeAssetMetadata(diagnostic.metadata) ? { metadata: sanitizeAssetMetadata(diagnostic.metadata) } : {}),
  };
}

function sanitizeDiagnosticText(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || !/^[a-z0-9_.:-]+$/i.test(sanitized)) return undefined;
  return sanitized;
}

function summarizeConfiguration(values: unknown): AssetConfigurationSummary | undefined {
  if (!isRecord(values)) return undefined;
  const ids = Object.keys(values).filter((key) => typeof sanitizeAssetJsonValue(values[key]) !== "undefined").sort();
  return { configuredFieldCount: ids.length, configuredFieldIds: ids };
}

function sanitizeDefinition(definition: AssetDefinition, options: AssetRegistryReadOptions): AssetDefinition {
  return sanitizeValue({
    definitionId: definition.definitionId,
    assetType: definition.assetType,
    assetFamily: definition.assetFamily,
    version: definition.version,
    displayName: definition.displayName,
    description: definition.description,
    lifecycleStatus: definition.lifecycleStatus,
    reviewStatus: definition.reviewStatus,
    provenance: definition.provenance,
    defaultConfiguration: definition.defaultConfiguration,
    configurationExamples: definition.configurationExamples,
    compositionRuleRefs: definition.compositionRuleRefs,
    compositionRules: definition.compositionRules,
    dependencies: definition.dependencies,
    ...(options.includeConfigurationSchema ? { configurationSchema: definition.configurationSchema } : {}),
    ...(options.includeAiContext ? { aiContext: definition.aiContext } : {}),
    ...(options.includeRequirements ? { requirements: definition.requirements, requirementRefs: definition.requirementRefs } : {}),
    ...(options.includePorts ? { ports: definition.ports, portRefs: definition.portRefs } : {}),
    ...(options.includeMetadata ? { metadata: metadataOf(definition.metadata) } : {}),
  }) as AssetDefinition;
}

function sanitizeInstance(instance: AssetInstance, options: AssetRegistryReadOptions): AssetInstance {
  return sanitizeValue({
    instanceId: instance.instanceId,
    definitionRef: instance.definitionRef,
    displayName: instance.displayName,
    lifecycleStatus: instance.lifecycleStatus,
    reviewStatus: instance.reviewStatus,
    selectedConfiguration: instance.selectedConfiguration,
    bindingRefs: instance.bindingRefs,
    parentCompositionRef: instance.parentCompositionRef,
    resourceRefs: instance.resourceRefs,
    stateSummary: instance.stateSummary,
    provenance: instance.provenance,
    ...(options.includeMetadata ? { metadata: metadataOf(instance.metadata) } : {}),
  }) as AssetInstance;
}

function sanitizeComposition(composition: AssetComposition, options: AssetRegistryReadOptions): AssetComposition {
  return sanitizeValue({
    compositionId: composition.compositionId,
    compositionType: composition.compositionType,
    displayName: composition.displayName,
    description: composition.description,
    version: composition.version,
    lifecycleStatus: composition.lifecycleStatus,
    reviewStatus: composition.reviewStatus,
    rootInstanceRefs: composition.rootInstanceRefs,
    instanceRefs: composition.instanceRefs,
    bindingRefs: composition.bindingRefs,
    bindings: composition.bindings,
    compositionRules: composition.compositionRules,
    dependencies: composition.dependencies,
    provenance: composition.provenance,
    validationSummary: composition.validationSummary,
    ...(options.includeMetadata ? { metadata: metadataOf(composition.metadata) } : {}),
  }) as AssetComposition;
}

function sanitizeResourceBackedView(view: AssetResourceBackedView, options: AssetRegistryReadOptions): AssetResourceBackedView {
  return sanitizeValue({
    viewId: view.viewId,
    viewKind: view.viewKind,
    assetType: view.assetType,
    assetFamily: view.assetFamily,
    assetDefinitionRef: view.assetDefinitionRef,
    assetInstanceRef: view.assetInstanceRef,
    ...(options.includeResourceBackings ? { resourceBacking: view.resourceBacking, resourceBackedAsset: view.resourceBackedAsset } : {}),
    generatedOutput: view.generatedOutput,
    preview: view.preview,
    sourceRef: view.sourceRef,
    displayName: view.displayName,
    summary: view.summary,
    lifecycleStatus: view.lifecycleStatus,
    ...(options.includeValidation ? { validationSummary: view.validationSummary } : {}),
    ...(options.includeMetadata ? { metadata: metadataOf(view.metadata), diagnostics: view.diagnostics } : {}),
  }) as AssetResourceBackedView;
}

function metadataOf(metadata: AssetMetadata | undefined): AssetMetadata | undefined {
  return sanitizeAssetMetadata(metadata);
}

function sanitizeValue(value: unknown): unknown {
  return sanitizeAssetViewValue(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
