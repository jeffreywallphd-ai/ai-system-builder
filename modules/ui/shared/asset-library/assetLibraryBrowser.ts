import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AssetFamily,
  AssetLifecycleStatus,
  AssetType,
} from "../../../contracts/asset";
import {
  isAssetFamily,
  isAssetLifecycleStatus,
  isAssetType,
} from "../../../contracts/asset";
import type { AssetLibraryBuiltInFilter, AssetLibraryQuery } from "./assetLibraryQueries";
import type {
  AssetLibraryClient,
  AssetLibraryDefinitionCard,
  AssetLibraryDefinitionDetail,
  AssetLibraryResourceBackedViewCard,
  AssetLibraryResourceBackedViewDetail,
} from "./assetLibraryReadModels";
import { sanitizeAssetLibraryDiagnosticMessages, sanitizeAssetLibraryDisplayText } from "./assetLibraryMappers";
import {
  filterAssetDefinitionsByCategory,
  filterAssetDefinitionsByPack,
  filterAssetDefinitionsBySourceLayer,
} from "./assetLibraryPackDiscovery";

export type AssetLibraryBrowserTab = "definitions" | "resource-views";

export type AssetLibraryFilterValue = "all" | string;

export interface AssetLibraryFiltersState {
  readonly searchText: string;
  readonly assetType: AssetLibraryFilterValue;
  readonly assetFamily: AssetLibraryFilterValue;
  readonly lifecycleStatus: AssetLibraryFilterValue;
  readonly builtIn: AssetLibraryBuiltInFilter;
  readonly packId: AssetLibraryFilterValue;
  readonly sourceLayer: AssetLibraryFilterValue;
  readonly categoryId: AssetLibraryFilterValue;
}

export interface AssetLibraryFeatureState {
  readonly client: AssetLibraryClient;
  readonly activeTab: AssetLibraryBrowserTab;
  readonly filters: AssetLibraryFiltersState;
  readonly definitions: readonly AssetLibraryDefinitionCard[];
  readonly resourceBackedViews: readonly AssetLibraryResourceBackedViewCard[];
  readonly selectedDefinitionId?: string;
  readonly selectedResourceBackedViewId?: string;
  readonly selectedDetail?: AssetLibraryDefinitionDetail;
  readonly selectedResourceBackedViewDetail?: AssetLibraryResourceBackedViewDetail;
  readonly isLoadingList: boolean;
  readonly isLoadingDetail: boolean;
  readonly isLoadingValidation: boolean;
  readonly listError?: string;
  readonly detailError?: string;
  readonly validationError?: string;
  readonly hasActiveFilters: boolean;
  readonly diagnostics: readonly string[];
  readonly setSearchText: (value: string) => void;
  readonly setAssetType: (value: AssetLibraryFilterValue) => void;
  readonly setAssetFamily: (value: AssetLibraryFilterValue) => void;
  readonly setLifecycleStatus: (value: AssetLibraryFilterValue) => void;
  readonly setBuiltIn: (value: AssetLibraryBuiltInFilter) => void;
  readonly setPackId: (value: AssetLibraryFilterValue) => void;
  readonly setSourceLayer: (value: AssetLibraryFilterValue) => void;
  readonly setCategoryId: (value: AssetLibraryFilterValue) => void;
  readonly setActiveTab: (value: AssetLibraryBrowserTab) => void;
  readonly selectDefinition: (definition: AssetLibraryDefinitionCard) => Promise<void>;
  readonly selectResourceBackedView: (view: AssetLibraryResourceBackedViewCard) => Promise<void>;
  readonly loadValidationDetails: () => Promise<void>;
  readonly refresh: () => Promise<void>;
}

export const ASSET_LIBRARY_DEFAULT_FILTERS: AssetLibraryFiltersState = {
  searchText: "",
  assetType: "all",
  assetFamily: "all",
  lifecycleStatus: "all",
  builtIn: "all",
  packId: "all",
  sourceLayer: "all",
  categoryId: "all",
};

export const ASSET_LIBRARY_DETAIL_EXPANSIONS = [
  "aiContext",
  "configurationSchema",
  "ports",
  "requirements",
  "provenance",
  "metadata",
] as const;

