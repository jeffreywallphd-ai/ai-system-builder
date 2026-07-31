import type { AssetRegistryDefinitionReadPort } from "../../../application/ports/asset";
import type { AssetRegistryListQuery, AssetRegistryReadOptions } from "../../../application/services/asset/asset-registry-read-facade.types";
import {
  ASSET_FAMILIES,
  ASSET_LIFECYCLE_STATUSES,
  ASSET_RESOURCE_BACKED_VIEW_KINDS,
  ASSET_TYPES,
  isAssetFamily,
  isAssetLifecycleStatus,
  type AssetResourceBackedViewKind,
  isAssetType,
  normalizeAssetId,
  normalizeAssetVersion,
  type AssetFamily,
  type AssetLifecycleStatus,
  type AssetReference,
  type AssetType,
} from "../../../contracts/asset";

export type AssetRegistryReadInputShape = "api-query" | "ipc-payload";
export type AssetRegistryBuiltInFilter = "all" | "built-in" | "custom";
export type AssetRegistryDefinitionExpansion =
  | "aiContext"
  | "configurationSchema"
  | "ports"
  | "requirements"
  | "provenance"
  | "metadata";
export type AssetRegistryResourceBackedViewExpansion =
  | "metadata"
  | "resourceBackings"
  | "validation";

export interface AssetRegistryDefinitionListInput {
  readonly searchText?: string;
  readonly assetTypes?: readonly AssetType[];
  readonly assetFamilies?: readonly AssetFamily[];
  readonly lifecycleStatuses?: readonly AssetLifecycleStatus[];
  readonly builtIn?: AssetRegistryBuiltInFilter;
  readonly limit?: number;
  readonly cursor?: string;
  readonly includeMetadata?: boolean;
  readonly workspaceId?: string;
}

export interface AssetRegistryDefinitionReadInput {
  readonly definitionId: string;
  readonly version?: string;
  readonly expand?: readonly AssetRegistryDefinitionExpansion[];
  readonly includeValidation?: boolean;
  readonly workspaceId?: string;
}

export interface AssetRegistryResourceBackedViewListInput {
  readonly searchText?: string;
  readonly assetTypes?: readonly AssetType[];
  readonly assetFamilies?: readonly AssetFamily[];
  readonly lifecycleStatuses?: readonly AssetLifecycleStatus[];
  readonly viewKinds?: readonly AssetResourceBackedViewKind[];
  readonly limit?: number;
  readonly cursor?: string;
  readonly includeMetadata?: boolean;
  readonly workspaceId?: string;
}

export interface AssetRegistryResourceBackedViewReadInput {
  readonly viewId: string;
  readonly expand?: readonly AssetRegistryResourceBackedViewExpansion[];
  readonly includeValidation?: boolean;
  readonly workspaceId?: string;
}

const MAX_PUBLIC_LIMIT = 100;
const EXPANSIONS = new Set<AssetRegistryDefinitionExpansion>([
  "aiContext",
  "configurationSchema",
  "ports",
  "requirements",
  "provenance",
  "metadata",
]);
const RESOURCE_BACKED_VIEW_EXPANSIONS = new Set<AssetRegistryResourceBackedViewExpansion>([
  "metadata",
  "resourceBackings",
  "validation",
]);

