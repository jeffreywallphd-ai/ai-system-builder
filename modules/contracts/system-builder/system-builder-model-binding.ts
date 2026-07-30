import type { AssetJsonValue } from "../asset";
import type { ModelLifecycleStatus, ModelTaskTag } from "../../domain/model";
import type { WorkspaceId } from "../workspace";

export const SYSTEM_BUILDER_MODEL_BINDING_KIND = "model-record";
export const SYSTEM_BUILDER_MODEL_BINDING_SCHEMA_VERSION = "1.0";
export const SYSTEM_BUILDER_MODEL_BINDING_FIELD_ID = "modelBinding";

export interface SystemBuilderModelBinding {
  readonly [key: string]: AssetJsonValue;
  readonly schemaVersion: typeof SYSTEM_BUILDER_MODEL_BINDING_SCHEMA_VERSION;
  readonly kind: typeof SYSTEM_BUILDER_MODEL_BINDING_KIND;
  readonly id: string;
  readonly modelRecordId: string;
}

export interface SystemBuilderModelOption {
  readonly binding: SystemBuilderModelBinding;
  readonly displayName: string;
  readonly lifecycleStatus: Extract<
    ModelLifecycleStatus,
    "downloaded" | "generated" | "validated"
  >;
  readonly taskTags: readonly Extract<
    ModelTaskTag,
    "text-generation" | "text2text-generation" | "chat"
  >[];
}

export interface ListSystemBuilderModelOptionsQuery {
  readonly workspaceId: WorkspaceId;
}

export interface SystemBuilderModelOptionCatalog {
  readonly options: readonly SystemBuilderModelOption[];
}

export function normalizeSystemBuilderModelRecordId(value: string): string {
  const normalized = value.trim();
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(normalized) ||
    normalized.includes("..")
  ) {
    throw new Error("Model record id must be a safe non-path identifier.");
  }
  return normalized;
}

export function createSystemBuilderModelBinding(
  modelRecordId: string,
): SystemBuilderModelBinding {
  const normalizedModelRecordId =
    normalizeSystemBuilderModelRecordId(modelRecordId);
  return {
    schemaVersion: SYSTEM_BUILDER_MODEL_BINDING_SCHEMA_VERSION,
    kind: SYSTEM_BUILDER_MODEL_BINDING_KIND,
    id: normalizedModelRecordId,
    modelRecordId: normalizedModelRecordId,
  };
}

export function readSystemBuilderModelBinding(
  value: AssetJsonValue | undefined,
): SystemBuilderModelBinding | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Readonly<Record<string, AssetJsonValue>>;
  if (
    record.schemaVersion !== SYSTEM_BUILDER_MODEL_BINDING_SCHEMA_VERSION ||
    record.kind !== SYSTEM_BUILDER_MODEL_BINDING_KIND ||
    typeof record.modelRecordId !== "string" ||
    (record.id !== undefined && record.id !== record.modelRecordId)
  ) {
    return undefined;
  }

  try {
    return createSystemBuilderModelBinding(record.modelRecordId);
  } catch {
    return undefined;
  }
}