export function createAssetLibraryQuery(filters: AssetLibraryFiltersState): AssetLibraryQuery {
  const searchText = filters.searchText.trim();
  return {
    limit: 50,
    ...(searchText ? { searchText } : {}),
    ...(filters.assetType !== "all" && isAssetType(filters.assetType) ? { assetTypes: [filters.assetType as AssetType] } : {}),
    ...(filters.assetFamily !== "all" && isAssetFamily(filters.assetFamily)
      ? { assetFamilies: [filters.assetFamily as AssetFamily] }
      : {}),
    ...(filters.lifecycleStatus !== "all" && isAssetLifecycleStatus(filters.lifecycleStatus)
      ? { lifecycleStatuses: [filters.lifecycleStatus as AssetLifecycleStatus] }
      : {}),
    ...(filters.builtIn !== "all" ? { builtIn: filters.builtIn } : {}),
  };
}

export function assetLibraryFiltersAreActive(filters: AssetLibraryFiltersState): boolean {
  return (
    filters.searchText.trim().length > 0 ||
    filters.assetType !== "all" ||
    filters.assetFamily !== "all" ||
    filters.lifecycleStatus !== "all" ||
    filters.builtIn !== "all" ||
    filters.packId !== "all" ||
    filters.sourceLayer !== "all" ||
    filters.categoryId !== "all"
  );
}