export function parseAssetRegistryDefinitionListInput(
  input: unknown,
  shape: AssetRegistryReadInputShape,
): AssetRegistryDefinitionListInput {
  const record = requireRecord(input);
  const searchTextValue = shape === "api-query" ? record.q : record.searchText;
  const assetTypesValue = shape === "api-query" ? record.assetType : record.assetTypes;
  const assetFamiliesValue = shape === "api-query" ? record.assetFamily : record.assetFamilies;
  const lifecycleStatusesValue = shape === "api-query" ? record.lifecycleStatus : record.lifecycleStatuses;
  const workspaceIdValue = record.workspaceId;

  return {
    ...(searchTextValue !== undefined ? { searchText: optionalString(searchTextValue, "searchText", shape) } : {}),
    ...(assetTypesValue !== undefined
      ? { assetTypes: parseStringList(assetTypesValue, "assetTypes", shape).map((value) => assertKnown(value, isAssetType, ASSET_TYPES, "assetTypes")) as AssetType[] }
      : {}),
    ...(assetFamiliesValue !== undefined
      ? { assetFamilies: parseStringList(assetFamiliesValue, "assetFamilies", shape).map((value) => assertKnown(value, isAssetFamily, ASSET_FAMILIES, "assetFamilies")) as AssetFamily[] }
      : {}),
    ...(lifecycleStatusesValue !== undefined
      ? { lifecycleStatuses: parseStringList(lifecycleStatusesValue, "lifecycleStatuses", shape).map((value) => assertKnown(value, isAssetLifecycleStatus, ASSET_LIFECYCLE_STATUSES, "lifecycleStatuses")) as AssetLifecycleStatus[] }
      : {}),
    ...(record.builtIn !== undefined ? { builtIn: parseBuiltIn(record.builtIn, shape) } : {}),
    ...(record.limit !== undefined ? { limit: parseLimit(record.limit, shape) } : {}),
    ...(record.cursor !== undefined ? { cursor: parseCursor(record.cursor, shape) } : {}),
    ...(record.includeMetadata !== undefined ? { includeMetadata: parseBoolean(record.includeMetadata, "includeMetadata", shape) } : {}),
    ...(workspaceIdValue !== undefined ? { workspaceId: requiredString(workspaceIdValue, "workspaceId", shape) } : {}),
  };
}

export function toAssetRegistryFacadeListQuery(
  input: AssetRegistryDefinitionListInput,
): Parameters<AssetRegistryDefinitionReadPort["listDefinitionCards"]>[0] {
  return {
    searchText: input.searchText,
    assetTypes: input.assetTypes,
    assetFamilies: input.assetFamilies,
    lifecycleStatuses: input.lifecycleStatuses,
    includeBuiltIns: input.builtIn === "custom" ? false : undefined,
    includeCustom: input.builtIn === "built-in" ? false : undefined,
    includeMetadata: input.includeMetadata,
    limit: input.limit,
    cursor: input.cursor,
    workspaceId: input.workspaceId,
  };
}

export function parseAssetRegistryResourceBackedViewListInput(
  input: unknown,
  shape: AssetRegistryReadInputShape,
): AssetRegistryResourceBackedViewListInput {
  const record = requireRecord(input);
  const searchTextValue = shape === "api-query" ? record.q : record.searchText;
  const assetTypesValue = shape === "api-query" ? record.assetType : record.assetTypes;
  const assetFamiliesValue = shape === "api-query" ? record.assetFamily : record.assetFamilies;
  const lifecycleStatusesValue = shape === "api-query" ? record.lifecycleStatus : record.lifecycleStatuses;
  const viewKindsValue = shape === "api-query" ? record.viewKind : record.viewKinds;
  const workspaceIdValue = record.workspaceId;

  return {
    ...(searchTextValue !== undefined ? { searchText: optionalString(searchTextValue, "searchText", shape) } : {}),
    ...(assetTypesValue !== undefined
      ? { assetTypes: parseStringList(assetTypesValue, "assetTypes", shape).map((value) => assertKnown(value, isAssetType, ASSET_TYPES, "assetTypes")) as AssetType[] }
      : {}),
    ...(assetFamiliesValue !== undefined
      ? { assetFamilies: parseStringList(assetFamiliesValue, "assetFamilies", shape).map((value) => assertKnown(value, isAssetFamily, ASSET_FAMILIES, "assetFamilies")) as AssetFamily[] }
      : {}),
    ...(lifecycleStatusesValue !== undefined
      ? { lifecycleStatuses: parseStringList(lifecycleStatusesValue, "lifecycleStatuses", shape).map((value) => assertKnown(value, isAssetLifecycleStatus, ASSET_LIFECYCLE_STATUSES, "lifecycleStatuses")) as AssetLifecycleStatus[] }
      : {}),
    ...(viewKindsValue !== undefined
      ? { viewKinds: parseStringList(viewKindsValue, "viewKinds", shape).map((value) => assertKnown(value, isAssetResourceBackedViewKind, ASSET_RESOURCE_BACKED_VIEW_KINDS, "viewKinds")) as AssetResourceBackedViewKind[] }
      : {}),
    ...(record.limit !== undefined ? { limit: parseLimit(record.limit, shape) } : {}),
    ...(record.cursor !== undefined ? { cursor: parseCursor(record.cursor, shape) } : {}),
    ...(record.includeMetadata !== undefined ? { includeMetadata: parseBoolean(record.includeMetadata, "includeMetadata", shape) } : {}),
    ...(workspaceIdValue !== undefined ? { workspaceId: requiredString(workspaceIdValue, "workspaceId", shape) } : {}),
  };
}

