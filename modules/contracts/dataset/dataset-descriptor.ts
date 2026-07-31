import type { WorkspaceId } from "../workspace";
import { normalizeArtifactReference, type ArtifactReference } from "../artifact";
import { normalizeTransformReference, type TransformReference } from "../transform";
import {
  normalizeDatasetMaterializationDescriptor,
  type DatasetMaterializationDescriptor,
} from "./dataset-materialization-descriptor";
import {
  normalizeDatasetSchemaSummary,
  type DatasetSchemaSummary,
} from "./dataset-schema-summary";

export type DatasetMetadata = Readonly<Record<string, unknown>>;

/**
 * Datasets reference source artifacts and transforms through typed references.
 * Raw string id arrays should not be introduced here.
 */
export interface DatasetDescriptor<
  TMetadata extends DatasetMetadata = DatasetMetadata,
> {
  id: string;
  workspaceId?: WorkspaceId;
  name?: string;
  schema?: DatasetSchemaSummary;
  sourceArtifacts?: ArtifactReference[];
  transforms?: TransformReference[];
  materializations?: DatasetMaterializationDescriptor[];
  createdAt?: string;
  metadata?: TMetadata;
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = value.trim();

  if (normalized.length < 1) {
    throw new Error(`${label} must be a non-empty string. Received "${value}".`);
  }

  return normalized;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeDatasetDescriptor<
  TMetadata extends DatasetMetadata = DatasetMetadata,
>(
  descriptor: DatasetDescriptor<TMetadata>,
): DatasetDescriptor<TMetadata> {
  return {
    ...descriptor,
    id: normalizeRequiredText(descriptor.id, "Dataset id"),
    workspaceId: descriptor.workspaceId,
    name: normalizeOptionalText(descriptor.name),
    schema: normalizeDatasetSchemaSummary(descriptor.schema),
    sourceArtifacts: descriptor.sourceArtifacts?.map(normalizeArtifactReference),
    transforms: descriptor.transforms?.map(normalizeTransformReference),
    materializations: descriptor.materializations?.map(
      normalizeDatasetMaterializationDescriptor,
    ),
    createdAt: normalizeOptionalText(descriptor.createdAt),
  };
}