export function useAssetLibraryDefinitionBrowser(client: AssetLibraryClient, workspaceId?: string): AssetLibraryFeatureState {
  const [filters, setFilters] = useState<AssetLibraryFiltersState>(ASSET_LIBRARY_DEFAULT_FILTERS);
  const [activeTab, setActiveTab] = useState<AssetLibraryBrowserTab>("definitions");
  const [definitions, setDefinitions] = useState<readonly AssetLibraryDefinitionCard[]>([]);
  const [resourceBackedViews, setResourceBackedViews] = useState<readonly AssetLibraryResourceBackedViewCard[]>([]);
  const [selectedDefinition, setSelectedDefinition] = useState<AssetLibraryDefinitionCard | undefined>();
  const [selectedResourceBackedView, setSelectedResourceBackedView] = useState<AssetLibraryResourceBackedViewCard | undefined>();
  const [selectedDetail, setSelectedDetail] = useState<AssetLibraryDefinitionDetail | undefined>();
  const [selectedResourceBackedViewDetail, setSelectedResourceBackedViewDetail] = useState<AssetLibraryResourceBackedViewDetail | undefined>();
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isLoadingValidation, setIsLoadingValidation] = useState(false);
  const [listError, setListError] = useState<string | undefined>();
  const [detailError, setDetailError] = useState<string | undefined>();
  const [validationError, setValidationError] = useState<string | undefined>();
  const [diagnostics, setDiagnostics] = useState<readonly string[]>([]);
  const listRequestSequence = useRef(0);
  const detailRequestSequence = useRef(0);
  const validationRequestSequence = useRef(0);

  const query = useMemo(() => ({ ...createAssetLibraryQuery(filters), ...(workspaceId ? { workspaceId } : {}) }), [filters, workspaceId]);
  const hasActiveFilters = useMemo(() => assetLibraryFiltersAreActive(filters), [filters]);

  const loadList = useCallback(async () => {
    const requestSequence = ++listRequestSequence.current;
    setIsLoadingList(true);
    setListError(undefined);
    if (!workspaceId) {
      detailRequestSequence.current += 1;
      validationRequestSequence.current += 1;
      setDefinitions([]);
      setResourceBackedViews([]);
      setSelectedDefinition(undefined);
      setSelectedResourceBackedView(undefined);
      setSelectedDetail(undefined);
      setSelectedResourceBackedViewDetail(undefined);
      setDiagnostics([]);
      setIsLoadingList(false);
      return;
    }
    try {
      const result = await client.listAssetDefinitions(query);
      const resourceResult = activeTab === "resource-views"
        ? await client.listAssetResourceBackedViews({
          searchText: query.searchText,
          assetTypes: query.assetTypes,
          assetFamilies: query.assetFamilies,
          lifecycleStatuses: query.lifecycleStatuses,
          limit: query.limit,
          cursor: query.cursor,
          workspaceId,
        })
        : undefined;
      if (requestSequence !== listRequestSequence.current) return;
      if (result.ok === false) {
        setDefinitions([]);
        setResourceBackedViews(resourceResult?.ok === true ? resourceResult.value.items : []);
        setDiagnostics([]);
        setListError(result.error.message || "Unable to load Asset Library.");
        setSelectedDefinition(undefined);
        setSelectedDetail(undefined);
        return;
      }

      const filteredDefinitions = applyLocalDefinitionFilters(result.value.items, filters);
      setDefinitions(filteredDefinitions);
      if (resourceResult?.ok === true) {
        setResourceBackedViews(resourceResult.value.items);
      } else if (activeTab === "resource-views") {
        setResourceBackedViews([]);
      }
      setDiagnostics([
        ...safeDiagnosticMessages((result.value.diagnostics ?? []).map((diagnostic) => diagnostic.message)),
        ...(resourceResult?.ok === true
          ? safeDiagnosticMessages((resourceResult.value.diagnostics ?? []).map((diagnostic) => diagnostic.message))
          : activeTab === "resource-views" && resourceResult?.ok === false
            ? [safeDisplayText(resourceResult.error.message) ?? "Unable to load resource-backed views."]
            : []),
      ]);
    } catch {
      if (requestSequence !== listRequestSequence.current) return;
      setDefinitions([]);
      setResourceBackedViews([]);
      setDiagnostics([]);
      setListError("Unable to read Asset Library data.");
    } finally {
      if (requestSequence === listRequestSequence.current) {
        setIsLoadingList(false);
      }
    }
  }, [activeTab, client, filters, query, workspaceId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => () => {
    listRequestSequence.current += 1;
    detailRequestSequence.current += 1;
    validationRequestSequence.current += 1;
  }, []);

  const readDetail = useCallback(async (
    definition: AssetLibraryDefinitionCard,
    options: { readonly includeValidation?: boolean },
  ) => {
    if (!workspaceId) {
      return { ok: false, error: { code: "workspace_required", message: "Select a workspace before loading assets." } } as const;
    }
    return definition.version
      ? client.readAssetDefinitionVersion(
        { definitionId: definition.definitionId, version: definition.version },
        { expand: ASSET_LIBRARY_DETAIL_EXPANSIONS, ...(workspaceId ? { workspaceId } : {}), ...(options.includeValidation ? { includeValidation: true } : {}) },
      )
      : client.readAssetDefinition(
        { definitionId: definition.definitionId },
        { expand: ASSET_LIBRARY_DETAIL_EXPANSIONS, ...(workspaceId ? { workspaceId } : {}), ...(options.includeValidation ? { includeValidation: true } : {}) },
      );
  }, [client, workspaceId]);

  const selectDefinition = useCallback(async (definition: AssetLibraryDefinitionCard) => {
    const requestSequence = ++detailRequestSequence.current;
    validationRequestSequence.current += 1;
    setActiveTab("definitions");
    setSelectedDefinition(definition);
    setSelectedResourceBackedView(undefined);
    setSelectedResourceBackedViewDetail(undefined);
    setSelectedDetail(undefined);
    setDetailError(undefined);
    setValidationError(undefined);
    setIsLoadingDetail(true);

    try {
      const result = await readDetail(definition, {});
      if (requestSequence !== detailRequestSequence.current) return;
      if (result.ok === true) {
        setSelectedDetail(result.value);
      } else {
        setDetailError(result.error.message || "Unable to load this asset.");
      }
    } catch {
      if (requestSequence === detailRequestSequence.current) {
        setDetailError("Unable to load this asset.");
      }
    } finally {
      if (requestSequence === detailRequestSequence.current) {
        setIsLoadingDetail(false);
      }
    }
  }, [readDetail]);

  const selectResourceBackedView = useCallback(async (view: AssetLibraryResourceBackedViewCard) => {
    const requestSequence = ++detailRequestSequence.current;
    validationRequestSequence.current += 1;
    if (!workspaceId) {
      setActiveTab("resource-views");
      setSelectedResourceBackedView(view);
      setSelectedDefinition(undefined);
      setSelectedDetail(undefined);
      setSelectedResourceBackedViewDetail(undefined);
      setDetailError("Select a workspace before loading resource-backed views.");
      setValidationError(undefined);
      setIsLoadingDetail(false);
      return;
    }

    setActiveTab("resource-views");
    setSelectedResourceBackedView(view);
    setSelectedDefinition(undefined);
    setSelectedDetail(undefined);
    setDetailError(undefined);
    setValidationError(undefined);
    setIsLoadingDetail(true);

    try {
      const result = await client.readAssetResourceBackedView(
        { viewId: view.viewId },
        { expand: ["metadata", "resourceBackings"], workspaceId },
      );
      if (requestSequence !== detailRequestSequence.current) return;
      if (result.ok === true) {
        setSelectedResourceBackedViewDetail(result.value);
      } else {
        setDetailError(safeDisplayText(result.error.message) ?? "Unable to load this resource-backed view.");
      }
    } catch {
      if (requestSequence === detailRequestSequence.current) {
        setDetailError("Unable to load this resource-backed view.");
      }
    } finally {
      if (requestSequence === detailRequestSequence.current) {
        setIsLoadingDetail(false);
      }
    }
  }, [client, workspaceId]);

  const loadValidationDetails = useCallback(async () => {
    if (!selectedDefinition) return;
    const requestSequence = ++validationRequestSequence.current;
    setValidationError(undefined);
    setIsLoadingValidation(true);

    try {
      const result = await readDetail(selectedDefinition, { includeValidation: true });
      if (requestSequence !== validationRequestSequence.current) return;
      if (result.ok === true) {
        setSelectedDetail(result.value);
      } else {
        setValidationError(result.error.message || "Unable to load validation details.");
      }
    } catch {
      if (requestSequence === validationRequestSequence.current) {
        setValidationError("Unable to load validation details.");
      }
    } finally {
      if (requestSequence === validationRequestSequence.current) {
        setIsLoadingValidation(false);
      }
    }
  }, [readDetail, selectedDefinition]);

  return {
    client,
    filters,
    activeTab,
    definitions,
    resourceBackedViews,
    selectedDefinitionId: selectedDefinition?.id,
    selectedResourceBackedViewId: selectedResourceBackedView?.id,
    selectedDetail,
    selectedResourceBackedViewDetail,
    isLoadingList,
    isLoadingDetail,
    isLoadingValidation,
    listError,
    detailError,
    validationError,
    hasActiveFilters,
    diagnostics,
    setSearchText: (value) => setFilters((current) => ({ ...current, searchText: value })),
    setAssetType: (value) => setFilters((current) => ({ ...current, assetType: value })),
    setAssetFamily: (value) => setFilters((current) => ({ ...current, assetFamily: value })),
    setLifecycleStatus: (value) => setFilters((current) => ({ ...current, lifecycleStatus: value })),
    setBuiltIn: (value) => setFilters((current) => ({ ...current, builtIn: value })),
    setPackId: (value) => setFilters((current) => ({ ...current, packId: value })),
    setSourceLayer: (value) => setFilters((current) => ({ ...current, sourceLayer: value })),
    setCategoryId: (value) => setFilters((current) => ({ ...current, categoryId: value })),
    setActiveTab,
    selectDefinition,
    selectResourceBackedView,
    loadValidationDetails,
    refresh: loadList,
  };
}

function applyLocalDefinitionFilters(
  definitions: readonly AssetLibraryDefinitionCard[],
  filters: AssetLibraryFiltersState,
): readonly AssetLibraryDefinitionCard[] {
  return filterAssetDefinitionsByCategory(
    filterAssetDefinitionsBySourceLayer(
      filterAssetDefinitionsByPack(definitions, filters.packId),
      filters.sourceLayer as never,
    ),
    filters.categoryId,
  );
}

function safeDisplayText(value: unknown): string | undefined {
  return sanitizeAssetLibraryDisplayText(value);
}

function safeDiagnosticMessages(value: readonly string[] | undefined): readonly string[] {
  return sanitizeAssetLibraryDiagnosticMessages(value);
}
