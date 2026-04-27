import {
  normalizeTransformRecord,
  type TransformRecord,
  type TransformParameters,
} from "./transform-record";

export interface TransformExecutionSummary<
  TParameters extends TransformParameters = TransformParameters,
> {
  record: TransformRecord<TParameters>;
  inputCount: number;
  outputCount: number;
  warnings?: string[];
}

export function normalizeTransformExecutionSummary<
  TParameters extends TransformParameters = TransformParameters,
>(
  summary: TransformExecutionSummary<TParameters>,
): TransformExecutionSummary<TParameters> {
  return {
    ...summary,
    record: normalizeTransformRecord(summary.record),
  };
}
