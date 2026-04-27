import type {
  DatasetPreparationSummary,
  DatasetPreparationWarning,
} from "./dataset-preparation";
import type { PythonRuntimeOutputDescriptor } from "./python-runtime-output-descriptor";

export interface PrepareTrainingDatasetResult {
  outputs: PythonRuntimeOutputDescriptor[];
  summary: DatasetPreparationSummary;
  warnings?: DatasetPreparationWarning[];
}