export function toAssetRegistryResourceBackedViewListQuery(
  input: AssetRegistryResourceBackedViewListInput,
): AssetRegistryListQuery {
  return {
    searchText: input.searchText,
    assetTypes: input.assetTypes,
    assetFamilies: input.assetFamilies,
    lifecycleStatuses: input.lifecycleStatuses,
    viewKinds: input.viewKinds,
    includeMetadata: input.includeMetadata,
    limit: input.limit,
    cursor: input.cursor,
    workspaceId: input.workspaceId,
  };
}

export function parseAssetRegistryDefinitionReadInput(
  input: unknown,
  shape: AssetRegistryReadInputShape,
  options: { requireVersion?: boolean } = {},
): AssetRegistryDefinitionReadInput {
  const record = requireRecord(input);
  const definitionId = normalizeAssetId(requiredString(record.definitionId, "definitionId", shape));
  const version = record.version === undefined
    ? undefined
    : normalizeAssetVersion(requiredString(record.version, "version", shape));
  if (options.requireVersion && !version) {
    throw new Error("version is required");
  }

  const expand = record.expand === undefined
    ? undefined
    : parseStringList(record.expand, "expand", shape).map((value) => {
      if (!EXPANSIONS.has(value as AssetRegistryDefinitionExpansion)) {
        throw new Error("invalid expand");
      }
      return value as AssetRegistryDefinitionExpansion;
    });

  return {
    definitionId,
    ...(version ? { version } : {}),
    ...(expand ? { expand } : {}),
    ...(record.includeValidation !== undefined ? { includeValidation: parseBoolean(record.includeValidation, "includeValidation", shape) } : {}),
    ...(record.workspaceId !== undefined ? { workspaceId: requiredString(record.workspaceId, "workspaceId", shape) } : {}),
  };
}

export function toAssetRegistryDefinitionReference(
  input: Pick<AssetRegistryDefinitionReadInput, "definitionId" | "version">,
): AssetReference {
  return {
    kind: "asset-definition",
    id: normalizeAssetId(input.definitionId),
    ...(input.version ? { version: normalizeAssetVersion(input.version) } : {}),
  };
}

export function toAssetRegistryReadOptions(
  input: Pick<AssetRegistryDefinitionReadInput, "expand" | "includeValidation" | "workspaceId">,
): AssetRegistryReadOptions {
  const expand = new Set(input.expand ?? []);
  return {
    includeValidation: input.includeValidation,
    includeAiContext: expand.has("aiContext"),
    includeConfigurationSchema: expand.has("configurationSchema"),
    includePorts: expand.has("ports"),
    includeRequirements: expand.has("requirements"),
    includeMetadata: expand.has("metadata"),
    workspaceId: input.workspaceId,
  };
}

