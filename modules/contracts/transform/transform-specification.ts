import { normalizeTransformKind, type TransformKind } from "./transform-kind";
import { normalizeTransformStage, type TransformStage } from "./transform-stage";

export type TransformParameters = Readonly<Record<string, unknown>>;

export interface TransformSpecification<
  TParameters extends TransformParameters = TransformParameters,
> {
  definitionId: string;
  kind: TransformKind;
  stage: TransformStage;
  name?: string;
  version?: string;
  parameters?: TParameters;
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

export function normalizeTransformSpecification<
  TParameters extends TransformParameters = TransformParameters,
>(
  specification: TransformSpecification<TParameters>,
): TransformSpecification<TParameters> {
  return {
    ...specification,
    definitionId: normalizeRequiredText(
      specification.definitionId,
      "Transform definition id",
    ),
    kind: normalizeTransformKind(specification.kind),
    stage: normalizeTransformStage(specification.stage),
    name: normalizeOptionalText(specification.name),
    version: normalizeOptionalText(specification.version),
  };
}
