import type {
  DatasetPreparationSummary,
  DatasetPreparationWarning,
} from "./dataset-preparation";
import type { PythonRuntimeOutputDescriptor } from "./python-runtime-output-descriptor";
import type { DatasetQualityReport } from "./dataset-quality";

export interface PrepareTrainingDatasetResult {
  outputs: PythonRuntimeOutputDescriptor[];
  summary: DatasetPreparationSummary;
  qualityReport?: DatasetQualityReport;
  warnings?: DatasetPreparationWarning[];
}