export function parseAssetRegistryResourceBackedViewReadInput(
  input: unknown,
  shape: AssetRegistryReadInputShape,
): AssetRegistryResourceBackedViewReadInput {
  const record = requireRecord(input);
  const viewId = requiredString(record.viewId, "viewId", shape);
  const expand = record.expand === undefined
    ? undefined
    : parseStringList(record.expand, "expand", shape).map((value) => {
      if (!RESOURCE_BACKED_VIEW_EXPANSIONS.has(value as AssetRegistryResourceBackedViewExpansion)) {
        throw new Error("invalid expand");
      }
      return value as AssetRegistryResourceBackedViewExpansion;
    });

  return {
    viewId,
    ...(expand ? { expand } : {}),
    ...(record.includeValidation !== undefined ? { includeValidation: parseBoolean(record.includeValidation, "includeValidation", shape) } : {}),
    ...(record.workspaceId !== undefined ? { workspaceId: requiredString(record.workspaceId, "workspaceId", shape) } : {}),
  };
}

export function toAssetRegistryResourceBackedViewReadOptions(
  input: Pick<AssetRegistryResourceBackedViewReadInput, "expand" | "includeValidation" | "workspaceId">,
): AssetRegistryReadOptions {
  const expand = new Set(input.expand ?? []);
  return {
    includeValidation: input.includeValidation || expand.has("validation"),
    includeMetadata: expand.has("metadata"),
    includeResourceBackings: expand.has("resourceBackings"),
    workspaceId: input.workspaceId,
  };
}

function isAssetResourceBackedViewKind(value: string): value is AssetResourceBackedViewKind {
  return ASSET_RESOURCE_BACKED_VIEW_KINDS.includes(value as AssetResourceBackedViewKind);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("input must be an object");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, fieldName: string, shape: AssetRegistryReadInputShape): string {
  const parsed = optionalString(value, fieldName, shape);
  if (!parsed) throw new Error(`${fieldName} must be non-empty`);
  return parsed;
}

function optionalString(value: unknown, fieldName: string, shape: AssetRegistryReadInputShape): string | undefined {
  if (typeof value !== "string") throw new Error(`${fieldName} must be a string`);
  const trimmed = value.trim();
  if (shape === "api-query" && trimmed.length === 0) return undefined;
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseStringList(value: unknown, fieldName: string, shape: AssetRegistryReadInputShape): string[] {
  if (shape === "api-query") {
    if (Array.isArray(value)) {
      if (value.length !== 1 || typeof value[0] !== "string") throw new Error(`${fieldName} must be a single query value`);
      return splitCsv(value[0]);
    }
    if (typeof value !== "string") throw new Error(`${fieldName} must be a string`);
    return splitCsv(value);
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${fieldName} must be a string array`);
  }
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function splitCsv(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function assertKnown<T extends readonly string[]>(
  value: string,
  predicate: (value: string) => boolean,
  allowed: T,
  fieldName: string,
): T[number] {
  const normalized = value.trim().toLowerCase();
  if (!predicate(normalized)) throw new Error(`${fieldName} must be one of ${allowed.join(", ")}`);
  return normalized as T[number];
}

function parseBuiltIn(value: unknown, shape: AssetRegistryReadInputShape): AssetRegistryBuiltInFilter {
  if (shape === "api-query" && typeof value !== "string") throw new Error("builtIn must be a string");
  if (value === "all" || value === "built-in" || value === "custom") return value;
  throw new Error("builtIn must be all, built-in, or custom");
}

function parseBoolean(value: unknown, fieldName: string, shape: AssetRegistryReadInputShape): boolean {
  if (shape === "api-query") {
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error(`${fieldName} must be true or false`);
  }
  if (typeof value === "boolean") return value;
  throw new Error(`${fieldName} must be boolean`);
}

function parseLimit(value: unknown, shape: AssetRegistryReadInputShape): number {
  if (shape === "api-query") {
    if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error("invalid limit");
    return assertPublicLimit(Number(value));
  }
  if (typeof value !== "number") throw new Error("invalid limit");
  return assertPublicLimit(value);
}

function assertPublicLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PUBLIC_LIMIT) throw new Error("invalid limit");
  return value;
}

function parseCursor(value: unknown, shape: AssetRegistryReadInputShape): string {
  const cursor = requiredString(value, "cursor", shape);
  if (cursor.length > 512 || /[\\/\x00-\x1f\x7f]/.test(cursor)) throw new Error("invalid cursor");
  return cursor;
}
