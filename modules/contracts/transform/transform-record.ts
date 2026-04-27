import { normalizeArtifactReference, type ArtifactReference } from "../artifact";
import {
  normalizeTransformSpecification,
  type TransformSpecification,
  type TransformParameters,
} from "./transform-specification";

/**
 * TransformRecord captures one transform execution instance.
 *
 * - `specification.definitionId`: stable transform definition identity.
 * - `executionId`: runtime execution record identity for one run.
 */
export interface TransformRecord<
  TParameters extends TransformParameters = TransformParameters,
> {
  executionId?: string;
  specification: TransformSpecification<TParameters>;
  inputs: ArtifactReference[];
  outputs: ArtifactReference[];
  startedAt?: string;
  completedAt?: string;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeTransformRecord<
  TParameters extends TransformParameters = TransformParameters,
>(
  record: TransformRecord<TParameters>,
): TransformRecord<TParameters> {
  return {
    ...record,
    executionId: normalizeOptionalText(record.executionId),
    specification: normalizeTransformSpecification(record.specification),
    inputs: record.inputs.map(normalizeArtifactReference),
    outputs: record.outputs.map(normalizeArtifactReference),
    startedAt: normalizeOptionalText(record.startedAt),
    completedAt: normalizeOptionalText(record.completedAt),
  };
}
